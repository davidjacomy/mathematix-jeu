/* ══════════════════════════════════════════════════════════════════
   util.js — espace de noms global + petits outils
   Scripts classiques (pas de modules ES) pour que le jeu tourne aussi
   en double-clic sur le fichier, en file://.
   ══════════════════════════════════════════════════════════════════ */
window.MX = window.MX || {};

MX.U = (function () {

  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand  = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Tire un élément différent du précédent quand c'est possible. */
  function pickFresh(arr, last) {
    if (arr.length < 2) return arr[0];
    let v, guard = 0;
    do { v = pick(arr); } while (v === last && ++guard < 12);
    return v;
  }

  /** Relance une animation CSS en la retirant puis la remettant. */
  function replay(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;           // force un reflow → l'animation repart
    el.classList.add(cls);
  }

  /* Les nombres écrits en lettres : la synthèse vocale française
     prononce alors « cinquante-six » sans risque d'ambiguïté. */
  const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept',
    'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze',
    'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const TENS = { 20: 'vingt', 30: 'trente', 40: 'quarante', 50: 'cinquante',
    60: 'soixante', 70: 'soixante', 80: 'quatre-vingt', 90: 'quatre-vingt' };

  function enLettres(n) {
    n = Math.round(n);
    if (n < 0) return 'moins ' + enLettres(-n);
    if (n < 20) return UNITS[n];
    if (n >= 100) {
      const c = Math.floor(n / 100), r = n % 100;
      const head = (c === 1 ? 'cent' : enLettres(c) + ' cent');
      return r ? head + ' ' + enLettres(r) : head;
    }
    // 70-79 et 90-99 : le français compose sur soixante / quatre-vingt
    const base = n < 70 ? Math.floor(n / 10) * 10
               : n < 80 ? 60
               : 80;
    const rest = n - base;
    const out = TENS[base];
    if (rest === 0) return base === 80 ? 'quatre-vingts' : out;
    // « vingt et un », « soixante et onze » — mais « quatre-vingt-un » et
    // « quatre-vingt-onze », sans « et ».
    if ((rest === 1 || rest === 11) && base !== 80) return out + ' et ' + UNITS[rest];
    return out + '-' + enLettres(rest);
  }

  /* Une image que le CODE nomme passe par ici. Le jeu en un seul fichier
     (empaqueter.js) en fournit le contenu dans MX.IMG ; sinon, c'est le
     fichier de img/. La feuille de style et index.html n'en ont pas besoin :
     l'empaqueteur réécrit leurs chemins lui-même. */
  const img = (chemin) => (MX.IMG && MX.IMG[chemin]) || chemin;

  return { $, $$, clamp, rand, randInt, pick, shuffle, pickFresh, replay, enLettres, img };
})();
