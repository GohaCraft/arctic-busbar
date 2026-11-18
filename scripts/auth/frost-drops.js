/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/frost-drops.js
   Капли конденсата на стекле: рост от конденсации → срыв при критическом радиусе → скольжение с инерцией, «прилипанием»,
   микро-отклонением (процесс Орнштейна-Уленбека), потерей объёма на дорожку и мелкими каплями-бусинами вдоль пути;
   слияние с сохранением площади и импульсом ускорения. Отрисовка: тень, преломлённая ПЕРЕВЁРНУТАЯ картинка сцены внутри капли,
   внутренняя тень, блики и каустика. API: window.FrostDrops.create(W, H, rand) → { step, draw, nudge, resize, drops }.
   Дорожки не рисуются здесь: step() вызывает trail(x0, y0, x1, y1, width) — маску стирания запотевания ведёт frost-canvas.js. */
(function (g) {
'use strict';
const TAU = Math.PI * 2, BIG = 3.4;                                           // r ≥ BIG — «крупная» капля с преломлением

function bead(tint) {                                                         // спрайт мелкой капли 64×64 (радиус тела 22)
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  let gr = x.createRadialGradient(32, 33, 13, 32, 33, 31); gr.addColorStop(0, 'rgba(0,8,16,0)'); gr.addColorStop(.78, 'rgba(0,8,16,.55)'); gr.addColorStop(1, 'rgba(0,8,16,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  gr = x.createRadialGradient(26, 24, 2, 32, 32, 22); gr.addColorStop(0, 'rgba(' + tint + ',.62)'); gr.addColorStop(.6, 'rgba(' + tint + ',.2)'); gr.addColorStop(1, 'rgba(' + tint + ',.07)');
  x.fillStyle = gr; x.beginPath(); x.arc(32, 32, 22, 0, TAU); x.fill();
  gr = x.createLinearGradient(32, 40, 38, 56); gr.addColorStop(0, 'rgba(210,235,255,0)'); gr.addColorStop(1, 'rgba(210,235,255,.5)'); x.fillStyle = gr; x.beginPath(); x.arc(32, 32, 21, .25, 2.9); x.fill();
  x.fillStyle = 'rgba(255,255,255,.95)'; x.beginPath(); x.ellipse(24.5, 23.5, 5.6, 3.6, -.7, 0, TAU); x.fill();
  return c;
}
const SPRITES = ['196,226,255', '255,226,190', '190,255,230'].map(bead);

function create(W, H, R) {
  const S = { W, H, t: 0, frame: 0, spawn: 0, top: 0, drops: [] };
  const kA = () => Math.max(.35, Math.min(1.3, S.W * S.H / (1920 * 1080)));
  const rand = (a, b) => a + R() * (b - a);
  const mk = (x, y, r, o) => Object.assign({ x, y, r, vx: 0, vy: 0, slide: false, rc: rand(7.5, 12.5), grow: rand(.03, .42) * (r < 4 ? .35 : 1), boost: 0, pause: 0, wob: 0,
    wph: R() * TAU, leak: rand(.7, 1.45), dist: 0, dead: false, tint: R() < .6 ? 0 : (R() < .5 ? 1 : 2) }, o || {});
  const spawnOne = heavy => { S.drops.push(mk(R() * S.W, rand(-10, S.H * .55), heavy ? rand(9, 13.5) : rand(4.5, 8.5), heavy ? { slide: true, vy: 16 } : null)); };

  function populate() {
    const k = kA(); S.drops.length = 0;
    for (let i = 0, n = Math.round(300 * k); i < n; i++) S.drops.push(mk(R() * S.W, R() * S.H, .8 + R() * R() * 1.9, { grow: rand(.01, .07) }));
    for (let i = 0, n = Math.round(44 * k); i < n; i++) S.drops.push(mk(R() * S.W, R() * S.H, 3 + R() * R() * 5.5));
    for (let i = 0, n = Math.round(8 * k); i < n; i++) S.drops.push(mk(R() * S.W, R() * S.H * .8, rand(8.5, 13), { slide: true, vy: rand(20, 50) }));
  }
  function absorb(big, small) {
    const a1 = big.r * big.r, a2 = small.r * small.r, w = a2 / (a1 + a2) * (small.slide ? 1 : .55);
    big.x += (small.x - big.x) * w; big.y += (small.y - big.y) * w; big.r = Math.sqrt(a1 + a2 * .94);
    big.boost = Math.min(1.5, big.boost + .22 + Math.min(.9, a2 / a1 * 1.8)); big.wob = 1;       // ускорение и «дрожь» после слияния
    big.vy += 8 + small.r * 1.4; if (!big.slide && big.r >= big.rc * .9) { big.slide = true; big.vy = Math.max(big.vy, 18); }
    small.dead = true;
  }
  function step(dt, trail) {
    S.t += dt; S.frame++; const D = S.drops, k = kA();
    if ((S.spawn -= dt) <= 0) { S.spawn = rand(.35, .95) / k; spawnOne(R() < .26); }
    if ((S.top -= dt) <= 0) { S.top = 1; let n = 0; D.forEach(d => { if (d.slide && !d.dead) n++; }); if (n < 13 * k) spawnOne(true); }
    for (let i = 0; i < D.length; i++) {
      const d = D[i]; if (d.dead) continue; d.wob *= Math.exp(-dt * 3.2);
      if (!d.slide) { if (d.r < 7.8) d.r += d.grow * dt * (1 - d.r / 13); if (d.r >= d.rc) { d.slide = true; d.vy = 6; } continue; }
      const over = Math.max(0, d.r - 3.2); let vt = (7 + 7.8 * over) * (1 + d.boost);
      if (d.pause > 0) { d.pause -= dt; vt = 0; } else if (d.r < 8.8 && R() < dt * .35) d.pause = rand(.25, 1.1);   // прилипание–скольжение
      d.vy += (vt - d.vy) * Math.min(1, dt * 3.2); d.boost = Math.max(0, d.boost - dt * .9);
      d.vx += (-d.vx * 1.6 + (R() - .5) * 28) * dt; d.vx = Math.max(-10, Math.min(10, d.vx));        // микро-отклонение
      const ox = d.x, oy = d.y; d.x += (d.vx + Math.sin(S.t * 1.7 + d.wph) * 2.4) * dt; d.y += d.vy * dt;
      const ds = Math.hypot(d.x - ox, d.y - oy); d.r -= ds * .0125 * d.leak;                           // капля расходуется на дорожку
      if (ds > 0 && trail) trail(ox, oy, d.x, d.y, Math.max(2, d.r * 1.32) * (.93 + .14 * Math.sin(d.y * .07 + d.wph)));
      d.dist += ds; if (d.dist > 20 + R() * 34) { d.dist = 0; if (R() < .62) D.push(mk(d.x + (R() < .5 ? -1 : 1) * d.r * rand(.7, 1.3), d.y - d.r * rand(.2, 1.1), rand(.8, 2.1), { grow: rand(.01, .06) })); }
      if (d.r < 4.1) { d.slide = false; d.vy = 0; d.vx = 0; d.rc = d.r + rand(5, 9); d.grow = rand(.05, .3); }     // капля иссякла и замерла в конце дорожки
      else if (d.y - d.r > S.H + 24) d.dead = true;
      for (let j = 0; j < D.length; j++) {                                                               // слияние с соседями на пути
        const o = D[j]; if (o === d || o.dead || d.dead) continue; const dx = o.x - d.x; if (dx > d.r + 18 || dx < -d.r - 18) continue;
        if (Math.hypot(dx, o.y - d.y) < (d.r + o.r) * .82) { if (d.r >= o.r) absorb(d, o); else absorb(o, d); }
      }
    }
    if (S.frame % 12 === 0) {                                                                            // слияние растущих неподвижных
      const m = D.filter(d => !d.dead && !d.slide && d.r >= 2.2);
      for (let a = 0; a < m.length; a++) for (let b = a + 1; b < m.length; b++) { const p = m[a], q = m[b]; if (p.dead || q.dead) continue; if (Math.hypot(p.x - q.x, p.y - q.y) < (p.r + q.r) * .8) { if (p.r >= q.r) absorb(p, q); else absorb(q, p); } }
    }
    if (S.frame % 30 === 0) {                                                                            // уборка и лимит мелких
      let w = 0, tiny = 0; for (let i = 0; i < D.length; i++) { const d = D[i]; if (d.dead) continue; D[w++] = d; if (d.r < BIG && !d.slide) tiny++; } D.length = w;
      const cap = Math.round(430 * k); for (let i = 0; i < D.length && tiny > cap; i++) if (D[i].r < BIG && !D[i].slide && R() < .3) { D[i].dead = true; tiny--; }
    }
  }
  function drawBig(c, d, sharp, ss, ox, oy) {                                                            // ox, oy — сдвиг стекла относительно сцены (параллакс)
    const r = d.r, sq = d.wob * Math.sin(S.t * 22 + d.wph) * .1, el = d.slide ? Math.min(.14, d.vy / 800) : 0;
    const rx = r * (.94 - sq), ry = r * (1.06 + sq + el), x = d.x, y = d.y;
    let gr = c.createRadialGradient(x + r * .14, y + r * .32, r * .2, x + r * .14, y + r * .32, r * 1.55); gr.addColorStop(0, 'rgba(0,6,14,.36)'); gr.addColorStop(1, 'rgba(0,6,14,0)');
    c.fillStyle = gr; c.fillRect(x - r * 1.7, y - r * 1.3, r * 3.4, r * 3.4);                           // мягкая тень под каплей
    c.save(); c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.clip(); c.translate(x, y); c.scale(1, -1);
    const hw = rx * 2.3, hh = ry * 2.3;                                                                  // линза: широкий угол, картинка перевёрнута
    c.drawImage(sharp, (x - hw + ox) * ss, (y - hh + ry * .25 + oy) * ss, hw * 2 * ss, hh * 2 * ss, -rx, -ry, rx * 2, ry * 2); c.restore();
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU);
    gr = c.createRadialGradient(x - rx * .15, y - ry * .2, Math.min(rx, ry) * .25, x, y, Math.max(rx, ry)); gr.addColorStop(0, 'rgba(0,12,24,0)'); gr.addColorStop(.7, 'rgba(0,12,24,.2)'); gr.addColorStop(1, 'rgba(0,10,20,.64)');
    c.fillStyle = gr; c.fill();
    gr = c.createLinearGradient(x, y + ry * .1, x, y + ry); gr.addColorStop(0, 'rgba(190,225,255,0)'); gr.addColorStop(1, 'rgba(190,225,255,.4)'); c.fillStyle = gr; c.fill();   // каустика снизу
    c.lineWidth = Math.max(.7, r * .07); c.strokeStyle = 'rgba(210,235,255,.3)'; c.stroke();
    c.fillStyle = 'rgba(255,255,255,.88)'; c.beginPath(); c.ellipse(x - rx * .36, y - ry * .4, rx * .27, ry * .15, -.65, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,.36)'; c.beginPath(); c.ellipse(x + rx * .34, y + ry * .38, rx * .12, ry * .07, -.65, 0, TAU); c.fill();
  }
  function draw(c, sharp, ss, vw, vh, ox, oy) {                                                          // vw, vh — границы видимости (логические px)
    const D = S.drops; ox = ox || 0; oy = oy || 0;
    for (let i = 0; i < D.length; i++) { const d = D[i]; if (d.dead || d.r >= BIG || d.x < -8 || d.x > vw + 8 || d.y < -8 || d.y > vh + 8) continue; const s = d.r * 2.91; c.drawImage(SPRITES[d.tint], d.x - s / 2, d.y - s / 2, s, s); }
    for (let i = 0; i < D.length; i++) { const d = D[i]; if (d.dead || d.r < BIG || d.x < -20 || d.x > vw + 20 || d.y < -20 || d.y > vh + 20) continue; drawBig(c, d, sharp, ss, ox, oy); }
  }
  function nudge(a) { a = a || 1; S.drops.forEach(d => { if (d.r >= BIG) { d.wob = Math.min(1, d.wob + .8 * a); if (d.slide) d.boost = Math.min(1.5, d.boost + .5 * a); else if (R() < .2 * a) d.rc = d.r * .96; } }); spawnOne(true); }
  function resize(w, h) { const sx = w / S.W, sy = h / S.H; S.drops.forEach(d => { d.x *= sx; d.y *= sy; }); S.W = w; S.H = h; }
  populate();
  return { step, draw, nudge, resize, drops: S.drops, state: S, populate };
}
g.FrostDrops = { create, BIG };
})(window);
