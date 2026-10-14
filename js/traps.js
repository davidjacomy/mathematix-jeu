/* ══════════════════════════════════════════════════════════════════
   traps.js — les chausse-trappes du maître
   Chaque piège est une petite règle qui casse une habitude du joueur.
   Elles ne rendent pas le calcul plus dur : elles punissent le pilote
   automatique. C'est ce qui donne le sel « WarioWare ».

   CRITÈRE D'ADMISSION : un piège doit faire travailler quelque chose —
   lire au lieu d'écouter, retenir l'énoncé, décider vite, vérifier un
   résultat, savoir ce que FAIT une opération. Un piège qui se contente de
   gêner la LECTURE (losange retourné, écran masqué) ne fait travailler
   personne : il ajoute une difficulté motrice ou visuelle à un exercice de
   calcul, et l'enfant qui savait son calcul rate quand même. Deux pièges
   de ce genre ont été retirés pour cette raison — ne pas les réintroduire
   sans avoir tranché ce point.

   CHAMP `kinds` : les types de question que le piège accepte
   ('result' | 'hole' | 'intruder' | 'sign'). Il est LU par js/game.js.

   CHAMP `dispo(ctx)` : optionnel. Certains pièges n'ont de sens que sur
   certains programmes ; `ctx` vient de `MX.Questions.contexte`
   ({ ops, nbFaits }). Sans ce champ, le piège est toujours jouable.
   ══════════════════════════════════════════════════════════════════ */
MX.Traps = (function () {

  const LIST = [
    {
      id: 'liar',
      name: 'MAÎTRE MENTEUR',
      voice: 'Je vais dire une chose… et en écrire une autre.',
      weight: 3,
      timeMul: 1.1,
      scoreMul: 1.4,
      kinds: ['result'],
      // Mentir demande une AUTRE opération à dire, au résultat différent.
      dispo: (ctx) => ctx.nbFaits >= 3,
      // La voix annonce une autre opération : il faut croire ses yeux.
      // Ce leurre est tiré du programme choisi par le parent — sinon
      // l'enfant entend « six fois six » alors que la table de 6 ne fait
      // pas partie de la révision du jour. `null` = rien à mentir : la
      // manche dit alors la vérité.
      speakInstead(q) { return MX.Questions.peekOther(q); },
    },
    {
      id: 'lightning',
      name: 'ÉCLAIR ⚡',
      voice: 'Plus vite ! Plus vite !',
      weight: 4,
      timeMul: 0.55,
      scoreMul: 1.8,
      kinds: ['result', 'hole'],
    },
    {
      id: 'double',
      name: 'DOUBLE OU RIEN',
      voice: 'Celle-ci vaut double… et coûte double.',
      weight: 3,
      timeMul: 1,
      scoreMul: 2,
      malus: true,             // se tromper fait perdre des points
      kinds: ['result', 'hole'],
    },
    {
      id: 'hush',
      name: 'CHUUUT…',
      voice: null,             // pas de voix, c'est tout l'intérêt
      weight: 3,
      timeMul: 1.25,
      scoreMul: 1.6,
      silent: true,
      kinds: ['result', 'hole'],
      // Laisser le temps de lire avant de faire travailler la mémoire.
      // Un trou demande aussi de retenir le résultat écrit sous l'énoncé,
      // et un calcul à deux chiffres se lit moins vite qu'un fait de table.
      onShow(ui, q) {
        const readMs = (q && q.kind === 'hole' ? 2400 : 1800) * ((q && q.timeMul) || 1);
        ui.timeout(readMs, () => { ui.hidePrompt(true); ui.chalkSqueak(); });
      },
    },
    {
      id: 'intruder',
      name: 'TROUVE L\'ERREUR',
      voice: 'Une de ces quatre lignes est un mensonge. Laquelle ?',
      weight: 3,
      timeMul: 1.9,            // lire quatre opérations prend du temps
      scoreMul: 1.7,
      kinds: ['intruder'],
      silent: true,            // l'énoncé n'est pas une opération à dire
      // Il faut trois autres lignes justes à écrire.
      dispo: (ctx) => ctx.nbFaits >= 4,
    },
    {
      id: 'sign',
      name: 'SIGNE EFFACÉ',
      voice: 'J\'ai effacé le signe. Plus, moins, fois ou divisé ?',
      weight: 3,
      timeMul: 1.3,
      scoreMul: 1.5,
      kinds: ['sign'],
      silent: true,            // dire l'opération donnerait la réponse
      // Avec une seule opération au programme, le signe n'est pas une question.
      dispo: (ctx) => ctx.ops.length >= 2,
    },
  ];

  const byId = {};
  LIST.forEach(t => { byId[t.id] = t; });

  /** Tirage pondéré parmi les pièges jouables sur ce programme, en évitant
      le précédent. Sans `ctx`, tous sont candidats. */
  function draw(lastId, ctx) {
    const jouables = LIST.filter(t => !ctx || !t.dispo || t.dispo(ctx));
    // Éviter le précédent ne doit pas vider le tirage quand il est seul.
    const cands = jouables.length > 1 ? jouables.filter(t => t.id !== lastId) : jouables;
    const total = cands.reduce((s, t) => s + t.weight, 0);
    let r = Math.random() * total;
    for (const t of cands) { r -= t.weight; if (r <= 0) return t; }
    return cands[cands.length - 1];
  }

  return { LIST, byId, draw };
})();
