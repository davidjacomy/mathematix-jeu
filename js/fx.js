/* ══════════════════════════════════════════════════════════════════
   fx.js — le « game feel » : secousses, flashs, poussière de craie.
   Un seul canvas plein écran gère toutes les particules.
   ══════════════════════════════════════════════════════════════════ */
MX.FX = (function () {
  const { $, rand, randInt, pick, replay } = MX.U;

  let cv, cx, W = 0, H = 0, dpr = 1;
  const parts = [];
  let running = false;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function init() {
    cv = $('#fx-canvas'); cx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  /* ─── Particules ────────────────────────────────────────────────── */
  function spawn(o) { parts.push(o); if (!running) { running = true; requestAnimationFrame(loop); } }

  /** Nuage de poussière de craie : la marque de fabrique du jeu. */
  function chalkDust(x, y, count, color) {
    for (let i = 0; i < (count || 26); i++) {
      const a = rand(0, Math.PI * 2), sp = rand(40, 340);
      spawn({
        kind: 'dust',
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(20, 90),
        r: rand(1.4, 5.2),
        life: 1, decay: rand(0.5, 1.25),
        col: color || '#f2efe0',
      });
    }
  }

  /** Éclats anguleux : impact d'une mauvaise réponse. */
  function shards(x, y, count, color) {
    for (let i = 0; i < (count || 14); i++) {
      const a = rand(0, Math.PI * 2), sp = rand(180, 620);
      spawn({
        kind: 'shard',
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        len: rand(9, 28), ang: a, spin: rand(-9, 9),
        life: 1, decay: rand(1.1, 2.1),
        col: color || '#ff2b45',
      });
    }
  }

  /** Confettis : podium et bonnes séries. */
  function confetti(x, y, count, colors) {
    const pal = colors || ['#ff5a5f', '#4ecdc4', '#ffd23f', '#b98bff', '#f2efe0'];
    for (let i = 0; i < (count || 40); i++) {
      spawn({
        kind: 'conf',
        x: x + rand(-40, 40), y,
        vx: rand(-260, 260), vy: rand(-620, -240),
        w: rand(5, 11), h: rand(8, 16), ang: rand(0, 6.3), spin: rand(-8, 8),
        life: 1, decay: rand(0.34, 0.62),
        col: pick(pal),
      });
    }
  }

  function loop(t) {
    const dt = 1 / 60;
    cx.clearRect(0, 0, W, H);

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= p.decay * dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.kind === 'dust') {
        p.vy += 260 * dt;                 // gravité douce
        p.vx *= 0.965; p.vy *= 0.985;     // la poussière freine dans l'air
        cx.globalAlpha = p.life * 0.9;
        cx.fillStyle = p.col;
        cx.beginPath();
        cx.arc(p.x, p.y, p.r * p.life, 0, 6.2832);
        cx.fill();
      } else if (p.kind === 'shard') {
        p.vy += 700 * dt; p.ang += p.spin * dt;
        cx.globalAlpha = p.life;
        cx.strokeStyle = p.col;
        cx.lineWidth = 3;
        cx.beginPath();
        cx.moveTo(p.x, p.y);
        cx.lineTo(p.x + Math.cos(p.ang) * p.len * p.life, p.y + Math.sin(p.ang) * p.len * p.life);
        cx.stroke();
      } else {
        p.vy += 900 * dt; p.vx *= 0.99; p.ang += p.spin * dt;
        cx.globalAlpha = Math.min(1, p.life * 1.6);
        cx.fillStyle = p.col;
        cx.save();
        cx.translate(p.x, p.y); cx.rotate(p.ang);
        cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        cx.restore();
      }
    }
    cx.globalAlpha = 1;

    if (parts.length) requestAnimationFrame(loop);
    else running = false;
  }

  /* ─── Effets plein écran ────────────────────────────────────────── */
  function shake(power) {
    const stage = $('#stage');
    stage.classList.remove('shake-s', 'shake-m', 'shake-l');
    void stage.offsetWidth;
    stage.classList.add(power === 'l' ? 'shake-l' : power === 'm' ? 'shake-m' : 'shake-s');
    setTimeout(() => stage.classList.remove('shake-s', 'shake-m', 'shake-l'), 1100);
  }

  function flash(kind) {
    const f = $('#flash');
    f.classList.remove('fire', 'fire-good');
    void f.offsetWidth;
    f.classList.add(kind === 'good' ? 'fire-good' : 'fire');
  }

  /** Centre géométrique d'un élément, en pixels écran. */
  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  return { init, chalkDust, shards, confetti, shake, flash, centerOf };
})();
