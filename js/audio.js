/* ══════════════════════════════════════════════════════════════════
   audio.js — voix de synthèse (le cœur pédagogique) + bruitages
   Aucun fichier audio : tout est généré par WebAudio, et la voix vient
   de SpeechSynthesis (voix française fournie par le système).
   ══════════════════════════════════════════════════════════════════ */
MX.Audio = (function () {
  let ctx = null;             // AudioContext, créé au premier geste utilisateur
  let master = null;
  let voice = null;           // SpeechSynthesisVoice française retenue
  let voiceReady = false;
  let enabled = true;         // réglage « Voix » de l'écran d'accueil
  const synth = window.speechSynthesis || null;

  /* ─── Choix de la voix ──────────────────────────────────────────── */
  // Prénoms masculins courants des voix TTS françaises : un maître qui
  // hurle sonne plus juste avec une voix d'homme.
  const MALE_HINTS = /paul|thomas|nicolas|henri|guillaume|mathieu|claude|antoine|remy|rémy|male/i;

  function pickVoice() {
    if (!synth) return;
    const all = synth.getVoices();
    if (!all.length) return;
    const fr = all.filter(v => /^fr/i.test(v.lang));
    // Les voix locales sont plus réactives que les voix réseau : on les préfère.
    const local = fr.filter(v => v.localService);
    const pref = local.length ? local : fr;
    voice = pref.find(v => MALE_HINTS.test(v.name)) || pref[0] || null;
    voiceReady = !!voice;
  }
  if (synth) {
    pickVoice();
    synth.addEventListener('voiceschanged', pickVoice);
  }

  /** Retourne un libellé décrivant l'état de la voix, pour l'UI. */
  function voiceStatus() {
    if (!synth) return 'indisponible sur ce navigateur';
    if (!voiceReady) return 'aucune voix française trouvée';
    return voice.name;
  }

  /* ─── Initialisation (à appeler sur un vrai clic / appui) ────────── */
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    if (!voiceReady) pickVoice();
  }

  /* ─── Parole ────────────────────────────────────────────────────── */
  const MOODS = {
    calm:  { rate: 1.0,  pitch: 1.0,  volume: 1 },   // énoncé de la question
    quiz:  { rate: 1.12, pitch: 1.05, volume: 1 },   // rythme un peu pressé
    angry: { rate: 1.38, pitch: 0.55, volume: 1 },   // le maître hurle
    sly:   { rate: 0.86, pitch: 1.35, volume: 1 },   // le maître prépare un sale coup
    proud: { rate: 1.0,  pitch: 1.18, volume: 1 },
  };

  /* `say` dit le texte tel quel : c'est à qui le compose d'écrire les
     nombres en lettres (cf. `MX.Ops.dire`, `MX.Teacher.line`). */
  function say(text, mood, onEnd) {
    let ended = false;
    const finish = () => { if (ended) return; ended = true; if (onEnd) onEnd(); };
    if (!enabled || !synth || !voiceReady || !window.SpeechSynthesisUtterance || !text) {
      setTimeout(finish, 60); return;
    }
    try {
      const u = new window.SpeechSynthesisUtterance(text);
      const m = MOODS[mood] || MOODS.calm;
      u.rate = m.rate; u.pitch = m.pitch; u.volume = m.volume;
      u.lang = 'fr-FR';
      u.voice = voice;
      u.addEventListener('end', finish);
      u.addEventListener('error', finish);
      synth.speak(u);
    } catch (e) { finish(); }
  }

  function cancel() { if (synth) { try { synth.cancel(); } catch (e) {} } }

  /* ─── Bruitages synthétisés ─────────────────────────────────────── */
  let noiseBuf = null;
  function noise() {
    if (!noiseBuf) {
      const n = ctx.sampleRate * 1.2;
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    return src;
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ctx.currentTime + dur);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol == null ? 0.3 : vol, ctx.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }

  const sfx = {
    /** Buzz de manette : quelqu'un s'est engagé. */
    buzz() {
      if (!ctx) return;
      tone(520, 0.07, 'square', 0.16);
      setTimeout(() => tone(760, 0.06, 'square', 0.13), 45);
    },
    /** Bonne réponse : quinte montante joyeuse. */
    ding() {
      if (!ctx) return;
      tone(784, 0.18, 'sine', 0.26);
      setTimeout(() => tone(1175, 0.3, 'sine', 0.22), 70);
      setTimeout(() => tone(1568, 0.4, 'triangle', 0.12), 140);
    },
    /** Erreur : klaxon rageur. */
    wrong() {
      if (!ctx) return;
      tone(196, 0.34, 'sawtooth', 0.3, 62);
      tone(148, 0.34, 'square', 0.16, 48);
    },
    /** Craie qui grince sur l'ardoise — pour les chausse-trappes. */
    chalk() {
      if (!ctx) return;
      const src = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 12;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0005, ctx.currentTime + 0.42);
      bp.frequency.linearRampToValueAtTime(1100, ctx.currentTime + 0.42);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(); src.stop(ctx.currentTime + 0.45);
    },
    /** Tic-tac du chrono. */
    tick(high) {
      if (!ctx) return;
      tone(high ? 1500 : 1050, 0.035, 'square', high ? 0.13 : 0.07);
    },
    /** Coup de règle sur le bureau. */
    slam() {
      if (!ctx) return;
      const src = noise(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      g.gain.setValueAtTime(0.55, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + 0.22);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(); src.stop(ctx.currentTime + 0.25);
      tone(84, 0.2, 'sine', 0.4, 40);
    },
    /** Cloche de fin de partie. */
    bell() {
      if (!ctx) return;
      [523, 659, 784, 1046].forEach((f, i) =>
        setTimeout(() => tone(f, 1.1, 'sine', 0.2), i * 110));
    },
    /** Souffle : une nouvelle question arrive. */
    whoosh() {
      if (!ctx) return;
      const src = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(260, ctx.currentTime);
      bp.frequency.exponentialRampToValueAtTime(2600, ctx.currentTime + 0.24);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.14, ctx.currentTime + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0005, ctx.currentTime + 0.3);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(); src.stop(ctx.currentTime + 0.32);
    },
  };

  return {
    init, say, cancel, sfx, voiceStatus,
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; if (!v) cancel(); },
  };
})();
