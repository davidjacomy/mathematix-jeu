/* ══════════════════════════════════════════════════════════════════
   game.js — machine à états de la partie

   Une manche = ANNONCE (si chausse-trappe) → QUESTION → RÉSOLUTION.

   Deux façons de jouer partagent cette machine. LA LEÇON : un nombre de
   questions fixé, le maître commente chacune et tend ses pièges. LE
   SPRINT : un maximum de calculs avant la cloche, correction brève, aucun
   piège — le volume de restitution qui construit l'automatisme.

   Règle du buzzer : le premier joueur qui répond, juste ou faux, déclenche
   une courte fenêtre de rattrapage pour les autres — il ne clôt pas la
   manche. Le juste et le faux ne se voient qu'à la RÉSOLUTION : tant que le
   chrono tourne, l'écran et le son restent muets sur la correction, sans
   quoi les joueurs lents n'ont plus qu'à recopier. Se tromper met « au
   piquet », affiché à la résolution — et le maître le remarque.
   ══════════════════════════════════════════════════════════════════ */
MX.Game = (function () {
  const { $, $$, clamp, replay } = MX.U;
  const A = MX.Audio, FX = MX.FX, Q = MX.Questions, T = MX.Traps, Teach = MX.Teacher, Ops = MX.Ops;

  const P_COLORS = ['var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)'];
  const P_NAMES  = ['Élève 1', 'Élève 2', 'Élève 3', 'Élève 4'];
  // Le tampon qui tombe au milieu du losange à la révélation (cf. `resolve`).
  const VERDICTS = { win: 'BRAVO !', lose: 'RATÉ !', late: 'TROP TARD !' };

  /* Tous les réglages sont ici, et tous peuvent être pilotés depuis
     l'écran d'accueil (presets ou personnalisé). */
  const DEFAULT_CFG = {
    ops: ['×'],          // opérations au programme
    tables: [2, 3, 4, 5, 6, 7, 8, 9],
    nombres: 20,         // portée des additions et soustractions
    mode: 'lecon',       // 'lecon' | 'sprint'
    rounds: 15,          // leçon : nombre de questions
    sprintMs: 90000,     // sprint : temps de RÉPONSE total avant la cloche
    faits: null,         // partie de révision : ces calculs-là, rien d'autre
    revoir: [],          // calculs que le carnet fait revenir en priorité
    timeBase: 5000,      // temps par question, en millisecondes
    mix: 'equilibre',    // proportion facile / difficile des opérations
    bothWays: true,      // « 8 × 3 » autant que « 3 × 8 »
    holeRate: 0.2,       // part de questions « quel nombre manque ? »
    trapRate: 0.42,      // part des manches avec une chausse-trappe
    graceMs: 1300,       // fenêtre de rattrapage après la première réponse
  };
  let cfg = Object.assign({}, DEFAULT_CFG);
  let players = [];
  let round = 0;
  let q = null;
  let trap = null, lastTrapId = null;
  let phase = 'idle';            // 'intro' | 'announce' | 'show' | 'resolve' | 'idle'
  let paused = false, pausedAt = 0, pausedTotal = 0;
  let answers = {};              // playerId → slot choisi cette manche
  let firstAnswerId = null;      // qui s'est prononcé en premier (juste ou faux)
  let firstRightId = null;       // qui a trouvé en premier — sert au score SEUL
  let roundStart = 0, roundDur = 0, roundDurFull = 0;
  let graceStart = null, graceFill = 1;
  let finReponses = null;        // temps de réponse figé quand tous ont répondu
  let spent = 0;                 // sprint : temps de réponse déjà consommé
  let budgetQuestion = Infinity; // sprint : ce que la cloche laisse à la question en cours
  let evaluated = 0;             // questions corrigées dans cette partie
  let bilan = {};                // clé de fait → { ok, ko }, tous joueurs confondus
  let rafTimer = null;
  let deadlineTimer = null;
  const pendingTimeouts = new Set();
  let sceneVersion = 0, speechFinish = null;

  /* Fenêtre de grâce : le premier joueur qui SE PRONONCE ne clôt pas la
     manche, il déclenche un dernier temps très court. Sans elle, un joueur
     plus rapide que les autres répond à toutes les questions et les plus
     lents ne s'entraînent jamais — ce qui ruine l'objectif du jeu. Le
     bonus « premier » suffit à récompenser la vitesse. Réglable.
     Elle se déclenche sur la première réponse QUELLE QU'ELLE SOIT, et non
     sur la première bonne : un chrono qui s'écourte est une information, et
     la déclencher sur une bonne réponse reviendrait à annoncer aux autres
     qu'ils peuvent recopier la case déjà choisie. */

  /* ─── Petits utilitaires de scène ───────────────────────────────── */
  function sceneNow() {
    return (paused ? pausedAt : performance.now()) - pausedTotal;
  }
  function arm(timer) {
    timer.id = setTimeout(() => {
      pendingTimeouts.delete(timer);
      timer.id = null;
      if (!paused) timer.fn();
    }, Math.max(0, timer.due - sceneNow()));
  }
  function later(ms, fn) {
    const timer = { id: null, due: sceneNow() + Math.max(0, ms), fn };
    pendingTimeouts.add(timer);
    if (!paused) arm(timer);
    return timer;
  }
  function cancelLater(timer) {
    if (!timer) return;
    clearTimeout(timer.id);
    pendingTimeouts.delete(timer);
  }
  function clearLater() {
    pendingTimeouts.forEach(timer => clearTimeout(timer.id));
    pendingTimeouts.clear();
    deadlineTimer = null;
    // Une synthèse vocale peut émettre « end » APRÈS cancel(). Ce numéro
    // empêche sa continuation de recréer un délai dans la scène suivante.
    sceneVersion++;
    speechFinish = null;
  }

  /* Attendre que la voix ait FINI avant d'enchaîner.
     Chaque réplique du maître redit l'opération et son résultat : c'est le
     levier de mémorisation du jeu. L'enchaînement sur un délai fixe la
     coupait systématiquement, parce que la durée réelle d'une phrase dépend
     de la voix installée et de sa vitesse — un délai en dur ne peut pas la
     connaître. Deux bornes encadrent l'attente : un plancher, pour laisser
     le temps de LIRE la correction même quand la voix est coupée dans les
     réglages ; un plafond, parce que SpeechSynthesis n'émet pas toujours son
     évènement « end ». */
  const SPEECH_CAP = 8500;
  function speakThen(text, tone, minMs, done) {
    const t0 = sceneNow(), version = sceneVersion;
    let fired = false;
    let cap = null;
    const finish = () => {
      if (fired || version !== sceneVersion) return;
      fired = true;
      cancelLater(cap);
      if (speechFinish === finish) speechFinish = null;
      later(Math.max(0, minMs - (sceneNow() - t0)), done);
    };
    speechFinish = finish;
    cap = later(SPEECH_CAP, finish);       // filet : « end » n'arrive pas toujours
    A.say(text, tone, finish);
  }

  /* L'objet remis aux chausse-trappes : leur seule porte sur la scène. */
  const ui = {
    timeout: later,
    hidePrompt(on) {
      $('#prompt').classList.toggle('hidden-mem', on);
      $('#prompt-tail').classList.toggle('hidden-mem', on);
    },
    chalkSqueak() { A.sfx.chalk(); FX.shake('s'); },
  };

  /* ─── Sprint : la cloche ────────────────────────────────────────────
     Le budget du sprint ne décompte que le temps de RÉPONSE. La correction
     n'en consomme pas : lire pourquoi on s'est trompé ne doit rien coûter,
     sinon le mode apprendrait à ne plus regarder ses erreurs. Se tromper,
     en revanche, coûte le temps plein de la question (cf. `resolve`).   */
  const SPRINT_MIN = 800;        // sous ce reste, plus le temps de lire un calcul
  function sprint() { return cfg.mode === 'sprint'; }
  function tempsDeReponse() {
    return finReponses != null ? finReponses : Math.min(sceneNow() - roundStart, roundDur);
  }
  function resteSprint() {
    return Math.max(0, cfg.sprintMs - spent - (phase === 'show' ? tempsDeReponse() : 0));
  }
  /* L'échéance de la question en cours EST-elle la cloche ? Cela se lit sur
     ce qui a été PROGRAMMÉ, pas sur l'heure qu'il est : un minuteur de
     navigateur peut tomber une fraction de milliseconde en avance, et une
     mesure du temps écoulé ferait alors juger une question que la cloche a
     coupée. La fenêtre de rattrapage raccourcit `roundDur` : l'échéance
     redevient alors celle d'une question ordinaire. */
  function clocheSonne() { return roundDur >= budgetQuestion; }
  function horloge(ms) {
    const s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* ─── Mise en place ─────────────────────────────────────────────── */
  function setup(config, inputPlayers) {
    stopTimer();
    clearLater();
    A.cancel();
    phase = 'idle';
    setPaused(false);
    pausedTotal = 0;
    q = null; trap = null;
    cfg = Object.assign({}, DEFAULT_CFG, config);
    Q.configure({ ops: cfg.ops, tables: cfg.tables, nombres: cfg.nombres,
                  mix: cfg.mix, bothWays: cfg.bothWays, holeRate: cfg.holeRate,
                  faits: cfg.faits, revoir: cfg.revoir });

    players = inputPlayers.map((p, i) => ({
      id: i,
      name: P_NAMES[i],
      color: P_COLORS[i],
      device: p.device,
      label: p.label || MX.Input.deviceLabel(p.device),   // « Clavier · Flèches + souris »
      score: 0,
      right: 0, wrong: 0, none: 0,
      streak: 0, bestStreak: 0,
      bestMs: null,
      misses: {},                 // clé de fait → { n, fait } : à revoir
      parOp: {},                  // opération → { ok, total }
    }));

    round = 0;
    spent = 0; evaluated = 0; bilan = {};
    lastTrapId = null;
    buildDesks();
    $('#round-counter').classList.toggle('sprint', sprint());
    $('#round-max').textContent = cfg.rounds;
    $('#teacher-slot').innerHTML = Teach.portrait();
    $('#burst-face').innerHTML = Teach.portrait();
    $('#round-now').textContent = sprint() ? horloge(cfg.sprintMs) : '0';
    $('#end-progress').textContent = '';
    hideBurst();
    resetBoard();
  }

  function buildDesks() {
    const wrap = $('#desks');
    wrap.innerHTML = '';
    players.forEach(p => {
      const d = document.createElement('div');
      d.className = 'desk';
      d.id = 'desk-' + p.id;
      d.style.setProperty('--pc', p.color);
      d.innerHTML = `<span class="desk-id">
                       <span class="desk-name">${p.name}</span>
                       <span class="desk-keys">${p.label}</span>
                     </span>
                     <span class="desk-score">0</span>
                     <span class="streak"></span>`;
      wrap.appendChild(d);
    });
  }

  /* ─── Démarrage ─────────────────────────────────────────────────── */
  function begin() {
    if (phase !== 'idle' || !players.length) return;
    clearLater();
    phase = 'intro';
    MX.Input.mode = 'play';
    const l = Teach.line(cfg.faits ? 'introRevision' : sprint() ? 'introSprint' : 'intro');
    A.sfx.slam();
    FX.shake('m');
    burst(l.shout, 'rage', l.speech, 'angry', 1500,
          () => { hideBurst(); nextRound(); });
  }

  /* ─── Manche ────────────────────────────────────────────────────── */
  function nextRound() {
    clearLater();
    A.cancel();
    if (sprint() ? resteSprint() < SPRINT_MIN : round >= cfg.rounds) return finish();
    round++;

    $('#round-now').textContent = sprint() ? horloge(resteSprint()) : round;
    resetBoard();

    // Pas de piège sur les deux premières manches : on laisse le temps
    // de comprendre le losange avant de casser les règles. Aucun en sprint :
    // une annonce y casserait le rythme qui fait tout l'intérêt du mode.
    const wantTrap = !sprint() && round > 2 && Math.random() < cfg.trapRate;
    trap = (wantTrap && T.draw(lastTrapId, Q.contexte)) || null;
    if (trap) lastTrapId = trap.id;

    if (trap) announceTrap(); else showQuestion();
  }

  function resetBoard() {
    answers = {};
    firstAnswerId = null;
    firstRightId = null;
    graceStart = null; graceFill = 1;
    finReponses = null;
    ui.hidePrompt(false);
    $('#trap-banner').classList.remove('show');
    $('#trap-banner').textContent = '';      // sinon l'ancien nom réapparaît
    $('#combo-note').classList.remove('show');
    $('.timer-rail').classList.remove('panic', 'grace');
    $('#timer-fill').style.transform = 'scaleX(1)';
    // L'ardoise s'efface AVANT l'annonce : une opération encore affichée
    // pendant qu'on annonce la manche suivante est une opération qu'on ne
    // posera jamais — l'enfant la lit et prépare une réponse pour rien.
    $('#prompt').textContent = '';
    $('#prompt').classList.remove('is-text');
    $('#prompt-tail').textContent = '';
    $('#prompt-tail').classList.remove('fort');
    $('#round-feedback').textContent = '';
    $('#round-feedback').classList.remove('show');
    $$('.float-pts').forEach(el => el.remove());
    $('#verdict').className = 'verdict';
    $('#verdict').textContent = '';
    $('#diamond').classList.remove('verdict-win', 'verdict-lose');
    $$('.ans').forEach(el => {
      el.classList.remove('reveal-good', 'reveal-bad', 'locked', 'hit', 'op-mode', 'sign-mode', 'chosen');
      el.querySelector('.ans-val').textContent = '';
      const b = el.querySelector('.buzzers');
      if (b) b.remove();
    });
    $$('.desk').forEach(d => d.classList.remove('stunned', 'gain'));
    Teach.setMood($('#teacher-slot'), 'neutral');
  }

  function announceTrap() {
    phase = 'announce';
    const banner = $('#trap-banner');
    banner.textContent = trap.name;
    replay(banner, 'show');
    Teach.setMood($('#teacher-slot'), 'sly');
    A.sfx.chalk();
    FX.chalkDust(window.innerWidth * 0.5, window.innerHeight * 0.18, 22, '#ffd23f');
    // La question n'apparaît qu'une fois l'annonce dite en entier : sinon le
    // chrono démarre pendant que la voix parle encore, et l'énoncé se fait
    // couvrir par l'annonce de la chausse-trappe.
    if (trap.voice) speakThen(trap.voice, 'sly', 1600, showQuestion);
    else later(1600, showQuestion);
  }

  function showQuestion() {
    phase = 'show';
    // Les types de question que la manche accepte : la chausse-trappe décide
    // quand il y en a une, sinon résultat ou trou selon le réglage.
    q = Q.next({ kinds: (trap && trap.kinds) || ['result', 'hole'] });

    const isText = q.kind === 'intruder';
    const prompt = $('#prompt');
    prompt.textContent = q.display;
    prompt.classList.toggle('is-text', isText);
    $('#prompt-tail').textContent = q.tail;
    // « = 22 » sous « 70 − ? » n'est pas un ornement : c'est la moitié de
    // l'énoncé. Il s'écrit alors aussi gros qu'un nombre de la question.
    $('#prompt-tail').classList.toggle('fort', q.kind === 'hole' || q.kind === 'sign');
    replay(prompt, 'enter');
    A.sfx.whoosh();

    // Remplissage du losange
    $('#diamond').classList.toggle('wide-ans', isText);
    $$('.ans').forEach(el => {
      const slot = +el.dataset.slot;
      const ch = q.choices[slot];
      el.querySelector('.ans-val').textContent = ch.label;
      el.classList.toggle('op-mode', isText);
      el.classList.toggle('sign-mode', q.kind === 'sign');
      const bz = document.createElement('div');
      bz.className = 'buzzers';
      el.appendChild(bz);
    });

    // La voix : elle peut mentir (chausse-trappe « MAÎTRE MENTEUR »). Les
    // nombres partent en LETTRES, la synthèse n'a aucun chiffre à deviner.
    if (!(trap && trap.silent)) {
      const leurre = trap && trap.speakInstead && trap.speakInstead(q);
      if (leurre) A.say(Ops.dire(leurre.op, leurre.a, leurre.b), 'quiz');
      else if (q.kind === 'result') A.say(Ops.dire(q.op, q.a, q.b), 'quiz');
      else if (q.kind === 'hole') A.say(Ops.direTrou(q.op, q.a, q.b, q.side), 'quiz');
    }

    // Un calcul à deux chiffres reçoit plus de temps qu'un fait de table
    // (`q.timeMul`). En sprint, la cloche peut tomber avant : elle écourte la
    // question sans toucher à la durée de référence du bonus de vitesse.
    roundDurFull = cfg.timeBase * (trap ? (trap.timeMul || 1) : 1) * (q.timeMul || 1);
    roundStart = sceneNow();
    budgetQuestion = sprint() ? cfg.sprintMs - spent : Infinity;
    roundDur = Math.min(roundDurFull, budgetQuestion);
    if (trap && trap.onShow) trap.onShow(ui, q);
    scheduleDeadline();
    startTimer();
  }

  /* ─── Chronomètre ───────────────────────────────────────────────── */
  function startTimer() {
    const fill = $('#timer-fill');
    const rail = $('.timer-rail');
    let lastTickBucket = -1;

    function frame() {
      if (phase !== 'show' || paused) return;
      const el = sceneNow() - roundStart;
      const left = graceStart == null ? clamp(1 - el / roundDur, 0, 1)
        : graceFill * clamp((roundDur - el) / (roundDur - graceStart), 0, 1);
      fill.style.transform = `scaleX(${left})`;
      if (sprint()) $('#round-now').textContent = horloge(resteSprint());

      if (left < 0.34) {
        rail.classList.add('panic');
        const bucket = Math.floor(el / 220);
        if (bucket !== lastTickBucket) { lastTickBucket = bucket; A.sfx.tick(true); }
      } else {
        const bucket = Math.floor(el / 520);
        if (bucket !== lastTickBucket) { lastTickBucket = bucket; A.sfx.tick(false); }
      }

      rafTimer = requestAnimationFrame(frame);
    }
    rafTimer = requestAnimationFrame(frame);
  }

  function scheduleDeadline() {
    cancelLater(deadlineTimer);
    deadlineTimer = later(roundDur - (sceneNow() - roundStart), echeance);
  }
  /* Fin du temps d'une question. En sprint, la cloche peut tomber en plein
     calcul : si personne ne s'est prononcé, la question n'est PAS jugée —
     personne n'a « raté » ce qu'il n'a pas eu le temps de finir. */
  function echeance() {
    if (clocheSonne() && firstAnswerId == null) finish();
    else resolve();
  }
  function stopTimer() { if (rafTimer != null) cancelAnimationFrame(rafTimer); rafTimer = null; }

  /* La pause coupe le son mais conserve le temps de jeu, jusque dans les
     annonces, les pièges à mémoire et la correction. */
  function setPaused(on) {
    const changed = on !== paused;
    paused = on;
    $('#screen-game').classList.toggle('paused', on);
    $('#pause-panel').setAttribute('aria-hidden', String(!on));
    MX.Input.mode = on ? 'paused' : phase === 'idle' ? 'idle' : 'play';
    if (changed && MX.UI && MX.UI.onPauseChange) MX.UI.onPauseChange(on);
  }
  function pause() {
    if (phase === 'idle' || paused) return;
    pausedAt = performance.now();
    setPaused(true);
    stopTimer();
    pendingTimeouts.forEach(timer => { clearTimeout(timer.id); timer.id = null; });
    A.cancel();
    // La parole interrompue n'est pas rejouée ; le plancher de lecture
    // reste, lui, à terminer dans le temps de jeu.
    if (speechFinish) speechFinish();
  }
  function resume() {
    if (!paused || phase === 'idle') return;
    pausedTotal += performance.now() - pausedAt;
    setPaused(false);
    pendingTimeouts.forEach(arm);
    if (phase === 'show' && !players.every(p => answers[p.id] != null)) startTimer();
  }
  function togglePause() { if (paused) resume(); else pause(); }
  function endEarly() { if (phase !== 'idle') finish(true); }

  /* ─── Un joueur appuie ──────────────────────────────────────────── */
  /* Retour NEUTRE, et c'est délibéré : tant que le chrono tourne, rien à
     l'écran ni au son ne doit dire si la case choisie est la bonne. Un
     « ding » de bonne réponse désigne la case aux joueurs qui n'ont pas
     encore appuyé, et ils recopient — l'exercice ne vaut plus rien pour
     eux. Le verdict n'arrive qu'à la révélation, chrono écoulé. */
  function onBuzz(pid, slot) {
    if (phase !== 'show' || paused || !Number.isInteger(slot) || !q.choices[slot]) return;
    if (sceneNow() - roundStart >= roundDur) { echeance(); return; }
    const p = players[pid];
    if (!p || answers[pid] != null) return;

    answers[pid] = slot;
    p.ms = sceneNow() - roundStart;
    const el = $(`.ans[data-slot="${slot}"]`);

    // Pastille de couleur du joueur sur la case choisie : on montre QUI a
    // choisi QUOI — jamais si c'est juste.
    const bz = el.querySelector('.buzzers');
    if (bz) {
      const dot = document.createElement('span');
      dot.className = 'buzz-dot';
      dot.style.setProperty('--pc', p.color);
      bz.appendChild(dot);
    }
    replay(el, 'hit');
    A.sfx.buzz();
    const c = FX.centerOf(el);
    FX.chalkDust(c.x, c.y, 16);          // craie blanche : aucune couleur ne juge

    // Le premier qui se prononce écourte le chrono sans le couper : les
    // autres ont encore une poignée de dixièmes pour tenter leur chance.
    if (firstAnswerId == null) {
      firstAnswerId = pid;
      const elapsed = sceneNow() - roundStart;
      if (roundDur - elapsed > cfg.graceMs) {
        graceStart = elapsed;
        graceFill = clamp(1 - elapsed / roundDur, 0, 1);
        roundDur = elapsed + cfg.graceMs;
        scheduleDeadline();
      }
      $('.timer-rail').classList.remove('panic');
      $('.timer-rail').classList.add('grace');
    }
    // Retenu en silence : ne sert qu'au bonus « premier » au décompte.
    if (firstRightId == null && q.choices[slot].correct) firstRightId = pid;

    // Tout le monde s'est prononcé → on n'attend pas le chrono pour rien.
    // Le temps de réponse se fige ICI : le court délai qui suit n'est pas
    // du temps de calcul, le sprint ne doit pas le décompter.
    if (players.every(pp => answers[pp.id] != null)) {
      finReponses = sceneNow() - roundStart;
      stopTimer();
      cancelLater(deadlineTimer);
      later(300, resolve);
    }
  }

  /* ─── Résolution ────────────────────────────────────────────────── */
  function resolve() {
    if (phase !== 'show' || paused) return;  // le chrono et le dernier
    stopTimer();                              // buzz peuvent arriver ensemble
    clearLater();
    // En sprint, la cloche peut tomber pendant la fenêtre de rattrapage :
    // ceux qu'elle a coupés ne sont pas comptés « sans réponse ».
    const cloche = clocheSonne() && !players.every(p => answers[p.id] != null);
    // Sans AUCUNE bonne réponse, la question coûte au sprint son temps plein,
    // même si l'on s'est trompé vite : sinon appuyer au hasard tout de suite
    // rapporte plus que calculer (mesuré : 198 calculs tentés en une minute).
    const consomme = firstRightId == null ? Math.min(roundDurFull, budgetQuestion) : tempsDeReponse();
    spent = cloche ? cfg.sprintMs : spent + consomme;
    phase = 'resolve';
    evaluated++;
    A.cancel();

    // L'issue se déduit de ce qui s'est passé, plutôt que d'être passée en
    // paramètre : plusieurs chemins mènent ici (chrono, dernier buzz…).
    const answeredAll = players.every(p => answers[p.id] != null);
    const outcome = firstRightId != null ? 'right'
                  : answeredAll           ? 'allwrong'
                  : 'timeout';
    // On redonne à voir l'énoncé et on dégage la vue : la correction doit
    // être lisible.
    ui.hidePrompt(false);
    $('.timer-rail').classList.remove('panic', 'grace');

    // Révélation : c'est ICI, et nulle part avant, que le juste et le faux
    // se voient. Tout le monde a fini de répondre, plus personne ne peut
    // recopier. Le son et le tampon du verdict viennent plus bas, avec l'issue.
    let bonneCase = null;
    $$('.ans').forEach(el => {
      const ch = q.choices[+el.dataset.slot];
      el.classList.add(ch.correct ? 'reveal-good' : 'reveal-bad', 'locked');
      if (ch.correct) bonneCase = el;
    });
    $('#timer-fill').style.transform = 'scaleX(0)';
    if (sprint()) $('#round-now').textContent = horloge(resteSprint());

    const bon = (p) => answers[p.id] != null && q.choices[answers[p.id]].correct;
    const coupe = (p) => cloche && answers[p.id] == null;
    const someoneMissed = players.some(p => !bon(p) && !coupe(p));

    // La correction écrite répond d'abord à la question POSÉE (le nombre
    // manquant, le signe, la ligne fausse), puis donne le fait complet.
    const feedback = $('#round-feedback');
    feedback.textContent =
        q.kind === 'intruder' ? `${Ops.ecrire(q.op, q.a, q.b)} = ${q.wrongShown} était la ligne fausse. ${q.fait}.`
      : q.kind === 'hole'     ? `Le nombre manquant était ${q.answer}. ${q.fait}.`
      : q.kind === 'sign'     ? `Le signe effacé était ${q.answer}. ${q.fait}.`
      : q.fait;
    if (someoneMissed) feedback.textContent += ' ' + Ops.astuce(q);
    feedback.classList.add('show');

    const scoreMul = trap ? (trap.scoreMul || 1) : 1;
    const malus = !!(trap && trap.malus);

    // Points
    const tally = bilan[q.key] || (bilan[q.key] = { ok: 0, ko: 0 });
    players.forEach(p => {
      if (coupe(p)) return;
      const slot = answers[p.id];
      const answered = slot != null;
      const good = bon(p);
      const op = p.parOp[q.op] || (p.parOp[q.op] = { ok: 0, total: 0 });
      op.total++;

      if (good) {
        p.right++; p.streak++; op.ok++; tally.ok++;
        p.bestStreak = Math.max(p.bestStreak, p.streak);
        if (p.bestMs == null || p.ms < p.bestMs) p.bestMs = p.ms;

        // Bonus vitesse mesuré sur la durée INITIALE : la fenêtre de grâce
        // raccourcit roundDur, elle ne doit pas gonfler les points.
        const speedBonus = Math.round(120 * clamp(1 - p.ms / roundDurFull, 0, 1));
        const firstBonus = p.id === firstRightId ? 60 : 0;
        const comboMul = p.streak >= 8 ? 2 : p.streak >= 5 ? 1.5 : p.streak >= 3 ? 1.2 : 1;
        const pts = Math.round((100 + speedBonus + firstBonus) * comboMul * scoreMul / 10) * 10;
        addScore(p, pts);
        if (comboMul > 1) showCombo(p, comboMul);
      } else {
        if (answered) p.wrong++; else p.none++;
        p.streak = 0; tally.ko++;
        // On compte sur la clé normalisée : 3×8 et 8×3 sont le même fait
        // à mémoriser, le carnet ne doit pas les lister deux fois.
        const miss = p.misses[q.key] || (p.misses[q.key] = { n: 0, fait: q.fait });
        miss.n++; miss.fait = q.fait;
        Q.registerMiss(q.key);
        if (answered) {
          if (malus) addScore(p, -80);
          // Le piquet, la casse et le klaxon arrivent à la révélation : avant,
          // ils désignaient la mauvaise case à tous les autres.
          $('#desk-' + p.id).classList.add('stunned');
          const faux = $(`.ans[data-slot="${slot}"]`);
          faux.classList.add('chosen');           // l'ardoise choisie à tort vacille
          const c = FX.centerOf(faux);
          FX.shards(c.x, c.y, 16, '#ff2b45');
        }
      }
      // La série en cours, sur le pupitre : visible seulement à la révélation.
      $('#desk-' + p.id).querySelector('.streak').textContent = p.streak >= 2 ? 'série ' + p.streak : '';
    });

    // Le verdict, au son et à l'œil. Il dit l'issue de la CLASSE : la bonne
    // case se montre toujours, mais une manche ratée ne sonne jamais comme
    // une victoire — la fanfare par-dessus l'échec disait « bravo » à tort.
    const someoneWrong = players.some(p => answers[p.id] != null && !q.choices[answers[p.id]].correct);
    const personne = players.every(p => answers[p.id] == null);
    // Le tampon commun ne tombe que sur une issue partagée par tous : quand
    // les uns trouvent et les autres non, les pupitres disent qui a quoi.
    const verdict = outcome === 'right' ? (someoneMissed ? null : 'win') : personne ? 'late' : 'lose';
    $('#diamond').classList.add(outcome === 'right' ? 'verdict-win' : 'verdict-lose');
    if (verdict) {
      const v = $('#verdict');
      v.textContent = VERDICTS[verdict];
      v.className = 'verdict ' + verdict;
    }
    const ici = FX.centerOf(bonneCase);

    // Réaction du maître
    let cat, mood, tone;
    if (outcome === 'right') {
      const w = players[firstRightId];
      const veryFast = w && w.ms != null && w.ms < roundDurFull * 0.32;
      cat = veryFast ? 'fast' : 'good';
      mood = 'pleased'; tone = 'proud';
      A.sfx.win();
      FX.flash('good');
      FX.confetti(ici.x, ici.y, someoneMissed ? 26 : 48);
      FX.stars(ici.x, ici.y, someoneMissed ? 6 : 12);
    } else {
      // Seul, « TOUS FAUX ! » ne s'adresse à personne : c'est une erreur ordinaire.
      if (outcome === 'allwrong') { cat = players.length > 1 ? 'allWrong' : 'wrong'; mood = 'rage'; }
      else { cat = 'timeout'; mood = 'dead'; }
      tone = 'angry';
      A.sfx.lose(sprint());      // le sprint n'a pas le temps d'une longue plainte
      A.sfx.slam();
      FX.flash();
      FX.shake(outcome === 'allwrong' ? 'l' : 'm');
    }

    // Quelqu'un s'est trompé alors qu'un autre a trouvé → klaxon quand même,
    // APRÈS la fanfare et non dessous, et une fois sur deux le maître préfère
    // engueuler plutôt que féliciter.
    if (outcome === 'right' && someoneWrong) {
      later(380, () => { A.sfx.wrong(); FX.shake('s'); });
      if (Math.random() < 0.5) { cat = 'wrong'; mood = 'rage'; tone = 'angry'; }
    }
    Teach.setMood($('#teacher-slot'), mood);

    // Le sprint ne s'arrête pas pour commenter : le maître réagit dans son
    // coin, et la voix ne redit le calcul que s'il a été raté — c'est le
    // seul moment où le rythme doit céder à la mémorisation.
    if (sprint()) {
      if (someoneMissed) speakThen(Teach.rappel(q), 'calm', 1900, nextRound);
      else later(750, nextRound);
      return;
    }

    // On laisse d'abord respirer la correction : la bonne case en vert,
    // les croix rouges, sans rien qui la masque. Le maître ne déboule
    // qu'ensuite — et le contraste calme → explosion rend son entrée
    // beaucoup plus drôle.
    const l = Teach.line(cat, q);
    // Puis on attend qu'il ait FINI sa phrase, plutôt qu'un délai en dur :
    // elle contient le rappel « sept fois huit, cinquante-six », qui est la
    // raison d'être de tout cet écran.
    const REVEAL = someoneMissed ? 1300 : 800;
    const RANT_MIN = someoneMissed ? 2300 : 1400;
    later(REVEAL, () => burst(l.shout, mood, l.speech, tone, RANT_MIN,
                              () => { hideBurst(); nextRound(); }));
  }

  function addScore(p, pts) {
    p.score = Math.max(0, p.score + pts);
    const desk = $('#desk-' + p.id);
    desk.querySelector('.desk-score').textContent = p.score;
    replay(desk, 'gain');
    const f = document.createElement('span');
    f.className = 'float-pts';
    f.textContent = (pts > 0 ? '+' : '') + pts;
    f.style.color = pts > 0 ? 'var(--chalk-cyan)' : 'var(--rage)';
    desk.appendChild(f);
    later(950, () => f.remove());
  }

  function showCombo(p, mul) {
    const n = $('#combo-note');
    n.textContent = `${p.name} · SÉRIE ×${mul}`;
    n.style.color = p.color;
    replay(n, 'show');
  }

  /* ─── Gros plan du maître ───────────────────────────────────────── */
  /* `minMs` + `done` : enchaîner sur la FIN de la réplique (cf. speakThen).
     Sans `done`, la bulle parle et le maître reste à l'écran. */
  function burst(text, mood, speech, tone, minMs, done) {
    const b = $('#teacher-burst');
    $('#burst-bubble').textContent = text;
    $('#burst-bubble').className = 'burst-bubble' +
      (mood === 'pleased' ? ' good' : mood === 'sly' ? ' trap' : '');
    Teach.setMood($('#burst-face'), mood);
    Teach.setMood($('#teacher-slot'), mood);
    b.className = 'teacher-burst on mood-' + mood + (phase === 'resolve' ? ' correction' : '');
    if (done) speakThen(speech, tone, minMs || 1200, done);
    else if (speech) A.say(speech, tone);
  }
  function hideBurst() { $('#teacher-burst').classList.remove('on'); }

  /* ─── Fin de partie ─────────────────────────────────────────────── */
  /* L'appréciation du bulletin : le maître reste ronchon, jamais blessant.
     Elle dit où on en est, pas ce qu'on vaut. */
  function appreciation(pct) {
    return pct >= 95 ? 'Félicitations du maître. Ça l\'agace.'
         : pct >= 80 ? 'Très bien. Presque trop.'
         : pct >= 60 ? 'Bien. On tient le bon bout.'
         : pct >= 40 ? 'Ça vient. On révise le carnet !'
         :             'On reprend ça ensemble, tranquillement.';
  }

  function progression(interrupted) {
    const n = evaluated, calculs = `${n} calcul${n > 1 ? 's' : ''}`;
    if (interrupted) {
      if (!round) return 'Partie interrompue avant la première question.';
      return sprint() ? `Sprint interrompu après ${calculs}.`
        : `Partie interrompue à la question ${round} sur ${cfg.rounds}.`;
    }
    if (sprint()) return `La cloche a sonné : ${calculs} en ${cfg.sprintMs / 1000} secondes.`;
    return (cfg.faits ? 'Révision terminée : ' : 'Partie terminée : ') + `${cfg.rounds} questions.`;
  }

  function finish(interrupted) {
    stopTimer();
    clearLater();
    phase = 'idle';
    setPaused(false);
    hideBurst();
    A.cancel();
    A.sfx.bell();
    const l = Teach.line('end');
    A.say(l.speech, 'angry');
    $('#end-progress').textContent = progression(interrupted);

    const ranked = players.slice().sort((a, b) => b.score - a.score);

    // Podium
    const pod = $('#podium');
    pod.innerHTML = '';
    let rank = 0;
    ranked.forEach((p, i) => {
      if (i === 0 || p.score !== ranked[i - 1].score) rank = i + 1;
      const tied = (i > 0 && p.score === ranked[i - 1].score)
        || (i + 1 < ranked.length && p.score === ranked[i + 1].score);
      const total = p.right + p.wrong + p.none;
      const pct = total ? Math.round(100 * p.right / total) : 0;
      // Le détail par opération n'a d'intérêt que s'il y en a plusieurs.
      const parOp = Ops.LIST.filter(op => p.parOp[op]);
      const detail = parOp.length > 1
        ? '<br>' + parOp.map(op => `${Ops.DEF[op].signe} ${p.parOp[op].ok}/${p.parOp[op].total}`).join(' · ') : '';
      const el = document.createElement('div');
      el.className = 'pod' + (rank === 1 ? ' first' : '');
      el.style.setProperty('--pc', p.color);
      el.style.setProperty('--d', (i * 0.12) + 's');
      el.innerHTML = `
        <div class="rank">${rank === 1 ? '1er' : rank + 'e'}${tied ? ' ex æquo' : ''}</div>
        <div class="pod-name">${p.name}</div>
        <div class="pod-score">${p.score}</div>
        <div class="pod-stat">${p.right} bonnes / ${total} ${total === 1 ? 'question évaluée' : 'questions évaluées'} · ${pct} %${detail}<br>meilleure série : ${p.bestStreak}
          ${p.bestMs != null ? '<br>éclair : ' + (p.bestMs / 1000).toFixed(2) + ' s' : ''}</div>
        ${total ? `<div class="pod-note">${appreciation(pct)}</div>` : ''}`;
      pod.appendChild(el);
    });

    // Le carnet du maître : ce qu'il faut revoir. C'est la sortie utile
    // pour le parent, une fois les rires terminés.
    const nb = $('#notebook');
    nb.innerHTML = '<h3>Le carnet du maître — à revoir</h3>';
    let any = false;
    players.forEach(p => {
      const list = Object.values(p.misses).sort((a, b) => b.n - a.n);
      const line = document.createElement('div');
      line.className = 'nb-line';
      line.style.setProperty('--pc', p.color);
      if (!list.length) {
        line.innerHTML = `<b>${p.name}</b> — ` +
          (p.right ? 'tout est juste !' : 'aucune réponse évaluée.');
      } else {
        any = true;
        line.innerHTML = `<b>${p.name}</b> — ` +
          list.map(m => `<code>${m.fait}</code>${m.n > 1 ? '(×' + m.n + ')' : ''}`).join(' ');
      }
      nb.appendChild(line);
    });
    if (!any) {
      const ok = document.createElement('div');
      ok.className = 'nb-line nb-empty';
      ok.textContent = players.some(p => p.right)
        ? 'Bravo ! Les questions jouées sont maîtrisées.' : 'Tu peux relancer une partie quand tu es prêt.';
      nb.appendChild(ok);
    }

    // L'accueil tient la mémoire d'une partie à l'autre (carnet, records) :
    // il reçoit le bilan AVANT que le bulletin s'affiche.
    if (MX.UI.onGameEnd) {
      MX.UI.onGameEnd({
        interrupted: !!interrupted, revision: !!cfg.faits, bilan,
        best: ranked.length ? ranked[0].score : 0,
      });
    }
    MX.UI.goto('end');
    later(260, () => {
      FX.confetti(window.innerWidth * 0.3, window.innerHeight * 0.5, 60);
      FX.confetti(window.innerWidth * 0.7, window.innerHeight * 0.5, 60);
    });
  }

  return { setup, begin, onBuzz, pause, resume, togglePause, endEarly,
           get phase() { return phase; }, get paused() { return paused; },
           get round() { return round; },
           get cfg() { return cfg; },
           get bilan() { return bilan; },
           get players() { return players; } };
})();
