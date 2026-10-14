/* ══════════════════════════════════════════════════════════════════
   questions.js — fabrique de questions

   `js/operations.js` sait ce qu'est une opération ; ce fichier-ci décide
   LAQUELLE on pose, et sous quelle forme. Deux principes :

   1. Les opérations ne sont pas tirées uniformément. Un tirage au hasard
      favorise les opérations faciles, parce qu'il en existe beaucoup plus
      (toutes les combinaisons avec 2, 5 ou 10 contre celles de 6, 7 et 8).
      On classe donc chaque fait par difficulté et on tire d'abord un
      NIVEAU, puis un fait dans ce niveau.

   2. Un énoncé ne se répète pas dans une partie. La seule répétition
      voulue est la révision d'un fait raté — et elle revient sous une
      AUTRE forme : un écran identique apprend moins que le même fait
      présenté autrement.
   ══════════════════════════════════════════════════════════════════ */
MX.Questions = (function () {
  const { shuffle, pick } = MX.U;
  const Ops = MX.Ops;

  /* ─── Réglages ──────────────────────────────────────────────────── */
  let ops      = ['×'];
  let tables   = [2, 3, 4, 5, 6, 7, 8, 9];
  let nombres  = 20;                // portée des additions et soustractions
  let bothWays = true;              // « 8 × 3 » autant que « 3 × 8 »
  let mix      = 'equilibre';       // 'facile' | 'equilibre' | 'dur'
  let holeRate = 0;                 // part de questions « quel nombre manque ? »
  let imposes  = null;              // partie de révision : ces faits-là, rien d'autre
  let aRevoir  = [];                // clés à faire revenir en priorité dès le début

  /* ─── Catalogue ─────────────────────────────────────────────────── */
  let facts   = [];                 // tous les faits jouables
  let byDiff  = {};                 // niveau de difficulté → liste de faits
  let niveaux = [];                 // les niveaux présents, triés
  let parOp   = [];                 // par opération : { op, byDiff, niveaux }
  let parCle  = new Map();

  /* ─── État de tirage : TOUT ce qui suit est remis à zéro par raz() ──
     Chaque fait porte en plus `vus` (fois déjà posé) et `libres` (formes
     encore jamais servies, par type de question).                       */
  let missed = [];                  // faits ratés, à reproposer
  let lastKey = null;
  let usedForms = new Set();        // formes déjà servies dans la partie

  const KINDS = ['result', 'hole', 'intruder', 'sign'];

  /* Combien chaque NIVEAU pèse dans le tirage. Ce sont des poids par
     niveau, pas par opération : le nombre d'opérations d'un niveau
     n'influence donc pas son poids — « équilibré » donne le même poids
     de départ à chaque niveau présent. */
  const MIX_WEIGHT = {
    facile:    (d) => 1 / (1 + d * d * 0.1),
    equilibre: ()  => 1,
    dur:       (d) => 1 + d * d * 0.1,
  };

  /* ─── Les FORMES d'un fait ──────────────────────────────────────────
     Une forme est un énoncé affichable, identifié par le texte exact qui
     paraît à l'ardoise. « 7 × 8 » et « 8 × 7 » sont deux formes du même
     fait : c'est voulu. Ce qui ne doit jamais se répéter dans une partie,
     c'est la FORME, pas le fait.                                        */
  function formsOf(f, kind) {
    if (kind === 'intruder') {
      // Trois autres lignes justes sont nécessaires : sans elles, pas de losange.
      return parCle.size >= 4 ? [{ key: 'i|' + f.key }] : [];
    }
    const out = [], s = Ops.DEF[f.op].signe;
    for (const [a, b] of Ops.sens(f, bothWays)) {
      const r = Ops.calc(f.op, a, b);
      if (kind === 'result') {
        out.push({ key: 'r|' + a + s + b, a, b });
      } else if (kind === 'hole') {
        // Trou à droite : « 7 × ? = 56 ». Toujours disponible.
        out.push({ key: 'h|' + a + s + '?=' + r, a, b, side: 'right' });
        // Trou à gauche : « ? × 8 = 56 ». Réservé aux deux sens : en sens
        // unique, le premier nombre ne doit pas quitter sa place.
        if (bothWays) out.push({ key: 'h|?' + s + b + '=' + r, a, b, side: 'left' });
      } else if (Ops.signesPossibles(a, b, r).length === 1) {
        // « 2 ? 2 = 4 » accepte + et × : une question à deux bonnes cases.
        out.push({ key: 's|' + a + '?' + b + '=' + r, a, b });
      }
    }
    return out;
  }

  function freeForms(f, kind) {
    return formsOf(f, kind).filter(fo => !usedForms.has(fo.key));
  }

  function formesLibres(kind) {
    return facts.reduce((n, f) => n + f.libres[kind], 0);
  }

  function useForm(f, kind, formKey) {
    f.vus++;
    f.libres[kind]--;
    lastKey = f.key;
    usedForms.add(formKey);
  }

  /** Un nouveau tour commence pour ces TYPES de question, et pour eux seuls :
      une manche qui épuise les résultats ne doit pas rendre ses formes au
      nombre manquant, qui en avait encore de jamais servies. Sans argument,
      tout repart (début de partie). */
  const TYPE_DE = { r: 'result', h: 'hole', i: 'intruder', s: 'sign' };
  function nouveauTour(kinds) {
    if (!kinds) {
      usedForms = new Set();
      for (const f of facts) f.libres = Object.assign({}, f.max);
      return;
    }
    for (const cle of Array.from(usedForms))
      if (kinds.indexOf(TYPE_DE[cle[0]]) >= 0) usedForms.delete(cle);
    for (const f of facts) for (const kind of kinds) f.libres[kind] = f.max[kind];
  }

  /* ─── Construction du catalogue ─────────────────────────────────── */
  function raz() {
    lastKey = null;
    for (const f of facts) f.vus = 0;
    nouveauTour();
    missed = aRevoir.map(k => parCle.get(k)).filter(Boolean);
  }

  function rebuild() {
    const bruts = imposes
      ? imposes.map(Ops.fromKey).filter(Boolean)
      : Ops.catalogue(ops, { tables, nombres });
    byDiff = {}; parCle = new Map();
    const groupes = {};
    for (const f of bruts) {
      if (parCle.has(f.key)) continue;         // un fait ne figure qu'une fois
      parCle.set(f.key, f);
      (byDiff[f.d] = byDiff[f.d] || []).push(f);
      const g = groupes[f.op] || (groupes[f.op] = {});
      (g[f.d] = g[f.d] || []).push(f);
    }
    facts = Array.from(parCle.values());
    const tries = (o) => Object.keys(o).map(Number).sort((a, b) => a - b);
    niveaux = tries(byDiff);
    parOp = Ops.LIST.filter(op => groupes[op])
      .map(op => ({ op, byDiff: groupes[op], niveaux: tries(groupes[op]) }));
    // Le nombre de formes d'un fait ne dépend que des réglages : on le
    // compte une fois, le tirage n'a plus qu'à décompter.
    for (const f of facts) {
      f.max = {};
      for (const kind of KINDS) f.max[kind] = formsOf(f, kind).length;
    }
    raz();
  }

  function configure(opts) {
    if (opts.ops && opts.ops.length) ops = Ops.LIST.filter(op => opts.ops.indexOf(op) >= 0);
    if (opts.tables && opts.tables.length) tables = opts.tables.slice();
    if (opts.nombres) nombres = opts.nombres;
    if (opts.mix) mix = opts.mix;
    if (opts.bothWays != null) bothWays = !!opts.bothWays;
    if (opts.holeRate != null) holeRate = opts.holeRate;
    // Ces deux-là ne se « gardent » pas d'une configuration à l'autre : une
    // partie normale qui suit une révision ne doit pas hériter de son programme.
    const cles = (liste) => Array.from(new Set((liste || []).filter(k => Ops.fromKey(k))));
    imposes = cles(opts.faits).length ? cles(opts.faits) : null;
    aRevoir = cles(opts.revoir);
    rebuild();
  }

  /** Recommence une partie sur le même programme, sans le reconstruire. */
  function reset() { raz(); }

  /* ─── Tirage d'un fait ──────────────────────────────────────────── */
  function drawFact(kind) {
    // Révision ciblée : une opération ratée revient, mais JAMAIS sous la
    // forme déjà vue. (Pas dans une partie de révision : chaque calcul y
    // passe déjà à son tour, cf. plus bas.)
    if (!imposes && missed.length && Math.random() < 0.34) {
      for (const m of shuffle(missed)) {
        if (m.key === lastKey || m.libres[kind] <= 0) continue;
        missed.splice(missed.indexOf(m), 1);
        return m;
      }
    }

    // Écarter le fait précédent AVANT le choix du niveau. L'écarter seulement
    // à l'intérieur du niveau ne suffit pas : un niveau qui ne contient que
    // ce fait le reposerait, même si un autre niveau offre une question
    // neuve. Mais s'il est le SEUL à garder une forme libre, on le reprend —
    // sinon le registre se viderait avant d'avoir tout servi.
    const autres = facts.some(f => f.key !== lastKey && f.libres[kind] > 0);
    const jouable = (f) => f.libres[kind] > 0 && !(autres && f.key === lastKey);
    // Parmi des faits, ceux qui sont sortis le moins souvent.
    const moinsVus = (liste) => {
      let min = Infinity, out = [];
      for (const f of liste) {
        if (!jouable(f)) continue;
        if (f.vus < min) { min = f.vus; out = []; }
        if (f.vus === min) out.push(f);
      }
      return { min, liste: out };
    };

    // Partie de révision : un tourniquet. Chaque calcul annoncé passe une
    // fois avant qu'aucun ne revienne — sans quoi « revoir ces 20 calculs »
    // en reposait certains deux fois et d'autres jamais.
    if (imposes) {
      const tour = moinsVus(facts).liste;
      return tour.length ? pick(tour) : null;
    }

    // L'OPÉRATION d'abord : chacune de celles au programme reçoit la même
    // part. Tirer le niveau en premier noyait les tables dans un mélange
    // avec « jusqu'à 100 » : dans un niveau partagé, quelques multiplications
    // faisaient face à des centaines d'additions, et le milieu des tables ne
    // sortait presque jamais.
    const w = MIX_WEIGHT[mix] || MIX_WEIGHT.equilibre;
    const dispo = [];
    for (const g of parOp) {
      const cands = [];
      let total = 0;
      for (const d of g.niveaux) {
        // Dans un niveau, on privilégie les faits les moins vus.
        const { min, liste } = moinsVus(g.byDiff[d]);
        // Un niveau dont plus aucun fait n'a de forme libre sort du tirage.
        if (!liste.length) continue;
        // Un niveau dont toutes les opérations sont déjà tombées pèse
        // beaucoup moins. Ce frein fait travailler des faits nouveaux sans
        // laisser « faciles d'abord » monopoliser le tirage avec ×10 et ×2.
        const p = w(d) / (1 + min * 1.8);
        total += p;
        cands.push({ p, liste });
      }
      if (cands.length) dispo.push({ cands, total });
    }
    if (!dispo.length) return null;

    // Puis un NIVEAU dans cette opération, puis un fait dans ce niveau.
    const { cands, total } = pick(dispo);
    let r = Math.random() * total, i = 0;
    for (; i < cands.length - 1; i++) { r -= cands[i].p; if (r <= 0) break; }
    return pick(cands[i].liste);
  }

  /* ─── Habillage du fait tiré ────────────────────────────────────── */
  function base(f, kind, a, b) {
    return {
      kind, op: f.op, a, b, key: f.key,
      result: Ops.calc(f.op, a, b),
      fait: Ops.egalite(f.op, a, b),      // le fait VRAI, tel qu'on le corrige
      d: f.d, timeMul: f.temps,
    };
  }

  function cases(q, labels, bonne) {
    q.choices = labels.map((label, i) => ({ label: String(label), correct: i === bonne }));
    q.correctIndex = bonne;
    return q;
  }

  /** « Quel est le résultat ? » */
  function buildResult(f, form) {
    const { a, b } = form;
    const q = base(f, 'result', a, b);
    const vals = shuffle([q.result].concat(Ops.faux(f.op, a, b)));
    q.display = Ops.ecrire(f.op, a, b);
    q.tail = '= ?';
    q.answer = q.result;
    return cases(q, vals, vals.indexOf(q.result));
  }

  /** « Quel nombre manque ? » — la bonne case porte un des deux nombres,
      pas le résultat : `answer` et `result` ne sont pas la même chose. */
  function buildHole(f, form) {
    const { a, b, side } = form;
    const q = base(f, 'hole', a, b);
    const s = Ops.DEF[f.op].signe;
    q.side = side;
    q.shown  = side === 'right' ? a : b;   // le nombre écrit
    q.answer = side === 'right' ? b : a;   // celui qu'on cherche
    q.display = side === 'right' ? `${a} ${s} ?` : `? ${s} ${b}`;
    q.tail = `= ${q.result}`;
    const vals = shuffle([q.answer].concat(Ops.fauxTrou(f.op, a, b, side)));
    return cases(q, vals, vals.indexOf(q.answer));
  }

  /** « Trouve l'erreur » : quatre opérations complètes, une seule est fausse. */
  function buildIntruder(f) {
    // Le sens de la ligne fausse se tire au hasard : il n'appartient pas à
    // la forme, un intrus ne compte qu'une fois par fait.
    const [a, b] = pick(Ops.sens(f, bothWays));
    const q = base(f, 'intruder', a, b);
    const ligne = (op, x, y, v) => `${x}${Ops.DEF[op].signe}${y}=${v}`;
    q.wrongShown = pick(Ops.faux(f.op, a, b));

    // Trois opérations justes, prises elles aussi dans le programme.
    const autres = [], pris = new Set([f.key]);
    while (autres.length < 3) {
      const g = pick(facts);
      if (pris.has(g.key)) continue;
      pris.add(g.key);
      const [x, y] = pick(Ops.sens(g, bothWays));
      autres.push(ligne(g.op, x, y, Ops.calc(g.op, x, y)));
      // Il faut vérifier les QUATRE lignes : le temps accordé est celui de
      // la plus longue à calculer, pas celui de la seule ligne fausse.
      q.timeMul = Math.max(q.timeMul, g.temps);
    }

    const fausse = ligne(f.op, a, b, q.wrongShown);
    const items = shuffle([fausse].concat(autres));
    q.display = 'QUI MENT ?';
    q.tail = 'une seule ligne est fausse';
    // « correct: true » désigne ici la ligne FAUSSE, celle qu'il faut montrer.
    return cases(q, items, items.indexOf(fausse));
  }

  /** « Quel signe a été effacé ? » — les quatre cases portent les quatre signes. */
  function buildSign(f, form) {
    const { a, b } = form;
    const q = base(f, 'sign', a, b);
    const signes = shuffle(Ops.LIST);
    q.display = `${a} ? ${b}`;
    q.tail = `= ${q.result}`;
    q.answer = f.op;
    return cases(q, signes.map(op => Ops.DEF[op].signe), signes.indexOf(f.op));
  }

  const BUILD = { result: buildResult, hole: buildHole, intruder: buildIntruder, sign: buildSign };

  /** Tire une question.
      `opts.kinds` = types autorisés par la manche (une chausse-trappe peut
      en imposer ou en interdire). Le premier type de la liste qui a encore
      de la matière gagne ; si aucun n'en a, le registre repart pour un tour
      SANS jamais sortir des types autorisés. */
  function next(opts) {
    let kinds = (opts && opts.kinds && opts.kinds.length) ? opts.kinds : ['result'];
    const mixte = kinds.indexOf('result') >= 0 && kinds.indexOf('hole') >= 0;
    // « Jamais » reste une interdiction, même après épuisement du catalogue.
    // Un type imposé par une chausse-trappe conserve en revanche la priorité.
    if (mixte && holeRate <= 0) kinds = kinds.filter(k => k !== 'hole');
    else if (mixte && holeRate >= 1) kinds = kinds.filter(k => k !== 'result');
    // Le type se tire AVANT l'opération : c'est ce qui fait respecter la
    // fréquence annoncée au parent. L'ordre inverse la ferait dériver au
    // gré des formes restantes.
    const voulu = kinds.indexOf('result') >= 0 && kinds.indexOf('hole') >= 0
      ? (Math.random() < holeRate ? 'hole' : 'result') : kinds[0];
    const ordre = [voulu].concat(kinds.filter(k => k !== voulu));

    for (let essai = 0; essai < 2; essai++) {
      for (const kind of ordre) {
        const f = drawFact(kind);
        if (!f) continue;
        const form = pick(freeForms(f, kind));
        useForm(f, kind, form.key);
        return BUILD[kind](f, form);
      }
      nouveauTour(ordre);         // ces types-là sont épuisés : ils repartent
    }
    // Ce programme n'offre AUCUNE forme du type demandé (un signe toujours
    // ambigu, trop peu de faits pour un intrus) : la manche pose un résultat
    // plutôt que rien. Un catalogue non vide en a toujours un.
    return ordre.indexOf('result') < 0 && facts.length ? next({ kinds: ['result'] }) : null;
  }

  /** Une AUTRE opération du programme, dont le résultat diffère de celui de
      la question `q`, sans toucher au tirage.
      Sert au piège « MAÎTRE MENTEUR » : son mensonge doit rester dans le
      programme choisi par le parent, sinon l'enfant entend une opération
      qu'on ne lui a jamais demandé de réviser — et il doit CONTREDIRE
      l'écran, sans quoi répondre à l'oreille donnerait juste. */
  function peekOther(q) {
    const leurre = (f) => {
      if (f.key === q.key) return null;
      for (const [a, b] of shuffle(Ops.sens(f, bothWays)))
        if (Ops.calc(f.op, a, b) !== q.result) return { op: f.op, a, b };
      return null;
    };
    // Quelques essais au hasard suffisent presque toujours ; le balayage
    // complet ne sert qu'aux tout petits catalogues.
    for (let i = 0; i < 24 && facts.length; i++) {
      const l = leurre(pick(facts));
      if (l) return l;
    }
    for (const f of shuffle(facts)) { const l = leurre(f); if (l) return l; }
    return null;
  }

  /** Longueur d'une partie de révision sur le programme courant : assez pour
      que CHAQUE calcul passe, deux fois si le réglage offre assez d'énoncés
      différents — jamais au point de reposer le même écran. */
  function tailleRevision() {
    const n = facts.length;
    const formes = formesLibres('result') + (holeRate > 0 ? formesLibres('hole') : 0);
    return Math.max(n, Math.min(formes, Math.max(2 * n, 4), 24));
  }

  function registerMiss(key) {
    const f = parCle.get(key);
    if (f && missed.indexOf(f) < 0) missed.push(f);
  }

  rebuild();

  return {
    configure, reset, next, registerMiss, peekOther, formesLibres, tailleRevision,
    get tables() { return tables.slice(); },
    get nbFaits() { return facts.length; },
    /** Ce qu'une chausse-trappe a besoin de savoir pour se déclarer jouable. */
    get contexte() {
      return { ops: Ops.LIST.filter(op => facts.some(f => f.op === op)), nbFaits: facts.length };
    },
    /** Pour vérifier le réglage : combien de faits par niveau. */
    get catalogue() {
      return niveaux.map(d => ({ difficulte: d, nb: byDiff[d].length }));
    },
  };
})();
