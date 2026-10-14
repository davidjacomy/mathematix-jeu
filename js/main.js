/* ══════════════════════════════════════════════════════════════════
   main.js — écran d'accueil, inscription des joueurs, aiguillage

   L'accueil pose trois questions, dans cet ordre : QUOI réviser (les
   opérations et leur portée), COMMENT jouer (la façon de jouer, sa durée,
   son niveau), QUI joue.

   Le niveau fonctionne à deux étages : quatre niveaux tout faits, et un
   mode sur mesure où chaque paramètre se règle séparément. Cliquer un
   niveau remplit les réglages fins ; toucher un réglage fin bascule
   automatiquement en « sur mesure ». On peut donc partir d'un niveau
   connu et n'ajuster qu'une chose.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  const { $, $$, pick } = MX.U;
  const A = MX.Audio, FX = MX.FX, In = MX.Input, G = MX.Game, Teach = MX.Teacher,
        Q = MX.Questions, T = MX.Traps, Ops = MX.Ops, Mem = MX.Memoire;

  let screen = 'title';
  let audioReady = false;
  let menuDevice = null;
  let previewKey = '';
  let preview = { texte: '', nbFaits: 0 };
  let ratesDuJour = [];            // calculs ratés dans la partie qui vient de finir
  const REVISION_MAX = 20;         // calculs par partie de révision : au-delà, c'est trop long
  const STORAGE_KEY = 'mathematix.settings.v1';
  const ANCIENNE_CLE = 'multiplix.settings.v1';   // réglages d'avant les quatre opérations

  /* ─── Valeurs possibles de chaque réglage ───────────────────────────
     Les niveaux tout faits piochent OBLIGATOIREMENT là-dedans. Sans cette
     source unique, un niveau pouvait valoir 15 % de pièges alors que le
     panneau ne propose que 0, 18, 42… : aucun bouton ne s'allumait et on
     ne voyait plus où on en était. */
  const OPT = {
    time:   { lent: 8000, pose: 6500, normal: 5500, vif: 4200, eclair: 3000 },
    traps:  { aucune: 0, rares: 0.18, normales: 0.42, souvent: 0.55, partout: 0.75 },
    grace:  { aucun: 0, court: 1000, moyen: 1500, long: 2500 },
    hole:   { jamais: 0, parfois: 0.2, souvent: 1 / 3 },
    rounds: [10, 15, 25],          // leçon : nombre de questions
    sprint: [60, 90, 120],         // sprint : secondes avant la cloche
  };

  /* ─── Niveaux tout faits ────────────────────────────────────────── */
  const PRESETS = {
    decouverte:   { label: 'Découverte',   timeBase: OPT.time.lent, mix: 'facile', trapRate: OPT.traps.aucune, graceMs: OPT.grace.long, bothWays: false, holeRate: OPT.hole.jamais },
    entrainement: { label: 'Entraînement', timeBase: OPT.time.pose, mix: 'equilibre', trapRate: OPT.traps.rares, graceMs: OPT.grace.long, bothWays: true, holeRate: OPT.hole.parfois },
    defi:         { label: 'Défi', timeBase: OPT.time.vif, mix: 'dur', trapRate: OPT.traps.souvent, graceMs: OPT.grace.court, bothWays: true, holeRate: OPT.hole.souvent },
    terreur:      { label: 'Terreur', timeBase: OPT.time.eclair, mix: 'dur', trapRate: OPT.traps.partout, graceMs: OPT.grace.aucun, bothWays: true, holeRate: OPT.hole.souvent },
  };

  const state = {
    ops: Ops.LIST.slice(),
    tables: [2, 3, 4, 5, 6, 7, 8, 9],
    nombres: 20,
    mode: 'lecon',
    rounds: 15,
    sprint: 90,
    voice: true,
    preset: 'entrainement',
    ...PRESETS.entrainement,
  };
  delete state.label;

  const famille = (nom) => state.ops.some(op => Ops.DEF[op].famille === nom);

  function lireReglages() {
    try {
      const neuf = localStorage.getItem(STORAGE_KEY);
      if (neuf) return JSON.parse(neuf);
      // Avant MATHÉMATIX, le jeu ne connaissait que la multiplication : qui
      // revient avec ses anciens réglages retrouve SA partie, pas un mélange
      // qu'il n'a jamais choisi.
      const ancien = JSON.parse(localStorage.getItem(ANCIENNE_CLE));
      return ancien && typeof ancien === 'object' ? Object.assign({ ops: ['×'] }, ancien) : null;
    } catch (_) { return null; }   // stockage refusé ou réglage illisible
  }

  function restoreSettings() {
    const saved = lireReglages();
    if (saved && typeof saved === 'object') {
      if (Array.isArray(saved.ops)) {
        const valid = Ops.LIST.filter(op => saved.ops.includes(op));
        if (valid.length) state.ops = valid;
      }
      if (Array.isArray(saved.tables)) {
        const valid = Ops.TABLES.filter(n => saved.tables.includes(n));
        if (valid.length) state.tables = valid;
      }
      if (Ops.NOMBRES.includes(saved.nombres)) state.nombres = saved.nombres;
      if (saved.mode === 'lecon' || saved.mode === 'sprint') state.mode = saved.mode;
      if (OPT.rounds.includes(saved.rounds)) state.rounds = saved.rounds;
      if (OPT.sprint.includes(saved.sprint)) state.sprint = saved.sprint;
      if (typeof saved.voice === 'boolean') state.voice = saved.voice;
      if (Object.prototype.hasOwnProperty.call(PRESETS, saved.preset)) {
        applyPreset(saved.preset);
      } else if (saved.preset === 'custom') {
        const allowed = { timeBase: OPT.time, trapRate: OPT.traps, graceMs: OPT.grace, holeRate: OPT.hole };
        Object.entries(allowed).forEach(([key, values]) => {
          if (Object.values(values).includes(saved[key])) state[key] = saved[key];
        });
        if (['facile', 'equilibre', 'dur'].includes(saved.mix)) state.mix = saved.mix;
        if (typeof saved.bothWays === 'boolean') state.bothWays = saved.bothWays;
        state.preset = 'custom';
      }
    }
    A.enabled = state.voice;
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  const segs = {};          // id → { refresh() }

  /* ─── Navigation entre écrans ───────────────────────────────────── */
  MX.UI = {
    goto(name) {
      screen = name;
      $$('.screen').forEach(s => s.classList.remove('is-active'));
      $('#screen-' + name).classList.add('is-active');
      // On relâche le focus : sinon Entrée activerait le dernier bouton
      // cliqué au lieu de passer par le jeu.
      if (document.activeElement && document.activeElement.blur)
        document.activeElement.blur();
      $$('.screen').forEach(s => { s.inert = s.id !== 'screen-' + name; });
      if (name === 'end') $('#btn-again').focus({ preventScroll: true });
    },
    onPauseChange(paused) {
      In.mode = paused ? 'paused' : G.phase === 'idle' ? 'idle' : 'play';
      $$('#screen-game > :not(.pause-veil)').forEach(el => { el.inert = paused; });
      $('#pause-veil').inert = !paused;
      if (paused) $('#btn-resume').focus();
      else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    },
    /* La partie vient de finir : le maître met son carnet à jour, et le
       bulletin apprend ce qu'il peut proposer de revoir. */
    onGameEnd(fin) {
      Mem.noter(fin.bilan);
      ratesDuJour = Object.keys(fin.bilan).filter(cle => fin.bilan[cle].ko > 0);
      const n = ratesDuJour.length;
      $('#btn-review').hidden = n === 0;
      $('#btn-review').textContent = n > REVISION_MAX ? `Revoir ${REVISION_MAX} de ces calculs tout de suite`
        : n > 1 ? `Revoir ces ${n} calculs tout de suite` : 'Revoir ce calcul tout de suite';

      // Un record ne se compare qu'entre parties comparables : menées à leur
      // terme, sur le même réglage. Une révision n'en est pas une.
      let texte = '';
      if (!fin.interrupted && !fin.revision && fin.best > 0) {
        const r = Mem.record(signature(G.cfg), fin.best);
        texte = !r.battu ? `Record de la maison sur ce réglage : ${r.record} points. À battre !`
          : r.ancien == null ? `Premier record de la maison sur ce réglage : ${fin.best} points.`
          : `Record de la maison battu : ${fin.best} points — l'ancien était de ${r.ancien}.`;
      }
      $('#end-record').textContent = texte;
    },
    get screen() { return screen; },
  };

  /** Ce qui rend deux parties comparables pour un record. */
  function signature(c) {
    const a = (nom) => c.ops.some(op => Ops.DEF[op].famille === nom);
    const sprint = c.mode === 'sprint';
    return JSON.stringify([c.mode, c.ops.join(''), a('add') ? c.nombres : 0, a('mul') ? c.tables.join('.') : '',
      sprint ? c.sprintMs : c.rounds, c.timeBase, c.mix, sprint ? 0 : c.trapRate, c.bothWays, c.holeRate]);
  }

  /** Le premier geste réel de l'utilisateur débloque son et voix. */
  function unlockAudio() {
    // Un lancement à la manette peut laisser le contexte suspendu. Un
    // clic/appui ultérieur doit pouvoir le reprendre, même après l'init.
    A.init();
    if (audioReady) return;
    audioReady = true;
    A.enabled = state.voice;
    refreshLegend();
  }

  /* ─── Décor : le tableau n'a pas été effacé ─────────────────────── */
  function buildScribbles() {
    const box = $('#slate-scribbles');
    box.innerHTML = '';
    const R = (a, b) => a + Math.random() * (b - a);
    const faits = Ops.catalogue(Ops.LIST, { tables: Ops.TABLES, nombres: 20 });
    for (let i = 0; i < 26; i++) {
      const f = pick(faits);
      const [a, b] = pick(Ops.sens(f, true));
      // Une sur cinq est fausse et barrée : le maître est passé par là.
      const wrong = Math.random() < 0.2;
      const s = document.createElement('span');
      s.className = 'scribble' + (wrong ? ' struck' : '');
      s.textContent = `${Ops.ecrire(f.op, a, b)} = ${Ops.calc(f.op, a, b) + (wrong ? (Math.random() < .5 ? 1 : 10) : 0)}`;
      s.style.left = R(-4, 92) + 'vw';
      s.style.top = R(-2, 96) + 'vh';
      s.style.fontSize = R(15, 54).toFixed(0) + 'px';
      s.style.transform = `rotate(${R(-16, 16).toFixed(1)}deg)`;
      box.appendChild(s);
    }
  }

  /* ─── Pupitres d'inscription ────────────────────────────────────── */
  function buildJoinSlots() {
    const row = $('#join-row');
    row.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'slot';
      el.id = 'slot-' + i;
      el.style.setProperty('--pc', `var(--p${i + 1})`);
      el.style.setProperty('--tilt', (i % 2 ? 1.2 : -1.2) + 'deg');
      el.innerHTML = `<div class="slot-num">${i + 1}</div>
                      <span class="slot-state">libre</span>
                      <span class="slot-dev"></span>`;
      row.appendChild(el);
      el.addEventListener('click', () => {
        unlockAudio();
        if (In.players[i]) {
          In.removePlayer(i);
        } else {
          const device = menuDevice || In.freeDevices().find(d => d.type === 'kb');
          if (device) In.joinDevice(device);
        }
        refreshJoinSlots();
      });
    }
  }

  function refreshJoinSlots() {
    for (let i = 0; i < 4; i++) {
      const el = $('#slot-' + i);
      const p = In.players[i];
      el.classList.toggle('joined', !!p);
      el.querySelector('.slot-state').textContent = p ? 'PRÊT' : 'libre';
      el.querySelector('.slot-dev').textContent = p ? In.deviceLabel(p.device) : '';
      el.setAttribute('aria-label', p ? `Retirer le joueur ${i + 1}, ${In.deviceLabel(p.device)}` : 'Ajouter un joueur');
      el.title = p ? 'Cliquer pour retirer ce joueur' : 'Cliquer pour ajouter un joueur au clavier';
    }
    const n = In.players.length;
    $('#btn-start').disabled = n === 0;
    $('#join-hint').innerHTML = n === 0
      ? 'Seul : « Jouer à la souris ». À plusieurs : <b>A / Croix</b> sur ta manette, ou une touche de ton pupitre.'
      : n < 4
        ? `${n} élève${n > 1 ? 's' : ''} en classe. Les autres peuvent encore s'inscrire.`
        : 'Classe complète ! En place !';
    $('#btn-keyboard').disabled = n >= 4 || !In.freeDevices().some(d => d.type === 'kb');
    $('#btn-solo').disabled = n >= 4 && !In.players.some(p => p.device.type === 'pointer');
    $('#btn-solo').textContent = n ? 'Ajouter la souris / le toucher' : 'Jouer à la souris ou au toucher';
  }

  /* ─── Un groupe de boutons exclusifs ────────────────────────────── */
  function seg(sel, items, get, set) {
    const box = $(sel);
    box.innerHTML = '';
    box.setAttribute('role', 'group');
    const label = box.parentElement.querySelector('.setting-label');
    if (label) box.setAttribute('aria-label', label.textContent);
    const btns = items.map(it => {
      const b = document.createElement('button');
      b.className = 'chip wide' + (it.cls ? ' ' + it.cls : '');
      b.type = 'button';
      b.textContent = it.t;
      if (it.title) b.title = it.title;
      b.addEventListener('click', () => {
        unlockAudio();
        set(it.v);
        A.sfx.buzz();
        refreshAllSegs();
      });
      box.appendChild(b);
      return { b, v: it.v };
    });
    const api = {
      refresh() { btns.forEach(({ b, v }) => {
        const selected = get() === v;
        b.classList.toggle('on', selected);
        b.setAttribute('aria-pressed', String(selected));
      }); },
    };
    segs[sel] = api;
    api.refresh();
    return api;
  }

  /** Remet tout l'accueil d'accord avec `state`. */
  function refreshAllSegs() {
    Object.values(segs).forEach(s => s.refresh());
    $$('.op-tile').forEach(b => {
      const on = state.ops.includes(b.dataset.op);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $$('#table-toggles .chip').forEach(b => {
      const on = state.tables.includes(+b.dataset.table);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    // Une portée ne s'affiche que si une opération de sa famille est choisie.
    $('#scope-nombres').hidden = !famille('add');
    $('#scope-tables').hidden = !famille('mul');
    $('#group-count').hidden = state.mode !== 'lecon';
    $('#group-sprint').hidden = state.mode !== 'sprint';
    $('#custom-panel').classList.toggle('on', state.preset === 'custom');
    refreshPreview();
    saveSettings();
  }

  /** Passer un réglage fin fait automatiquement basculer en « sur mesure ». */
  function tweak(champ, valeur) {
    state[champ] = valeur;
    state.preset = 'custom';
  }

  function applyPreset(nom) {
    if (nom === 'custom') { state.preset = 'custom'; return; }
    Object.assign(state, PRESETS[nom]);
    delete state.label;
    state.preset = nom;
  }

  /* ─── Le programme : opérations et portées ──────────────────────── */
  const OP_CLASSE = { '+': 'add', '−': 'sub', '×': 'mul', '÷': 'div' };

  function buildProgramme() {
    const tiles = $('#op-tiles');
    tiles.innerHTML = '';
    for (const op of Ops.LIST) {
      const def = Ops.DEF[op];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'op-tile op-' + OP_CLASSE[op];
      b.dataset.op = op;
      b.setAttribute('aria-label', def.nom);
      b.innerHTML = `<span class="op-sign" aria-hidden="true">${def.signe}</span><span class="op-name">${def.nom}</span>`;
      b.addEventListener('click', () => {
        unlockAudio();
        if (state.ops.includes(op)) {
          if (state.ops.length === 1) {
            $('#programme-note').textContent = 'Garde au moins une opération au programme.';
            return;
          }
          state.ops = state.ops.filter(o => o !== op);
        } else {
          state.ops = Ops.LIST.filter(o => o === op || state.ops.includes(o));
        }
        A.sfx.buzz();
        refreshAllSegs();
      });
      tiles.appendChild(b);
    }

    seg('#seg-nombres', [
      { v: 10,  t: 'Jusqu\'à 10',  title: 'Les tout premiers calculs : 3 + 4, 9 − 2' },
      { v: 20,  t: 'Jusqu\'à 20',  title: 'Les tables d\'addition : 8 + 7, 15 − 8' },
      { v: 100, t: 'Jusqu\'à 100', title: 'Calcul mental à deux chiffres : 38 + 47, 52 − 38' },
    ], () => state.nombres, v => { state.nombres = v; });

    const tt = $('#table-toggles');
    tt.innerHTML = '';
    for (const n of Ops.TABLES) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = n;
      b.type = 'button';
      b.dataset.table = n;
      b.setAttribute('aria-label', 'Table de ' + n);
      b.addEventListener('click', () => {
        unlockAudio();
        if (state.tables.includes(n)) {
          if (state.tables.length === 1) {
            $('#programme-note').textContent = 'Garde au moins une table à réviser.';
            return;
          }
          state.tables = state.tables.filter(t => t !== n);
        } else {
          state.tables = Ops.TABLES.filter(t => t === n || state.tables.includes(t));
        }
        A.sfx.buzz();
        refreshAllSegs();
      });
      tt.appendChild(b);
    }
  }

  /* ─── La partie : façon de jouer, durée, niveau ─────────────────── */
  function buildSettings() {
    seg('#seg-mode', [
      { v: 'lecon',  t: 'La leçon',  title: 'Un nombre de questions fixé : le maître commente chaque calcul et tend ses pièges' },
      { v: 'sprint', t: 'Le sprint', title: 'Un maximum de calculs avant la cloche : correction brève, aucun piège' },
    ], () => state.mode, v => { state.mode = v; });

    seg('#seg-count', OPT.rounds.map(n => ({ v: n, t: String(n) })),
      () => state.rounds, v => { state.rounds = v; });

    seg('#seg-sprint', OPT.sprint.map(s => ({ v: s, t: s === 60 ? '1 min' : s === 90 ? '1 min 30' : '2 min' })),
      () => state.sprint, v => { state.sprint = v; });

    seg('#seg-preset',
      Object.keys(PRESETS).map(k => ({ v: k, t: PRESETS[k].label }))
        .concat([{ v: 'custom', t: 'Sur mesure', cls: 'custom' }]),
      () => state.preset, applyPreset);

    seg('#seg-voice', [{ v: true, t: 'Oui' }, { v: false, t: 'Non' }],
      () => state.voice, v => { state.voice = v; A.enabled = v; refreshLegend(); });

    /* ── Réglages fins ── */
    seg('#seg-time', [
      { v: OPT.time.lent, t: '8 s' }, { v: OPT.time.pose, t: '6,5 s' },
      { v: OPT.time.normal, t: '5,5 s' }, { v: OPT.time.vif, t: '4,2 s' },
      { v: OPT.time.eclair, t: '3 s' },
    ], () => state.timeBase, v => tweak('timeBase', v));

    seg('#seg-mix', [
      { v: 'facile',    t: 'Faciles d\'abord', title: 'Surtout ce qui se sait déjà : ×2, ×10, les doubles, les petits nombres' },
      { v: 'equilibre', t: 'Équilibré',        title: 'Autant de faciles que de difficiles' },
      { v: 'dur',       t: 'Ceux qui fâchent', title: 'Insiste sur 7 × 8, 56 ÷ 7, les retenues…' },
    ], () => state.mix, v => tweak('mix', v));

    seg('#seg-traps', [
      { v: OPT.traps.aucune, t: 'Aucune' }, { v: OPT.traps.rares, t: 'Rares' },
      { v: OPT.traps.normales, t: 'Normales' }, { v: OPT.traps.souvent, t: 'Souvent' },
      { v: OPT.traps.partout, t: 'Partout' },
    ], () => state.trapRate, v => tweak('trapRate', v));

    seg('#seg-grace', [
      { v: OPT.grace.aucun, t: 'Aucun', title: 'Le premier qui répond met fin à la question' },
      { v: OPT.grace.court, t: 'Court', title: '1 seconde pour les autres' },
      { v: OPT.grace.moyen, t: 'Moyen', title: '1,5 seconde pour les autres' },
      { v: OPT.grace.long,  t: 'Long',  title: '2,5 secondes pour les autres' },
    ], () => state.graceMs, v => tweak('graceMs', v));

    seg('#seg-sens', [
      { v: false, t: 'Le plus simple', title: 'Toujours « 3 × 8 », « 8 + 3 », « 11 − 3 », « 24 ÷ 3 »' },
      { v: true,  t: 'Les deux sens',  title: '« 3 × 8 » et « 8 × 3 », « 11 − 3 » et « 11 − 8 »' },
    ], () => state.bothWays, v => tweak('bothWays', v));

    seg('#seg-hole', [
      { v: OPT.hole.jamais, t: 'Jamais' },
      { v: OPT.hole.parfois, t: 'Parfois', title: 'Environ une question sur cinq' },
      { v: OPT.hole.souvent, t: 'Souvent', title: 'Environ une question sur trois' },
    ], () => state.holeRate, v => tweak('holeRate', v));
  }

  /* ─── Aperçu en français de ce que donneront les réglages ───────── */
  const fr = (n) => n.toString().replace('.', ',');

  function refreshPreview() {
    const sprint = state.mode === 'sprint';
    // Un sprint n'a pas de longueur fixe : on en simule une vraisemblable.
    const manches = sprint ? 20 : state.rounds;
    const trapRate = sprint ? 0 : state.trapRate;

    // L'unicité change le tirage au fil d'une partie. Une longue série
    // balayerait le catalogue et effacerait le dosage choisi par le parent :
    // on simule donc de VRAIES parties, courtes, remises à zéro entre elles.
    const key = JSON.stringify([state.ops, state.tables, state.nombres, state.mix, state.bothWays, state.holeRate, manches, trapRate]);
    if (key !== previewKey) {
      Q.configure({ ops: state.ops, tables: state.tables, nombres: state.nombres,
                    mix: state.mix, bothWays: state.bothWays, holeRate: state.holeRate });
      const contexte = Q.contexte;
      // Un programme de plusieurs milliers de calculs coûte plus cher à
      // simuler, et il lui faut moins de parties pour donner sa tendance.
      const samples = Q.nbFaits > 1000 ? 10 : 24, cat = { facile: 0, moyenne: 0, dure: 0 };
      let holes = 0;
      for (let session = 0; session < samples; session++) {
        Q.reset();
        let lastTrap = null;
        for (let round = 1; round <= manches; round++) {
          const trap = round > 2 && Math.random() < trapRate ? T.draw(lastTrap, contexte) : null;
          if (trap) lastTrap = trap.id;
          const q = Q.next({ kinds: (trap && trap.kinds) || ['result', 'hole'] });
          cat[Ops.niveau(q.d)]++;
          if (q.kind === 'hole') holes++;
        }
      }
      const total = samples * manches;
      const pct = n => Math.round(100 * n / total);
      preview = {
        nbFaits: Q.nbFaits,
        texte: `Sur des parties de cette durée : environ ${pct(cat.facile)} % de calculs faciles, ` +
          `${pct(cat.moyenne)} % moyens et ${pct(cat.dure)} % difficiles. ` +
          (state.holeRate ? `Environ ${pct(holes)} % de questions à nombre manquant, selon les pièges et les formes disponibles.` : 'Sans question à nombre manquant.'),
      };
      Q.reset();
      previewKey = key;
    }

    const nOps = state.ops.length;
    $('#programme-note').textContent =
      `${nOps} opération${nOps > 1 ? 's' : ''} · ${preview.nbFaits.toLocaleString('fr-FR')} calculs différents`;

    const trapTxt = sprint ? 'sans chausse-trappe'
      : state.trapRate === 0 ? 'aucune chausse-trappe'
      : `chausse-trappe sur ~${Math.round(state.trapRate * 100)} % des manches`;
    const graceTxt = state.graceMs === 0
      ? 'le premier qui répond clôt la question'
      : `${fr(state.graceMs / 1000)} s de rattrapage pour les plus lents`;
    // Un calcul à deux chiffres reçoit plus que le temps de base : le dire,
    // sinon « 3 s » passe pour le temps accordé à 38 + 47.
    const long = famille('add') && state.nombres === 100 ? ', davantage pour les nombres à deux chiffres' : '';

    $('#custom-preview').textContent = preview.texte + ' À plusieurs : ' + graceTxt + '.';
    const holeTxt = state.holeRate ? ' · résultats et nombres manquants' : ' · trouver les résultats';
    const duree = sprint ? `Sprint de ${state.sprint} secondes` : `${state.rounds} questions`;
    $('#session-preview').textContent =
      `${duree} · ${fr(state.timeBase / 1000)} s par calcul${long} · ${trapTxt}${holeTxt}`;
  }

  /* ─── Le carnet du maître, sur l'accueil ────────────────────────── */
  function refreshCarnet() {
    const n = Mem.cles().length;
    $('#carnet-row').hidden = n === 0;
    $('#carnet-note').textContent = n > 1
      ? `Le carnet du maître : ${n} calculs à revoir. Ils reviendront en priorité.`
      : 'Le carnet du maître : 1 calcul à revoir. Il reviendra en priorité.';
    $('#btn-carnet').textContent = n > REVISION_MAX ? `Réviser les ${REVISION_MAX} plus anciens`
      : n > 1 ? 'Réviser ces calculs' : 'Réviser ce calcul';
  }

  function refreshLegend() {
    const kb = In.KB_LAYOUTS.map((l, i) => `<b>P${i + 1}</b> ${l.label}`).join(' · ');
    const pads = In.padCount();

    // L'API manette exige un contexte sécurisé. Ouvert par double-clic, le
    // jeu tourne en file:// : c'est accepté par Chrome et Firefox, mais pas
    // partout. Autant le dire, avec la solution.
    const padsOK = !!navigator.getGamepads && window.isSecureContext !== false && In.padStatus() !== 'blocked';
    const padLine = !padsOK
      ? `Manettes <b>indisponibles</b> sur ce navigateur en ouverture directe — lance <b>node serve.js</b> puis va sur localhost:4321`
      : `Manettes détectées : <b>${pads}</b>` + (pads === 0 ? ' — branche-en une et appuie sur un bouton' : '');

    // Le nom d'une voix vient du système : il s'insère comme du texte.
    const voix = document.createElement('b');
    voix.textContent = state.voice ? A.voiceStatus() : 'coupée';
    $('#keys-legend').innerHTML =
      padLine +
      `<br>Claviers : ${kb}` +
      `<br>Menus : Tab et Entrée au clavier ; croix / stick et A / Croix à la manette. Pause : Échap / Start.` +
      `<br>Voix : `;
    $('#keys-legend').appendChild(voix);
  }

  /* ─── Lancement d'une partie ────────────────────────────────────── */
  /* `faits` : une liste de clés de calculs fait de la partie une RÉVISION —
     ces calculs-là seulement (les premiers de la liste si elle est trop
     longue), toujours en leçon, et assez longue pour que CHACUN soit posé. */
  function launch(faits) {
    if (!In.players.length) {
      $('#join-hint').textContent = 'Inscris-toi avec une touche de ton pupitre, ou choisis « Jouer à la souris ».';
      $('#btn-solo').focus();
      return;
    }
    unlockAudio();
    In.mode = 'play';
    const revision = Array.isArray(faits) && faits.length ? faits.slice(0, REVISION_MAX) : null;
    let rounds = state.rounds;
    if (revision) {
      // La longueur dépend des énoncés que CE réglage sait tirer de ces calculs.
      Q.configure({ faits: revision, mix: state.mix, bothWays: state.bothWays, holeRate: state.holeRate });
      rounds = Q.tailleRevision();
    }
    G.setup({
      ops: state.ops, tables: state.tables, nombres: state.nombres,
      mode: revision ? 'lecon' : state.mode,
      rounds,
      sprintMs: state.sprint * 1000,
      timeBase: state.timeBase, mix: state.mix, bothWays: state.bothWays,
      trapRate: state.trapRate, graceMs: state.graceMs,
      holeRate: state.holeRate,
      faits: revision,
      // Hors révision, le carnet glisse ses calculs dans le tirage normal.
      revoir: revision ? [] : Mem.cles(),
    }, In.players);
    MX.UI.goto('game');
    G.begin();
  }

  // Le focus suit la géométrie des boutons : le même geste marche pour
  // le programme, les réglages, le bulletin et le panneau de pause.
  function navigateMenu(action, device) {
    if (device && device.type === 'pad') document.body.classList.add('pad-navigation');
    const scope = G.paused ? $('#pause-panel') : $('#screen-' + screen);
    const buttons = $$('button:not(:disabled), summary', scope).filter(el => !el.closest('[inert]') && el.getClientRects().length);
    if (!buttons.length) return;
    if (action === 'back') {
      if (G.paused) G.resume();
      else if (screen === 'end') backToMenu();
      else if ($('#controls-help').open) $('#controls-help').open = false;
      else $('#btn-start').focus();
      return;
    }
    const current = document.activeElement;
    if (action === 'confirm') {
      if (buttons.includes(current)) {
        menuDevice = device || null;
        try { current.click(); } finally { menuDevice = null; }
      } else {
        (G.paused ? $('#btn-resume') : screen === 'end' ? $('#btn-again') : buttons[0]).focus();
      }
      return;
    }
    if (!buttons.includes(current)) { buttons[0].focus(); return; }
    const rect = current.getBoundingClientRect();
    const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const axis = action === 'left' || action === 'right' ? 'x' : 'y';
    const sign = action === 'left' || action === 'up' ? -1 : 1;
    const cross = axis === 'x' ? 'y' : 'x';
    const candidates = buttons.filter(el => el !== current).map(el => {
      const r = el.getBoundingClientRect();
      const point = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const forward = (point[axis] - origin[axis]) * sign;
      const sideways = Math.abs(point[cross] - origin[cross]);
      return { el, forward, cost: forward + sideways * 2.5 };
    }).filter(c => c.forward > 4).sort((a, b) => a.cost - b.cost);
    if (candidates.length) {
      candidates[0].el.focus({ preventScroll: true });
      candidates[0].el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function backToMenu() {
    In.reset();
    In.mode = 'lobby';
    A.cancel();
    refreshJoinSlots();
    refreshLegend();
    refreshPreview();
    refreshCarnet();
    MX.UI.goto('title');
  }

  /* ─── Branchements ──────────────────────────────────────────────── */
  function wire() {
    In.onJoin(p => {
      unlockAudio();
      A.sfx.buzz();
      refreshJoinSlots();
      const el = $('#slot-' + p.id);
      const c = FX.centerOf(el);
      FX.chalkDust(c.x, c.y, 20, getComputedStyle(el).getPropertyValue('--pc').trim() || '#f2efe0');
    });

    In.onBuzz((pid, slot) => { unlockAudio(); G.onBuzz(pid, slot); });

    In.onStart(() => {
      unlockAudio();
      if (screen === 'title' || screen === 'end') launch();
      else if (screen === 'game') G.togglePause();
    });
    In.onPause(() => {
      if (screen === 'game') G.togglePause();
      else if (screen === 'end') backToMenu();
    });
    In.onMenu(navigateMenu);

    $('#btn-start').addEventListener('click', () => launch());
    $('#btn-again').addEventListener('click', () => launch());
    $('#btn-review').addEventListener('click', () => launch(ratesDuJour));
    $('#btn-menu').addEventListener('click', backToMenu);
    $('#btn-solo').addEventListener('click', () => {
      const solo = In.players.length === 0;
      In.joinDevice(menuDevice || { type: 'pointer' });
      refreshJoinSlots();
      if (solo) launch();
    });
    $('#btn-keyboard').addEventListener('click', () => {
      const device = menuDevice || In.freeDevices().find(d => d.type === 'kb');
      if (device) In.joinDevice(device);
      refreshJoinSlots();
    });
    // Réviser le carnet : comme « Jouer à la souris », le bouton inscrit
    // celui qui l'actionne quand la classe est vide.
    $('#btn-carnet').addEventListener('click', () => {
      if (!In.players.length) In.joinDevice(menuDevice || { type: 'pointer' });
      refreshJoinSlots();
      launch(Mem.cles());
    });
    $('#btn-carnet-clear').addEventListener('click', () => {
      Mem.vider();
      refreshCarnet();
      $('#btn-start').focus();
    });
    $('#btn-pause').addEventListener('click', () => G.togglePause());
    $('#btn-resume').addEventListener('click', () => G.resume());
    $('#btn-quit').addEventListener('click', () => G.endEarly());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && screen === 'game') G.pause();
    });
    document.addEventListener('keydown', event => {
      if (!G.paused || event.key !== 'Tab') return;
      const buttons = $$('button:not(:disabled)', $('#pause-panel'));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });

    // Souris : utile pour tester seul, ou pour un joueur sans manette.
    // Un clic vaut un appui du joueur souris, à défaut du joueur 1.
    $$('.ans').forEach(el => {
      el.addEventListener('click', () => {
        const pointer = In.players.find(p => p.device.type === 'pointer');
        if (In.players.length) G.onBuzz(pointer ? pointer.id : 0, +el.dataset.slot);
      });
    });

    window.addEventListener('gamepadconnected', () => { refreshLegend(); A.sfx.buzz(); });
    window.addEventListener('gamepaddisconnected', event => {
      refreshLegend();
      if (screen === 'game' && In.players.some(p => p.device.type === 'pad' && p.device.index === event.gamepad.index)) G.pause();
    });
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('pointerdown', () => document.body.classList.remove('pad-navigation'));
    window.addEventListener('keydown', () => document.body.classList.remove('pad-navigation'));
    if (window.speechSynthesis)
      window.speechSynthesis.addEventListener('voiceschanged', refreshLegend);
  }

  /* ─── Démarrage ─────────────────────────────────────────────────── */
  function boot() {
    restoreSettings();
    FX.init();
    buildScribbles();
    buildJoinSlots();
    buildProgramme();
    buildSettings();
    wire();
    refreshJoinSlots();
    refreshLegend();
    refreshAllSegs();
    refreshCarnet();
    $('#teacher-slot').innerHTML = Teach.portrait();
    $('#burst-face').innerHTML = Teach.portrait();
    $('#title-teacher').innerHTML = Teach.portrait();
    In.mode = 'lobby';
    In.start();
    MX.UI.goto('title');
    $('#pause-veil').inert = true;
    setTimeout(refreshLegend, 900);   // les voix arrivent parfois en retard
    appliInstallable();
  }

  /* ─── L'appli installable, jouable sans connexion ───────────────────
     Seulement sur le site publié (https). Ouvert par double-clic, le
     navigateur refuse de lire le manifeste (une erreur rouge en console) et
     le service worker. Sur le serveur local, on n'en veut pas : sw.js
     prendrait tout localhost:4321 sous sa coupe, et y resterait pour les
     autres projets servis sur ce port. */
  function appliInstallable() {
    if (location.protocol !== 'https:') return;
    const lien = document.createElement('link');
    lien.rel = 'manifest';
    lien.href = 'manifest.webmanifest';
    document.head.appendChild(lien);
    if (!('serviceWorker' in navigator)) return;
    // Après le chargement : la copie du jeu ne dispute pas le réseau à la page.
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js')
      .catch(e => console.warn('Jeu sans connexion indisponible :', e)));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
