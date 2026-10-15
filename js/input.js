/* ══════════════════════════════════════════════════════════════════
   input.js — inscriptions, navigation et commandes clavier / manette.
   En partie, le jeu reçoit seulement (joueur, case 0-3).
   Les 4 cases suivent la disposition physique des boutons de manette :
        0 = HAUT (Y/△)   1 = GAUCHE (X/□)   2 = DROITE (B/○)   3 = BAS (A/✕)
   ══════════════════════════════════════════════════════════════════ */
MX.Input = (function () {

  /* Une « manette clavier » par joueur : 4 touches en losange.
     On lit event.key pour les lettres (indépendant du layout AZERTY /
     QWERTY) et event.code pour le pavé numérique (sinon la rangée de
     chiffres du haut déclencherait aussi). Les flèches viennent en tête :
     c'est le pupitre du joueur seul, celui qu'on prend sans rien choisir. */
  const KB_LAYOUTS = [
    { label: 'Flèches',        keys: { arrowup: 0, arrowleft: 1, arrowright: 2, arrowdown: 3 } },
    { label: 'Z Q S D',        keys: { z: 0, q: 1, d: 2, s: 3 } },
    { label: 'I J K L',        keys: { i: 0, j: 1, l: 2, k: 3 } },
    { label: 'Pavé num. (ou T F G H)', keys: { t: 0, f: 1, h: 2, g: 3 },
      codes: { Numpad8: 0, Numpad4: 1, Numpad6: 2, Numpad2: 3 } },
  ];

  // Manette standard : index du bouton → case du losange.
  const PAD_FACE = { 3: 0, 2: 1, 1: 2, 0: 3 };            // Y, X, B, A
  const PAD_DPAD = { 12: 0, 14: 1, 15: 2, 13: 3 };        // croix directionnelle
  const PAD_START = [9, 8];                                // Start / Options / Select
  const MENU_DIR = ['up', 'left', 'right', 'down'];
  const MENU_DELAY = 380, MENU_REPEAT = 140;

  let mode = 'lobby';                  // 'lobby' | 'play' | 'paused' | 'idle'
  const players = [];                  // [{id, device}] dans l'ordre d'inscription
  const padPrev = {};                  // état précédent des boutons, par manette
  let cbJoin = null, cbBuzz = null, cbStart = null, cbPause = null, cbMenu = null;
  let polling = false;
  let padsStatus = 'unsupported';

  const deviceKey = (d) => d.type === 'pad' ? 'pad' + d.index
    : d.type === 'pointer' ? 'pointer' : 'kb' + d.layout;

  function deviceLabel(d) {
    if (d.type === 'pad') return 'Manette ' + (d.index + 1);
    if (d.type === 'pointer') return 'Souris / toucher';
    return 'Clavier · ' + KB_LAYOUTS[d.layout].label;
  }

  function findPlayer(d) {
    const k = deviceKey(d);
    return players.find(p => deviceKey(p.device) === k) || null;
  }

  function isTaken(d) { return !!findPlayer(d); }

  function isValid(d) {
    return !!d && (d.type === 'pointer'
      || (d.type === 'pad' && Number.isInteger(d.index) && d.index >= 0)
      || (d.type === 'kb' && Number.isInteger(d.layout) && !!KB_LAYOUTS[d.layout]));
  }

  function joinDevice(device) {
    if (mode !== 'lobby' || !isValid(device)) return null;
    const existing = findPlayer(device);
    if (existing) return existing;
    if (players.length >= 4) return null;
    const p = { id: players.length, device: { ...device } };
    players.push(p);
    if (cbJoin) cbJoin(p);
    return p;
  }

  /** Le joueur garde sa place et sa couleur, et prend un périphérique libre. */
  function reassign(id, device) {
    if (mode !== 'lobby' || !isValid(device)) return null;
    const p = players.find(x => x.id === id);
    if (!p) return null;
    const owner = findPlayer(device);
    if (owner) return owner === p ? p : null;
    p.device = { ...device };
    return p;
  }

  /* La souris n'a pas besoin d'inscription : elle répond pour le joueur
     inscrit à la souris seule, sinon pour le premier joueur au clavier —
     clavier et souris sont sur la même table —, à défaut pour le premier. */
  function mousePlayer() {
    return players.find(p => p.device.type === 'pointer')
      || players.find(p => p.device.type === 'kb') || players[0] || null;
  }

  function playerLabel(p) {
    const label = deviceLabel(p.device);
    return p.device.type === 'kb' && mousePlayer() === p ? label + ' + souris' : label;
  }

  function removePlayer(id) {
    if (mode !== 'lobby') return false;
    const index = players.findIndex(p => p.id === id);
    if (index < 0) return false;
    players.splice(index, 1);
    players.forEach((p, i) => { p.id = i; });
    return true;
  }

  /* ─── Inscription / buzz ────────────────────────────────────────── */
  function handle(device, slot) {
    if (mode === 'lobby') {
      joinDevice(device);
      return;
    }
    if (mode === 'play') {
      const p = findPlayer(device);
      if (!p || slot == null) return;
      if (cbBuzz) cbBuzz(p.id, slot);
    }
  }

  /* `device` : la manette qui a appuyé sur Start. Le clavier ne se nomme
     pas — Entrée n'appartient à aucun pupitre. */
  function handleStart(device) { if (cbStart) cbStart(device); }
  function handleMenu(action, device) { if (cbMenu) cbMenu(action, device); }

  function isControl(target) {
    return !!(target && (target.isContentEditable || (target.closest && target.closest(
      'button, input, select, textarea, summary, a[href], [contenteditable], [role="button"], [role="radio"]'
    ))));
  }

  /* ─── Clavier ───────────────────────────────────────────────────────
     On se fie uniquement à e.repeat pour filtrer l'auto-répétition. Un
     registre « touches enfoncées » serait piégeux : si le keyup est perdu
     (alt-tab, fenêtre qui perd le focus), la touche resterait bloquée et
     le joueur ne pourrait plus buzzer du tout.                         */
  function onKeyDown(e) {
    if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
    const k = (e.key || '').toLowerCase();
    const code = e.code;
    const startKey = k === 'enter' || k === ' ' || code === 'Space';

    if (k === 'escape') {
      e.preventDefault();
      if (!e.repeat && cbPause) cbPause();
      return;
    }

    // Les boutons conservent leur activation native, même sur une réponse
    // du plateau. Les touches du pupitre restent actives pendant le jeu.
    // Un maintien ne doit pas cliquer de nouveau après un changement d'écran.
    if (isControl(e.target) && (mode !== 'play' || startKey)) {
      if (startKey && e.repeat) e.preventDefault();
      return;
    }

    if (startKey) {
      e.preventDefault();
      if (!e.repeat) handleStart();
      return;
    }

    for (let L = 0; L < KB_LAYOUTS.length; L++) {
      const lay = KB_LAYOUTS[L];
      let slot = lay.keys[k];
      if (slot == null && lay.codes) slot = lay.codes[code];
      if (slot == null) continue;
      if (k.startsWith('arrow')) e.preventDefault();
      if (e.repeat) return;
      handle({ type: 'kb', layout: L }, slot);
      return;
    }
  }

  /* ─── Manettes ──────────────────────────────────────────────────── */
  function readPads() {
    if (!navigator.getGamepads) { padsStatus = 'unsupported'; return []; }
    try {
      const pads = navigator.getGamepads() || [];
      padsStatus = 'available';
      return pads;
    } catch (_) {
      // Une API exposée mais refusée (contexte / politique du navigateur)
      // ne doit pas tuer la boucle, ni les inscriptions clavier / souris.
      padsStatus = 'blocked';
      return [];
    }
  }

  function pollPads() {
    const pads = readPads();
    const frameMode = mode;
    const pending = [];
    for (let i = 0; i < pads.length; i++) {
      const gp = pads[i];
      if (!gp || !gp.connected) { delete padPrev[i]; continue; }
      const prev = padPrev[i] || (padPrev[i] = {});
      const edges = [], held = [];

      for (let b = 0; b < gp.buttons.length; b++) {
        const now = gp.buttons[b].pressed || gp.buttons[b].value > 0.55;
        const was = !!prev[b];
        prev[b] = now;
        if (now) held.push(b);
        if (now && !was) edges.push(b);            // front montant
      }

      // Stick analogique traité comme la croix directionnelle
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const dz = 0.65;
      const dir = Math.abs(ax) > Math.abs(ay)
        ? (ax > dz ? 2 : ax < -dz ? 1 : null)
        : (ay > dz ? 3 : ay < -dz ? 0 : null);
      const stickEdge = dir != null && prev._stick !== dir;
      prev._stick = dir;

      const dpad = held.find(b => PAD_DPAD[b] != null);
      const menuDir = dpad == null ? dir : PAD_DPAD[dpad];
      const now = performance.now();
      const directionEdge = menuDir != null && prev._menuDir !== menuDir;
      const directionRepeat = menuDir != null && now >= prev._menuAt;
      prev._menuDir = menuDir;
      if (menuDir == null || frameMode === 'play') prev._menuAt = Infinity;
      else if (directionEdge) prev._menuAt = now + MENU_DELAY;
      else if (directionRepeat) prev._menuAt = now + MENU_REPEAT;

      const device = { type: 'pad', index: i };
      // On mémorise TOUS les fronts avant de notifier main.js : un callback
      // peut changer d'écran. Le même appui ne doit pas traverser cet écran.
      if (edges.some(b => PAD_START.includes(b))) pending.push(() => handleStart(device));
      else if (frameMode === 'play') {
        const button = edges.find(b => PAD_FACE[b] != null || PAD_DPAD[b] != null);
        const slot = button == null ? (stickEdge ? dir : null)
          : PAD_FACE[button] != null ? PAD_FACE[button] : PAD_DPAD[button];
        if (slot != null) pending.push(() => handle(device, slot));
      } else if (menuDir != null && (directionEdge || directionRepeat)) {
        prev._menuUsed = true;
        pending.push(() => handleMenu(MENU_DIR[menuDir], device));
      } else {
        const face = edges.find(b => PAD_FACE[b] != null);
        if (face == null) continue;
        const joined = isTaken(device);
        if (frameMode === 'lobby' && !joined && (!prev._menuUsed || face > 1)) {
          pending.push(() => joinDevice(device));
        } else if (face === 0) pending.push(() => handleMenu('confirm', device));
        else if (face === 1) pending.push(() => handleMenu('back', device));
      }
    }
    // Les index disparus sont purgés même si le tableau getGamepads se réduit.
    for (const i of Object.keys(padPrev))
      if (!pads[i] || !pads[i].connected) delete padPrev[i];
    for (const action of pending) {
      if (mode !== frameMode) break;
      action();
    }
    if (polling) requestAnimationFrame(pollPads);
  }

  /* ─── API ───────────────────────────────────────────────────────── */
  function start() {
    if (polling) return;
    polling = true;
    window.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(pollPads);
  }

  function reset() {
    players.length = 0;
    for (const prev of Object.values(padPrev)) prev._menuUsed = false;
  }

  /** Liste des périphériques encore libres, pour le choix du lobby. */
  function freeDevices() {
    const out = [];
    const pads = readPads();
    for (let i = 0; i < pads.length; i++)
      if (pads[i] && pads[i].connected && !isTaken({ type: 'pad', index: i }))
        out.push({ type: 'pad', index: i });
    for (let L = 0; L < KB_LAYOUTS.length; L++)
      if (!isTaken({ type: 'kb', layout: L })) out.push({ type: 'kb', layout: L });
    if (!isTaken({ type: 'pointer' })) out.push({ type: 'pointer' });
    return out;
  }

  function padCount() {
    const pads = readPads();
    let n = 0;
    for (const p of pads) if (p && p.connected) n++;
    return n;
  }

  return {
    start, reset, joinDevice, reassign, removePlayer, deviceLabel, playerLabel, mousePlayer,
    freeDevices, padCount,
    padStatus() { readPads(); return padsStatus; },
    KB_LAYOUTS,
    get players() { return players; },
    set mode(m) {
      if (mode !== m) for (const prev of Object.values(padPrev)) prev._menuAt = Infinity;
      mode = m;
    },
    get mode() { return mode; },
    onJoin(cb) { cbJoin = cb; },
    onBuzz(cb) { cbBuzz = cb; },
    onStart(cb) { cbStart = cb; },
    onPause(cb) { cbPause = cb; },
    onMenu(cb) { cbMenu = cb; },
  };
})();
