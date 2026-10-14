/* ══════════════════════════════════════════════════════════════════
   teacher.js — Maître Ronchon
   Son visage (cinq portraits, un par humeur), piloté par une simple
   classe d'état. Chaque réplique porte deux textes : celui qu'on LIT
   (court, gros) et celui qu'on ENTEND — ce dernier redit toujours
   le calcul et son résultat, pour ancrer la mémorisation.
   ══════════════════════════════════════════════════════════════════ */
MX.Teacher = (function () {
  const { pickFresh, enLettres, img } = MX.U;
  const Ops = MX.Ops;

  /* ─── Le visage ─────────────────────────────────────────────────────
     Cinq portraits du même personnage, un par humeur, empilés dans le même
     cadre : la classe d'humeur posée sur `.teacher` dit lequel se montre
     (cf. css/style.css). Ils sont dessinés sur une MÊME toile, alignés en
     bas — changer d'humeur ne fait pas sauter le visage.

     Une humeur de plus demande donc TROIS choses : son nom ici, son image
     `img/maitre-<humeur>.webp`, sa règle dans la feuille de style.      */
  const MOOD_CLASS = ['neutral', 'rage', 'pleased', 'sly', 'dead'];

  function portrait() {
    return '<div class="teacher">' + MOOD_CLASS.map(m =>
      `<img class="t t-${m}" src="${img(`img/maitre-${m}.webp`)}" alt="" draggable="false">`).join('') + '</div>';
  }

  /* ─── Répliques ─────────────────────────────────────────────────────
     shout  : ce qui s'affiche dans la bulle (court, percutant)
     speech : ce que dit la voix — contient TOUJOURS le rappel du calcul,
              `{op}` (« sept fois huit ») et `{r}` (« cinquante-six ») :
              c'est le levier de mémorisation.
     Aucune réplique ne nomme une opération en particulier : le même maître
     corrige une addition comme une division.                            */
  const LINES = {
    wrong: [
      { shout: 'NOOON !',                     speech: 'Non ! {op}, {r} !' },
      { shout: 'ET MOI JE SUIS UNE THÉIÈRE !', speech: 'Mais bien sûr ! {op}, ça fait {r} !' },
      { shout: 'ON LA RETIENT POUR LA PROCHAINE !', speech: 'On la retient ! {op}, {r} !' },
      { shout: 'MA CRAIE A GLISSÉ. TON CALCUL AUSSI.', speech: 'On reprend le calcul. {op}, ça fait {r}.' },
      { shout: 'CELLE-CI VA REVENIR !', speech: 'Une erreur, ça s\'apprend. {op}, {r}.' },
      { shout: 'ÇA SE JOUE À PEU DE CHOSE !', speech: 'Ce n\'était pas loin. {op}, {r}.' },
      { shout: 'ON EFFACE, ON RETIENT !', speech: 'On efface et on retient : {op} égale {r}.' },
      { shout: 'MÊME MA MOUSTACHE HÉSITAIT.', speech: 'Même ma moustache hésitait. {op}, {r} !' },
    ],
    good: [
      { shout: 'BON. ACCEPTABLE.',    speech: 'Acceptable. {op}, {r}.' },
      { shout: 'ÇA RENTRE DANS LA TÊTE !', speech: 'Bien joué. {op}, {r}.' },
      { shout: 'ENCORE UN CALCUL APPRIVOISÉ !', speech: 'Très bien ! {op}, {r} !' },
      { shout: 'MA CRAIE APPLAUDIT.', speech: 'C\'est juste ! {op}, {r}.' },
      { shout: 'MMMH. C\'EST JUSTE.',            speech: 'C\'est juste. {op}, {r}.' },
      { shout: 'RIEN À REDIRE. C\'EST AGAÇANT.', speech: 'Rien à redire. {op}, {r}.' },
    ],
    fast: [
      { shout: 'MAIS... QUELLE VITESSE ?!', speech: 'Incroyable ! {op}, {r} !' },
      { shout: 'TU AS TRICHÉ ! ...NON ? BON.', speech: 'Tu as triché ? Non ? {op}, {r} !' },
      { shout: 'ÉBLOUISSANT. JE SUIS VEXÉ.', speech: 'Éblouissant ! {op}, {r} !' },
    ],
    timeout: [
      { shout: 'ON PREND LE TEMPS DE LA RETENIR.', speech: 'Le bon calcul : {op}, {r}.' },
      { shout: 'ELLE NOUS A FAIT RÉFLÉCHIR !', speech: 'On apprend celle-ci ensemble : {op}, {r}.' },
      { shout: 'LA CRAIE ATTENDRA. ON RÉVISE !', speech: 'On la révise : {op}, {r}.' },
    ],
    allWrong: [
      { shout: 'TOUS ! TOUS FAUX !', speech: 'Tous faux ! {op}, {r} !' },
      { shout: 'JE DÉMISSIONNE. ...DEMAIN.', speech: 'Je démissionne ! {op}, ça fait {r} !' },
      { shout: 'CELLE-LÀ, ON LA REFAIT ENSEMBLE.', speech: 'On la refait ensemble. {op}, {r}.' },
    ],
    intro: [
      { shout: 'ASSIS ! ON COMMENCE !', speech: 'Assis ! Sortez vos cerveaux !' },
      { shout: 'SILENCE ! CALCUL MENTAL !', speech: 'Silence ! On calcule de tête !' },
      { shout: 'ARDOISES ! CRAIES ! CERVEAUX !', speech: 'Sortez les ardoises ! Et les cerveaux !' },
    ],
    introSprint: [
      { shout: 'À VOS MARQUES… CALCULEZ !', speech: 'À vos marques… prêts… calculez !' },
      { shout: 'JUSQU\'À LA CLOCHE ! VITE !', speech: 'Autant de calculs que possible, jusqu\'à la cloche !' },
    ],
    introRevision: [
      { shout: 'ON REVOIT CE QUI A COINCÉ.', speech: 'On reprend les calculs qui ont coincé. Sans se presser.' },
      { shout: 'MON CARNET N\'OUBLIE RIEN.', speech: 'Mon carnet n\'oublie rien. On revoit tout ça.' },
    ],
    end: [
      { shout: 'LA CLOCHE ! DEHORS !', speech: 'La cloche a sonné ! Dehors !' },
      { shout: 'C\'EST FINI. JE RESPIRE.', speech: 'C\'est fini pour aujourd\'hui !' },
    ],
  };

  const lastOf = {};

  /* Ce qu'il faut redire AVANT le calcul quand la bonne case n'était pas
     son résultat : le nombre manquant, ou le signe effacé. Présenter le
     résultat comme « la réponse » ferait retenir autre chose que ce qui
     était demandé. */
  function prefixe(q) {
    if (q.kind === 'hole') return `Le nombre manquant était ${enLettres(q.answer)}. `;
    if (q.kind === 'sign') return `C'était le signe ${Ops.DEF[q.op].nomSigne}. `;
    return '';
  }

  /** Le rappel nu, sans humeur : « sept fois huit, cinquante-six. » */
  function rappel(q) {
    return `${prefixe(q)}${Ops.dire(q.op, q.a, q.b)}, ${enLettres(q.result)}.`;
  }

  /** Prend une réplique de la catégorie et remplace {op} et {r}. */
  function line(cat, q) {
    const arr = LINES[cat] || LINES.wrong;
    const l = pickFresh(arr, lastOf[cat]);
    lastOf[cat] = l;
    const sub = (s) => (s || '').replace(/\{(op|r)\}/g, (_, token) => {
      if (!q) return '';
      return token === 'r' ? enLettres(q.result) : Ops.dire(q.op, q.a, q.b);
    });
    return { shout: l.shout, speech: (q ? prefixe(q) : '') + sub(l.speech) };
  }

  /** Humeur → classe CSS du visage. */
  function setMood(rootEl, mood) {
    const t = rootEl && rootEl.querySelector('.teacher');
    if (!t) return;
    MOOD_CLASS.forEach(m => t.classList.remove(m));
    if (mood && mood !== 'neutral') t.classList.add(mood);
  }

  return { portrait, line, rappel, setMood, LINES, MOOD_CLASS };
})();
