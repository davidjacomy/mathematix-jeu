/* ══════════════════════════════════════════════════════════════════
   memoire.js — ce que le maître retient d'une partie à l'autre

   Deux carnets, dans le stockage local du navigateur :

   • le CARNET des calculs à revoir. Un calcul raté y entre avec une
     « dette » ; chaque partie où il est réussi sans faute la rembourse
     d'un cran, et il sort du carnet quand elle est soldée. C'est ce qui
     fait de la révision autre chose qu'un tirage : ce qui a coincé
     revient, ce qui est acquis s'efface ;

   • les RECORDS, un meilleur score par réglage de partie.

   Rien ici ne distingue les joueurs : la mémoire est celle de la maison.
   Tout accès au stockage peut échouer (navigation privée, ouverture en
   file:// sur certains navigateurs) — le jeu doit alors tourner comme si
   le carnet était vide, sans rien signaler.
   ══════════════════════════════════════════════════════════════════ */
MX.Memoire = (function () {
  const Ops = MX.Ops;

  const K_CARNET = 'mathematix.carnet.v1';
  const K_RECORDS = 'mathematix.records.v1';
  const DETTE_MAX = 3;          // un calcul raté dix fois ne revient pas dix parties
  const FAITS_MAX = 60;         // au-delà, les plus anciens sortent
  const RECORDS_MAX = 40;

  function lire(cle) {
    try {
      const v = JSON.parse(window.localStorage.getItem(cle));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (_) { return {}; }
  }

  function ecrire(cle, valeur) {
    try { window.localStorage.setItem(cle, JSON.stringify(valeur)); } catch (_) { /* carnet non mémorisé */ }
  }

  /** Le carnet, purgé de ce qui n'est pas un calcul lisible. */
  function carnet() {
    const brut = lire(K_CARNET), out = {};
    for (const cle of Object.keys(brut)) {
      const dette = brut[cle];
      if (Ops.fromKey(cle) && Number.isInteger(dette) && dette > 0) out[cle] = Math.min(dette, DETTE_MAX);
    }
    return out;
  }

  /** Les clés des calculs à revoir, du plus ancien au plus récent. */
  function cles() { return Object.keys(carnet()); }

  /** Enregistre l'issue d'une partie. `bilan` = { clé: { ok, ko } }, tous
      joueurs confondus : une seule erreur suffit à inscrire le calcul. */
  function noter(bilan) {
    const c = carnet();
    for (const cle of Object.keys(bilan || {})) {
      const b = bilan[cle];
      if (!Ops.fromKey(cle) || !b) continue;
      if (b.ko > 0) {
        const dette = Math.min(DETTE_MAX, (c[cle] || 0) + 1);
        delete c[cle];             // réinscrit en dernier : c'est le plus récent
        c[cle] = dette;
      } else if (b.ok > 0 && c[cle]) {
        if (--c[cle] <= 0) delete c[cle];
      }
    }
    const garde = Object.keys(c).slice(-FAITS_MAX);
    const out = {};
    for (const cle of garde) out[cle] = c[cle];
    ecrire(K_CARNET, out);
    return garde;
  }

  function vider() { ecrire(K_CARNET, {}); }

  /** Compare un score au record de ce réglage, et le remplace s'il est battu.
      Rend { record, ancien, battu } ; `ancien` vaut null à la première partie. */
  function record(signature, score) {
    const r = lire(K_RECORDS);
    const ancien = Number.isFinite(r[signature]) ? r[signature] : null;
    const battu = score > 0 && (ancien == null || score > ancien);
    if (battu) {
      delete r[signature];
      r[signature] = score;
      const out = {};
      for (const cle of Object.keys(r).slice(-RECORDS_MAX)) out[cle] = r[cle];
      ecrire(K_RECORDS, out);
    }
    return { record: battu ? score : ancien, ancien, battu };
  }

  return { cles, noter, vider, record, K_CARNET, K_RECORDS };
})();
