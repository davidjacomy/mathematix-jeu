/* ══════════════════════════════════════════════════════════════════
   sw.js — le jeu reste jouable sans connexion

   Ce « service worker » n'existe que pour la version EN LIGNE du jeu
   (installée comme une appli, ou ouverte dans un navigateur) : le
   navigateur le refuse en file://, et le double-clic sur index.html
   fonctionne sans lui.

   RÉSEAU D'ABORD : en ligne, chaque fichier est redemandé, donc toujours la
   dernière version publiée — aucun numéro de version à tenir à jour. La
   copie gardée ne sert que hors connexion. Les polices de Google, elles,
   ne changent jamais : la copie gardée passe d'abord.

   COEUR liste ce qu'il faut pour jouer dès la première visite, avant même
   d'avoir tout parcouru : tous les fichiers du site publié (cf. publier.js
   §SITE), sauf celui-ci. tests/publication.test.js vérifie les deux listes
   l'une contre l'autre.

   Les polices ne se gardent qu'à la DEUXIÈME visite en ligne : à la
   première, la page les a chargées avant que ce script ne la surveille.
   ══════════════════════════════════════════════════════════════════ */
const CACHE = 'mathematix';
const COEUR = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/util.js', 'js/audio.js', 'js/fx.js', 'js/operations.js', 'js/questions.js',
  'js/traps.js', 'js/teacher.js', 'js/input.js', 'js/memoire.js', 'js/game.js', 'js/main.js',
  'img/maitre-neutral.webp', 'img/maitre-rage.webp', 'img/maitre-pleased.webp',
  'img/maitre-sly.webp', 'img/maitre-dead.webp', 'img/maitre-icone.png',
  'img/ardoise.webp', 'img/planche.webp', 'img/cloche.webp', 'img/carnet.webp', 'img/etoile.webp',
  'img/icone-192.png', 'img/icone-512.png', 'img/icone-masquable-512.png', 'img/icone-apple-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(COEUR)).then(() => self.skipWaiting()));
});

/* Aucun ménage dans les autres caches : le domaine davidjacomy.github.io
   est partagé par tous les sites publiés du compte, et leurs caches sont
   dans le même tiroir que celui-ci. Un seul cache, jamais renommé : rien à
   nettoyer. */
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// Une copie qui ne s'écrit pas (stockage plein) laisse la précédente : le
// jeu en ligne n'en dépend pas.
function garder(requete, reponse) {
  const copie = reponse.clone();
  caches.open(CACHE).then(c => c.put(requete, copie)).catch(() => {});
  return reponse;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then(rep => (rep.ok ? garder(req, rep) : rep))
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
  } else if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    // La feuille des polices arrive « opaque » (chargée sans CORS) : son
    // statut est illisible, on la garde quand même — c'est la seule façon.
    e.respondWith(caches.match(req).then(r => r || fetch(req)
      .then(rep => (rep.ok || rep.type === 'opaque' ? garder(req, rep) : rep))));
  }
});
