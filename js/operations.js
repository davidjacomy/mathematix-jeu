/* ══════════════════════════════════════════════════════════════════
   operations.js — les quatre opérations

   Ce fichier ne tire rien et ne retient rien : il sait ce qu'EST une
   opération. Ce qui se calcule, s'écrit, se dit, ce qui coince, et
   quelles erreurs un enfant y fait réellement.

   UN FAIT APPARTIENT À UNE FAMILLE, une opération en est une LECTURE.
   « 7 + 8 = 15 » porte l'addition et la soustraction (15 − 7, 15 − 8) ;
   « 7 × 8 = 56 » porte la multiplication et la division (56 ÷ 7, 56 ÷ 8).
   Un fait s'écrit donc (x, y, z) avec x ≤ y, et l'opération dit comment
   on le lit. C'est ce qui permet de corriger une division en renvoyant à
   sa table, et une soustraction à son addition.
   ══════════════════════════════════════════════════════════════════ */
MX.Ops = (function () {
  const { shuffle, enLettres } = MX.U;

  const F_MIN = 2, F_MAX = 10;      // facteurs jouables : on saute ×1, trop trivial
  const NOMBRES = [10, 20, 100];    // portées proposées pour + et −
  const TABLES = [2, 3, 4, 5, 6, 7, 8, 9, 10];

  /* `signe` s'écrit, `mot` se dit dans une opération (« sept FOIS huit »),
     `nomSigne` se dit quand on nomme le signe seul. Le moins et le divisé
     sont les vrais caractères typographiques, pas le tiret ni la barre. */
  const DEF = {
    '+': { id: '+', signe: '+', mot: 'plus',       nomSigne: 'plus',   nom: 'Additions',       famille: 'add', egale: 'font' },
    '−': { id: '−', signe: '−', mot: 'moins',      nomSigne: 'moins',  nom: 'Soustractions',   famille: 'add', egale: 'égale' },
    '×': { id: '×', signe: '×', mot: 'fois',       nomSigne: 'fois',   nom: 'Multiplications', famille: 'mul', egale: 'font' },
    '÷': { id: '÷', signe: '÷', mot: 'divisé par', nomSigne: 'divisé', nom: 'Divisions',       famille: 'mul', egale: 'égale' },
  };
  const LIST = ['+', '−', '×', '÷'];

  function calc(op, a, b) {
    return op === '+' ? a + b : op === '−' ? a - b : op === '×' ? a * b : a / b;
  }

  /* ─── Difficulté d'un fait ──────────────────────────────────────────
     UNE échelle de 0 (trivial) à 10 (ce qui coince vraiment), commune aux
     quatre opérations : c'est elle qui donne son sens au dosage « faciles /
     celles qui fâchent » dans un mélange — 7 × 8 doit peser plus que 8 + 5.
     Elle est symétrique : 7 × 8 et 8 × 7 sont le même effort de mémoire.

     Multiplication, deux étages qui ne se comparent pas :
     • un facteur « à règle » (1, 10, 2, 5) rend l'opération facile quel que
       soit l'autre nombre — 2 × 8 est un doublement, pas un fait à mémoriser ;
     • sinon chaque facteur coûte son prix et on additionne. Les carrés
       descendent d'un cran : ils se retiennent mieux que leurs voisins.

     Addition : les tables d'addition (deux nombres jusqu'à 10) se classent
     par STRATÉGIE — compter, doubler, compléter à 10, franchir la dizaine ;
     les nombres à deux chiffres par ce qu'ils obligent à tenir en tête
     (dizaines entières, retenue).

     Soustraction et division sont l'inverse d'un fait connu : un cran de
     plus que lui, parce qu'il faut d'abord le retrouver à l'envers.     */
  const COUT = { 3: 1, 4: 2, 9: 2, 6: 3, 8: 3, 7: 4 };

  function dMul(x, y) {
    if (x === 1) return 0;                            // n × 1
    if (y === 10) return 1;                           // ajouter un zéro
    if (x === 2) return 2;                            // doubler
    if (x === 5) return 3;                            // moitié de ×10
    let base = (COUT[x] || 3) + (COUT[y] || 3);       // de 2 à 8
    if (x === y) base -= 1;                           // carrés
    return 3 + base;                                  // de 4 à 10
  }

  function dAdd(x, y) {
    const z = x + y;
    if (y <= 10) {                                    // tables d'addition
      if (x === 1) return 0;                          // le suivant
      if (y === 10 || x === 2) return 1;              // une dizaine et… / compter deux
      if (x === y || z === 10) return 2;              // doubles, amis de 10
      if (z < 10) return 3;
      if (y - x === 1 || y === 9) return 4;           // presque-doubles, +9
      return x <= 4 ? 5 : 6;                          // franchir la dizaine
    }
    const ux = x % 10, uy = y % 10, retenue = ux + uy >= 10;
    if (ux === 0 && uy === 0) return 3;               // 30 + 40
    if (x < 10) return uy === 0 ? 2 : !retenue ? 3 : ux + uy === 10 ? 4 : 5;   // 40+7, 42+5, 38+2, 38+5
    if (ux === 0 || uy === 0) return 4;               // 34 + 20
    if (!retenue) return 6;                           // 32 + 45
    return ux + uy === 10 ? 7 : 8;                    // 36 + 24, 38 + 47
  }

  function difficulte(op, a, b) {
    const x = Math.min(a, b), y = Math.max(a, b);
    if (op === '×') return dMul(x, y);
    if (op === '÷') return Math.min(10, dMul(x, y) + 1);
    if (op === '+') return dAdd(x, y);
    return Math.min(10, dAdd(x, y) + 1);
  }

  /* Les seuils vivent À CÔTÉ de l'échelle : élargir l'une sans l'autre
     faussait l'aperçu affiché au parent. */
  function niveau(d) { return d <= 2 ? 'facile' : d <= 6 ? 'moyenne' : 'dure'; }

  /* ─── Temps accordé ─────────────────────────────────────────────────
     Un fait de table se RESTITUE, un calcul à deux chiffres se CALCULE.
     Lui donner le chrono de 2 × 5 punirait la réflexion : il reçoit donc
     un multiplicateur du temps de base.                                 */
  function temps(op, x, y) {
    if (DEF[op].famille !== 'add' || y <= 10) return 1;
    const d = dAdd(x, y);
    return d <= 3 ? 1.25 : d <= 5 ? 1.5 : d === 6 ? 1.8 : 2.2;
  }

  /* ─── Un fait ───────────────────────────────────────────────────────
     La clé `op|x|y` est aussi ce que le carnet du maître écrit dans le
     stockage local : changer son format rend ce carnet illisible.       */
  function fait(op, a, b, table) {
    const x = Math.min(a, b), y = Math.max(a, b);
    return {
      op, x, y,
      z: DEF[op].famille === 'add' ? x + y : x * y,
      key: op + '|' + x + '|' + y,
      d: difficulte(op, x, y),
      temps: temps(op, x, y),
      table: table == null ? null : table,   // × et ÷ : la table cochée qui amène le fait
    };
  }

  function fromKey(key) {
    const m = /^([+−×÷])\|(\d{1,3})\|(\d{1,3})$/.exec(String(key));
    if (!m) return null;
    const x = +m[2], y = +m[3];
    if (x < 1 || y < x) return null;
    if (DEF[m[1]].famille === 'mul' ? (x < F_MIN || y > F_MAX) : x + y > 100) return null;
    // « ×|07|8 » se lirait comme « ×|7|8 » : deux clés pour un même fait, donc
    // un programme qui le porterait deux fois. Seule l'écriture canonique vaut.
    const f = fait(m[1], x, y);
    return f.key === String(key) ? f : null;
  }

  /* ─── Le programme ──────────────────────────────────────────────────
     Les paires d'une portée d'addition. « Jusqu'à 10 » garde le 1 : c'est
     la portée des tout débuts. « Jusqu'à 20 » sont les tables d'addition,
     sans le +1. « Jusqu'à 100 » exige au moins un nombre à deux chiffres :
     à ce niveau, on ne revient pas sur les tables.                      */
  const PAIRES = {};
  function paires(nombres) {
    if (PAIRES[nombres]) return PAIRES[nombres];
    const out = [];
    if (nombres === 10) {
      for (let x = 1; x <= 5; x++) for (let y = x; x + y <= 10; y++) out.push([x, y]);
    } else if (nombres === 20) {
      for (let x = 2; x <= 10; x++) for (let y = x; y <= 10; y++) out.push([x, y]);
    } else {
      for (let y = 11; y <= 98; y++) for (let x = 2; x <= y && x + y <= 100; x++) out.push([x, y]);
    }
    return (PAIRES[nombres] = out);
  }

  /** Tous les faits jouables. `portee` = { tables: [...], nombres: 10|20|100 }. */
  function catalogue(ops, portee) {
    const out = [];
    for (const op of LIST) {
      if (ops.indexOf(op) < 0) continue;
      if (DEF[op].famille === 'mul') {
        // Cocher 3 et 8 rend 3×8 accessible par les deux tables : on ne
        // garde le fait qu'une fois, sinon il sortirait deux fois plus.
        const vus = new Set();
        for (const t of portee.tables) for (let o = F_MIN; o <= F_MAX; o++) {
          const f = fait(op, t, o, t);
          if (vus.has(f.key)) continue;
          vus.add(f.key);
          out.push(f);
        }
      } else {
        for (const [x, y] of paires(portee.nombres)) out.push(fait(op, x, y));
      }
    }
    return out;
  }

  /* ─── Les sens d'écriture d'un fait ─────────────────────────────────
     Chaque sens est [a, b] tel que « a op b » s'affiche. Rencontrer
     « 8 × 3 » autant que « 3 × 8 » fait comprendre que c'est le même
     résultat — et divise par deux ce qu'il reste à mémoriser.

     En sens unique, on garde la lecture la plus simple : la table à gauche
     (× et ÷ : on divise PAR la table), le grand nombre d'abord pour une
     addition (on avance du petit), le petit nombre ôté pour une
     soustraction. Un double n'a de toute façon qu'un sens.              */
  function sens(f, deuxSens) {
    const { op, x, y, z } = f;
    const un = x === y || !deuxSens;
    if (op === '+') return un ? [[y, x]] : [[y, x], [x, y]];
    if (op === '−') return un ? [[z, x]] : [[z, x], [z, y]];
    const t = f.table != null ? f.table : x, o = t === x ? y : x;
    if (op === '×') return un ? [[t, o]] : [[t, o], [o, t]];
    return un ? [[z, t]] : [[z, t], [z, o]];
  }

  /* ─── Écrire et dire ────────────────────────────────────────────── */
  function ecrire(op, a, b) { return `${a} ${DEF[op].signe} ${b}`; }
  function egalite(op, a, b) { return `${ecrire(op, a, b)} = ${calc(op, a, b)}`; }

  /** « sept fois huit » — en lettres, pour une diction sans ambiguïté. */
  function dire(op, a, b) { return `${enLettres(a)} ${DEF[op].mot} ${enLettres(b)}`; }

  /** L'énoncé parlé d'un nombre manquant ; `side` dit lequel manque. */
  function direTrou(op, a, b, side) {
    const o = DEF[op], r = enLettres(calc(op, a, b));
    if (side === 'right') return `${enLettres(a)} ${o.mot} combien ${o.egale} ${r} ?`;
    if (op === '×') return `combien de fois ${enLettres(b)} font ${r} ?`;
    return `combien ${o.mot} ${enLettres(b)} ${o.egale} ${r} ?`;
  }

  /** Les signes qui rendent « a ? b = r » vrai. Un seul, sauf 2 ? 2 = 4 et 4 ? 2 = 2. */
  function signesPossibles(a, b, r) { return LIST.filter(op => calc(op, a, b) === r); }

  /* ─── Les mauvaises réponses plausibles ─────────────────────────────
     Elles ne sont pas tirées au hasard : ce sont les erreurs que font
     réellement les enfants. C'est ce qui rend le QCM formateur.

     Trois rangs : `surs` (l'erreur-signature de CE calcul, toujours
     proposée), `forts` (les erreurs courantes, mélangées), `faibles` (le
     repli). Puis un filet de voisins, pour ne jamais rendre moins de trois
     valeurs — une sortie complète ne prouve donc pas sa qualité.        */
  function inverser(n) {
    const s = String(n);
    // Un multiple de 10 inversé perd un chiffre (40 → 4) : ce n'est plus
    // un piège, c'est un cadeau. On l'écarte.
    if (s.length < 2 || s.endsWith('0')) return null;
    const v = parseInt(s.split('').reverse().join(''), 10);
    return (v !== n && v > 0) ? v : null;
  }

  function trois(juste, rangs, min, max) {
    const pris = new Set([juste]), out = [];
    const prendre = (liste, melange) => {
      for (const v of (melange ? shuffle(liste) : liste)) {
        if (v == null || !Number.isInteger(v) || v < min || v > max || pris.has(v)) continue;
        pris.add(v); out.push(v);
        if (out.length === 3) return true;
      }
      return false;
    };
    if (prendre(rangs.surs || [], false) || prendre(rangs.forts, true) || prendre(rangs.faibles, true)) return out;
    for (let d = 1; out.length < 3 && d < 80; d++) prendre([juste + d, juste - d], true);
    return out;
  }

  /** Trois résultats faux pour « a op b ». `extra` : erreurs fortes de plus. */
  function faux(op, a, b, extra) {
    const r = calc(op, a, b);
    if (op === '÷') return fauxFacteur(r, b);
    let rangs, min = 1;
    if (op === '×') {
      // Une ligne de table en trop ou en moins, les chiffres inversés.
      rangs = { forts: [r + a, r - a, r + b, r - b, inverser(r)],
                faibles: [r + 1, r - 1, r + 10, r - 10, a + b, r + 2 * a, r - 2 * b] };
    } else if (op === '+') {
      if (Math.max(a, b) <= 10) {
        // On compte sur ses doigts : on tombe à côté d'un ou de deux.
        rangs = { forts: [r - 1, r + 1, r - 2, r + 2], faibles: [a * b, Math.abs(a - b), r + 10] };
      } else {
        // La retenue oubliée est L'erreur d'une addition posée de tête.
        const retenue = a % 10 + b % 10 >= 10;
        rangs = { surs: retenue ? [r - 10] : [],
                  forts: [r + 10, r - 1, r + 1, inverser(r), retenue ? null : r - 10],
                  faibles: [r + 2, r - 2, r + 9, r - 9] };
      }
    } else {
      min = 0;
      if (a <= 20) {
        rangs = { forts: [r - 1, r + 1, r - 2, r + 2], faibles: [a + b, b, r + 10] };
      } else {
        // « Le plus petit ôté du plus grand », chiffre par chiffre :
        // 52 − 38 → 26. Et l'emprunt oublié : → 24.
        const emprunt = a % 10 < b % 10;
        const petitDuGrand = (Math.floor(a / 10) - Math.floor(b / 10)) * 10 + Math.abs(a % 10 - b % 10);
        rangs = { surs: emprunt ? [petitDuGrand] : [],
                  forts: [emprunt ? r + 10 : null, r - 1, r + 1, r - 10, inverser(r)],
                  faibles: [r + 10, r + 2, r - 2, a + b] };
      }
    }
    if (extra) rangs.forts = rangs.forts.concat(extra);
    // Une valeur très au-delà des nombres en jeu se repère sans calculer :
    // « 98 − ? = 94 → 192 » ne piège personne quand on révise jusqu'à 100.
    const max = op === '×' ? 220 : Math.max(a, b, r) <= 20 ? 30 : 110;
    return trois(r, rangs, min, max);
  }

  /* Trois FACTEURS faux (de 2 à 10), par priorité pédagogique :
     • la ligne voisine dans la table — l'erreur la plus courante ;
     • le nombre DÉJÀ AFFICHÉ — celui qui recopie ce qu'il voit se fait
       prendre ;
     • deux lignes d'écart, puis n'importe quel facteur jouable.
     La bonne réponse est écartée d'entrée (`vus`) : sur un carré, où le
     nombre affiché EST la réponse, la question n'a donc pas deux bonnes cases. */
  function fauxFacteur(reponse, affiche) {
    const out = [], vus = new Set([reponse]);
    const prendre = (v) => {
      if (v == null || v < F_MIN || v > F_MAX || vus.has(v)) return false;
      vus.add(v); out.push(v);
      return out.length === 3;
    };
    const ordre = shuffle([reponse - 1, reponse + 1])
      .concat([affiche])
      .concat(shuffle([reponse - 2, reponse + 2]));
    for (const v of ordre) if (prendre(v)) return out;
    for (let v = F_MIN; v <= F_MAX; v++) if (prendre(v)) return out;
    return out;
  }

  /* Trois valeurs fausses pour le nombre qui manque dans « a op b = r ».
     Trouver un nombre manquant, c'est faire le calcul INVERSE : ses erreurs
     sont donc celles de ce calcul-là, plus une — appliquer naïvement le
     signe qu'on a sous les yeux (8 + ? = 15 → 23).                      */
  function fauxTrou(op, a, b, side) {
    const r = calc(op, a, b), droite = side === 'right';
    if (op === '×') return fauxFacteur(droite ? b : a, droite ? a : b);
    if (op === '÷') return droite ? fauxFacteur(b, r) : faux('×', b, r);
    if (op === '+') { const vu = droite ? a : b; return faux('−', r, vu, [r + vu]); }
    return droite ? faux('−', a, r, [a + r]) : faux('+', b, r, [Math.abs(b - r) || null]);
  }

  /* ─── L'astuce de calcul, montrée après un raté ─────────────────────
     Elle reçoit le fait VRAI (a op b = r), quel que soit le format de la
     question. Toute égalité qu'elle écrit doit être juste : c'est l'écran
     où l'enfant apprend.                                                */
  function astuce(q) {
    const { op, a, b } = q, r = calc(op, a, b);
    const x = Math.min(a, b), y = Math.max(a, b);

    if (op === '×') {
      if (x === 2) return `Deux fois ${y}, c'est ${y} + ${y}.`;
      if (x === 5) return `Cinq fois ${y}, c'est la moitié de ${10 * y}.`;
      if (x === 6) return `Astuce : 5 × ${y} + ${y} = ${r}.`;
      if (x === 7) return `Astuce : 5 × ${y} + 2 × ${y} = ${r}.`;
      if (x === 8 || x === 9) return `Astuce : 10 × ${y} − ${10 - x} × ${y} = ${r}.`;
      if (y === 10) return `Dix fois ${x}, c'est ${x} dizaines.`;
      return `${x} groupes de ${y} font ${r}.`;
    }

    if (op === '÷') return `Pense à la table de ${b} : ${b} × ${r} = ${a}.`;

    const dizaines = (n) => `${n / 10} dizaine${n > 10 ? 's' : ''}`;

    if (op === '+') {
      if (y <= 10) {
        if (x === y) return `${x} + ${x}, c'est le double de ${x}.`;
        if (r === 10) return `${y} et ${x} sont des amis de 10.`;
        if (y === 10) return `Dix et ${x} : une dizaine et ${x}, ça fait ${r}.`;
        if (r < 10) return `Pars de ${y} et avance de ${x}.`;
        if (y - x === 1) return `Presque un double : ${x} + ${x} + 1 = ${r}.`;
        if (y === 9) return `Astuce : 10 + ${x} − 1 = ${r}.`;
        const c = 10 - y;
        return `Passe par 10 : ${y} + ${c} = 10, puis 10 + ${x - c} = ${r}.`;
      }
      const ux = x % 10, uy = y % 10;
      if (ux === 0 && uy === 0) return `${dizaines(y)} et ${dizaines(x)} font ${dizaines(r)}.`;
      if (x < 10) {
        if (uy === 0) return `${dizaines(y)} et ${x} unités : ${r}.`;
        if (uy + x < 10) return `Les dizaines ne bougent pas : ${uy} + ${x} = ${uy + x}.`;
        const c = 10 - uy;
        if (c === x) return `${uy} + ${x} = 10 : on arrive pile à ${r}.`;
        return `Passe par la dizaine : ${y} + ${c} = ${y + c}, puis ${y + c} + ${x - c} = ${r}.`;
      }
      if (ux === 0) return `Ajoute ${dizaines(x)} : ${y} + ${x} = ${r}.`;
      if (uy === 0) return `Ajoute ${dizaines(y)} : ${x} + ${y} = ${r}.`;
      const dx = x - ux;
      return `Dizaines puis unités : ${y} + ${dx} = ${y + dx}, puis ${y + dx} + ${ux} = ${r}.`;
    }

    // Soustraction : a − b = r
    if (a <= 20) return `Pense à l'addition : ${b} + ${r} = ${a}.`;
    const ua = a % 10, ub = b % 10;
    if (ua === 0 && ub === 0) return `${dizaines(a)} moins ${dizaines(b)} : il reste ${dizaines(r)}.`;
    if (b < 10) {
      if (ua >= b) return `Les dizaines ne bougent pas : ${ua} − ${b} = ${ua - b}.`;
      if (ua === 0) return `Pense à l'addition : ${r} + ${b} = ${a}.`;
      return `Passe par la dizaine : ${a} − ${ua} = ${a - ua}, puis ${a - ua} − ${b - ua} = ${r}.`;
    }
    if (ub === 0) return `Enlève ${dizaines(b)} : ${a} − ${b} = ${r}.`;
    if (r < 10) return `Les deux nombres sont proches : ${b} + ${r} = ${a}.`;
    const db = b - ub;
    return `Dizaines puis unités : ${a} − ${db} = ${a - db}, puis ${a - db} − ${ub} = ${r}.`;
  }

  return {
    LIST, DEF, NOMBRES, TABLES, F_MIN, F_MAX,
    calc, difficulte, niveau, temps, fait, fromKey, catalogue, sens,
    ecrire, egalite, dire, direTrou, signesPossibles,
    faux, fauxFacteur, fauxTrou, astuce,
  };
})();
