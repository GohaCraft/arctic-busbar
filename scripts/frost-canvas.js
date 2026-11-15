/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/frost-canvas.js  (оркестратор #bgCanvas)
   Слои за кадр: чёткая сцена (frost-scene) → запотевшее стекло = расфокус сцены + вуаль, в котором капли (frost-drops) стирают
   дорожки через маску → капли с преломлением → изморозь по краям + мерцание. Параллакс — пружины Гука (мышь / наклон телефона /
   медленное «дыхание»); смещения слоёв разные. Мазок пальцем/мышью по фону стирает запотевание. Регулятор качества держит ~60 FPS.
   API: window.FrostCanvas { start, stop, pulse(a), wipe(x,y,px,py), setReduced(b), stats() }.
   CSS-переменные на #auth: --px, --py ∈ [-1..1] (для лёгкого смещения карточки). Сам включается при body.locked и гасится без него. */
(function (g) {
'use strict';
const cv = document.getElementById('bgCanvas');
if (!cv || !g.FrostScene || !g.FrostDrops || !cv.getContext) { g.FrostCanvas = { ok: false, start() {}, stop() {}, pulse() {}, wipe() {}, setReduced() {}, stats: () => ({}) }; return; }
const ctx = cv.getContext('2d', { alpha: false }), mk = g.FrostScene.mk, PAD = 28, TAU = Math.PI * 2;
const QUAL = [{ dpr: 1, sharp: .33, soft: .18, mask: .45, sparkle: false }, { dpr: 1.25, sharp: .42, soft: .2, mask: .55, sparkle: true }, { dpr: 1.5, sharp: .5, soft: .25, mask: .6, sparkle: true }];
const lay = () => ({ c: mk(1, 1), x: null });
const sharp = lay(), soft = lay(), fog = lay(), mask = lay(), ridge = lay(), fogTex = lay(), frost = lay();   // mask — стёртое запотевание, ridge — влажный ободок вокруг дорожек
const scene = g.FrostScene.create(2026), rnd = g.FrostScene.rng(4242);
const SPARK = (() => { const c = mk(32, 32), x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.18, 'rgba(220,240,255,.6)'); gr.addColorStop(1, 'rgba(220,240,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
  x.fillStyle = 'rgba(255,255,255,.8)'; x.fillRect(1, 15.4, 30, 1.2); x.fillRect(15.4, 1, 1.2, 30); return c; })();
const st = { q: 2, W: 0, H: 0, Wl: 0, Hl: 0, dpr: 1, raf: 0, last: 0, acc: 0, t: 0, running: false, reduced: false, ema: 16.7, slowMs: 0, heal: 0, frames: 0, fps: 60, msS: 0, msR: 0 };
let drops = null, sparkles = [], dropsDirty = true;

/* ---------- пружины ---------- */
function Spring(k, z) { this.x = 0; this.v = 0; this.to = 0; this.k = k; this.c = 2 * z * Math.sqrt(k); }
Spring.prototype.step = function (dt) { const a = this.k * (this.to - this.x) - this.c * this.v; this.v += a * dt; this.x += this.v * dt; };
const L = { far: [new Spring(34, .8), new Spring(34, .8)], mid: [new Spring(46, .72), new Spring(46, .72)], near: [new Spring(62, .64), new Spring(62, .64)], glass: [new Spring(80, .56), new Spring(80, .56)] };
const LA = Object.keys(L).map(k => L[k]);
const AMP = { far: [4, 3], mid: [9, 6], near: [15, 10], glass: [18, 12] };
const inp = { mx: 0, my: 0, gx: 0, gy: 0, hasGyro: false, lastMove: -99, idle: 1, b0: null, g0: 0 };
const P = { far: { x: 0, y: 0 }, mid: { x: 0, y: 0 }, near: { x: 0, y: 0 } };
const G = { x: 0, y: 0 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function springs(dt) {
  const sway = inp.idle, t = st.t;
  const tx = clamp(inp.mx + inp.gx + sway * .45 * Math.sin(t * .17), -1.3, 1.3), ty = clamp(inp.my + inp.gy + sway * .3 * Math.sin(t * .11 + 1), -1.3, 1.3);
  const n = Math.max(1, Math.ceil(dt / .008)), h = dt / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < LA.length; j++) { LA[j][0].to = -tx; LA[j][1].to = -ty; LA[j][0].step(h); LA[j][1].step(h); }
  ['far', 'mid', 'near'].forEach(k => { P[k].x = L[k][0].x * AMP[k][0]; P[k].y = L[k][1].x * AMP[k][1]; });
  G.x = L.glass[0].x * AMP.glass[0]; G.y = L.glass[1].x * AMP.glass[1];
  const a = document.getElementById('auth');
  if (a) { const px = -L.glass[0].x, py = -L.glass[1].x; if (Math.abs(px - (a._px || 0)) > .002 || Math.abs(py - (a._py || 0)) > .002) { a._px = px; a._py = py; a.style.setProperty('--px', px.toFixed(3)); a.style.setProperty('--py', py.toFixed(3)); } }
}
g.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  inp.mx = (e.clientX / (st.W || 1)) * 2 - 1; inp.my = (e.clientY / (st.H || 1)) * 2 - 1; inp.lastMove = st.t;
  if (e.buttons & 1 && e.target === cv && wipeLast) wipe(e.clientX, e.clientY, wipeLast.x, wipeLast.y);
  wipeLast = e.buttons & 1 && e.target === cv ? { x: e.clientX, y: e.clientY } : null;
}, { passive: true });
g.addEventListener('pointerdown', e => { wipeLast = e.target === cv ? { x: e.clientX, y: e.clientY } : null; if (wipeLast) wipe(e.clientX, e.clientY, e.clientX, e.clientY); }, { passive: true });
g.addEventListener('pointerup', () => { wipeLast = null; }, { passive: true });
document.addEventListener('mouseleave', () => { inp.mx = 0; inp.my = 0; });
let wipeLast = null, askedGyro = false;
function onOrient(e) {
  if (e.gamma == null || e.beta == null) return;
  if (inp.b0 == null) { inp.b0 = e.beta; }
  inp.b0 += (e.beta - inp.b0) * .004; inp.gx = clamp(e.gamma / 24, -1, 1); inp.gy = clamp((e.beta - inp.b0) / 24, -1, 1); inp.hasGyro = true; inp.lastMove = st.t;
}
g.addEventListener('deviceorientation', onOrient, { passive: true });
g.addEventListener('pointerdown', () => {                                                        // iOS: разрешение на датчики — только по жесту
  if (askedGyro) return; askedGyro = true;
  try { if (g.DeviceOrientationEvent && typeof g.DeviceOrientationEvent.requestPermission === 'function') g.DeviceOrientationEvent.requestPermission().catch(() => {}); } catch (e) { /* нет датчиков */ }
}, { once: true, passive: true });

/* ---------- размеры и текстуры ---------- */
function size(o, w, h) { o.c.width = Math.max(1, Math.ceil(w)); o.c.height = Math.max(1, Math.ceil(h)); o.x = o.c.getContext('2d'); o.x.imageSmoothingEnabled = true; o.x.imageSmoothingQuality = 'low'; }
function resize() {
  const Q = QUAL[st.q], oldW = st.Wl, keeps = [mask, ridge].map(o => { if (!o.x || !oldW) return null; const k = mk(o.c.width, o.c.height); k.getContext('2d').drawImage(o.c, 0, 0); return k; });
  st.W = Math.max(320, g.innerWidth); st.H = Math.max(320, g.innerHeight); st.dpr = Math.min(g.devicePixelRatio || 1, Q.dpr);
  cv.width = Math.round(st.W * st.dpr); cv.height = Math.round(st.H * st.dpr); st.Wl = st.W + PAD * 2; st.Hl = st.H + PAD * 2;
  size(sharp, st.Wl * Q.sharp, st.Hl * Q.sharp); size(soft, st.Wl * Q.soft, st.Hl * Q.soft); size(fog, st.Wl * Q.mask, st.Hl * Q.mask);
  [mask, ridge].forEach((o, i) => { size(o, st.Wl * Q.mask, st.Hl * Q.mask); if (keeps[i]) o.x.drawImage(keeps[i], 0, 0, o.c.width, o.c.height); });
  scene.resize(st.Wl, st.Hl, Q.sharp); scene.makeFogTex(fogTex.c, st.Wl, st.Hl, Q.mask);
  sparkles = scene.makeFrost(frost.c, st.Wl, st.Hl, st.dpr, 99);
  if (!drops) drops = g.FrostDrops.create(st.Wl, st.Hl, rnd); else drops.resize(st.Wl, st.Hl);
  if (dropsDirty) { dropsDirty = false; warm(12); }
}
function trail(x0, y0, x1, y1, w) {                                                               // дорожка капли стирает запотевание
  const m = mask.x, k = QUAL[st.q].mask; m.setTransform(k, 0, 0, k, 0, 0);
  m.beginPath(); m.moveTo(x0, y0); m.lineTo(x1, y1); m.lineCap = 'butt'; m.strokeStyle = 'rgba(255,255,255,.3)'; m.lineWidth = w * 1.4; m.stroke();
  m.lineCap = 'round'; m.strokeStyle = '#fff'; m.lineWidth = w; m.stroke();
  const r = ridge.x; r.setTransform(k, 0, 0, k, 0, 0); r.beginPath(); r.moveTo(x0, y0); r.lineTo(x1, y1); r.lineCap = 'butt'; r.strokeStyle = 'rgba(205,228,248,.55)'; r.lineWidth = w * 2.1; r.stroke();
}
function wipe(cx, cy, px, py) {                                                                    // мазок пальцем по запотевшему стеклу
  if (!mask.x) return; const m = mask.x, k = QUAL[st.q].mask; m.setTransform(k, 0, 0, k, 0, 0);
  const ax = cx + PAD - G.x, ay = cy + PAD - G.y, bx = px + PAD - G.x, by = py + PAD - G.y; m.lineCap = 'round';
  m.beginPath(); m.moveTo(bx, by); m.lineTo(ax, ay); m.strokeStyle = 'rgba(255,255,255,.4)'; m.lineWidth = 52; m.stroke(); m.strokeStyle = '#fff'; m.lineWidth = 34; m.stroke();
  const r = ridge.x; r.setTransform(k, 0, 0, k, 0, 0); r.lineCap = 'round'; r.beginPath(); r.moveTo(bx, by); r.lineTo(ax, ay); r.strokeStyle = 'rgba(205,228,248,.5)'; r.lineWidth = 66; r.stroke();
}
function healMask() {                                                                              // шаг ≥ 8/255: иначе 8-битная альфа «залипает» призрачным следом
  [mask, ridge].forEach(o => { const m = o.x; m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = 'destination-out'; m.fillStyle = 'rgba(0,0,0,.0314)'; m.fillRect(0, 0, o.c.width, o.c.height); m.globalCompositeOperation = 'source-over'; });
}
function warm(sec) { for (let i = 0, n = Math.round(sec * 30); i < n; i++) { drops.step(1 / 30, trail); if (i % 15 === 14) healMask(); } }

/* ---------- кадр ---------- */
function render() {
  const Q = QUAL[st.q], Wl = st.Wl, Hl = st.Hl, t = st.t;
  if (st.q === 2 || (st.frames & 1) === 0 || st.reduced) {                                           // на слабом железе сцена обновляется через кадр
    sharp.x.setTransform(Q.sharp, 0, 0, Q.sharp, 0, 0); scene.renderSharp(sharp.x, P);
    soft.x.setTransform(Q.soft, 0, 0, Q.soft, 0, 0); scene.renderSoft(soft.x, P);
  }
  const f = fog.x; f.setTransform(1, 0, 0, 1, 0, 0);
  f.globalCompositeOperation = 'copy'; f.drawImage(soft.c, 0, 0, fog.c.width, fog.c.height);
  f.globalCompositeOperation = 'source-over'; f.drawImage(fogTex.c, 0, 0, fog.c.width, fog.c.height); f.globalAlpha = .5; f.drawImage(ridge.c, 0, 0, fog.c.width, fog.c.height); f.globalAlpha = 1;
  f.globalCompositeOperation = 'destination-out'; f.drawImage(mask.c, 0, 0, fog.c.width, fog.c.height); f.globalCompositeOperation = 'source-over';
  ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(sharp.c, -PAD, -PAD, Wl, Hl); ctx.drawImage(fog.c, -PAD + G.x, -PAD + G.y, Wl, Hl);
  ctx.save(); ctx.translate(-PAD + G.x, -PAD + G.y); drops.draw(ctx, sharp.c, Q.sharp, Wl, Hl, G.x, G.y); ctx.restore();
  ctx.drawImage(frost.c, -PAD + G.x, -PAD + G.y, Wl, Hl);
  if (Q.sparkle && !st.reduced) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < sparkles.length; i++) { const s = sparkles[i], a = Math.pow(Math.max(0, Math.sin(t * s.sp + s.ph)), 6); if (a < .04) continue; ctx.globalAlpha = a * .9; const z = s.s * 2.2; ctx.drawImage(SPARK, s.x - PAD + G.x - z, s.y - PAD + G.y - z, z * 2, z * 2); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
}
function frame(now) {
  st.raf = g.requestAnimationFrame(frame);
  if (!st.last) { st.last = now; return; }
  const raw = (now - st.last) / 1000; st.last = now; st.acc += raw; if (st.acc < 1 / 62) return;
  const dt = Math.min(.05, st.acc); st.acc = 0; st.t += dt; st.frames++;
  st.ema += (dt * 1000 - st.ema) * .06; st.fps = Math.round(1000 / st.ema);
  if (st.ema > 26 && st.q > 0) { st.slowMs += dt * 1000; if (st.slowMs > 2500) { st.q--; st.slowMs = 0; st.ema = 16.7; resize(); } } else st.slowMs = 0;     // автоснижение качества
  inp.idle += ((st.t - inp.lastMove > 2.5 ? 1 : 0) - inp.idle) * Math.min(1, dt * .8);
  const a0 = performance.now(); springs(dt); scene.update(dt); drops.step(dt, trail); if ((st.heal += dt) >= .5) { st.heal = 0; healMask(); }
  const a1 = performance.now(); render(); const a2 = performance.now(); st.msS += (a1 - a0 - st.msS) * .05; st.msR += (a2 - a1 - st.msR) * .05;
}

/* ---------- управление ---------- */
const locked = () => document.body.classList.contains('locked');
function start() {
  if (st.running) return; st.running = true; st.last = 0; st.acc = 0;
  st.reduced = g.matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('no-animations');
  if (!st.W) resize();
  if (st.reduced) { springs(.02); render(); return; }                                              // режим энергосбережения: один статичный кадр
  st.raf = g.requestAnimationFrame(frame);
}
function stop() { st.running = false; g.cancelAnimationFrame(st.raf); st.raf = 0; }
function sync() { if (locked() && !st.running) start(); else if (!locked() && st.running) stop(); }
let rz = 0; g.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (st.W) { resize(); if (st.reduced && st.running) render(); } }, 160); });
document.addEventListener('visibilitychange', () => { st.last = 0; });
if (g.MutationObserver) new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });

g.FrostCanvas = { ok: true, start, stop, wipe,
  pulse(a) { a = a == null ? 1 : a; if (drops) drops.nudge(a); Object.keys(L).forEach(k => { L[k][0].v += (rnd() - .5) * 26 * a; L[k][1].v += (rnd() - .5) * 18 * a; }); if (st.reduced && st.running) render(); },
  setReduced(b) { stop(); document.body.classList.toggle('no-animations', !!b); start(); },
  stats: () => ({ fps: st.fps, quality: st.q, drops: drops ? drops.drops.length : 0, sliding: drops ? drops.drops.filter(d => d.slide).length : 0, running: st.running, w: st.W, h: st.H, msSim: +st.msS.toFixed(2), msRender: +st.msR.toFixed(2) }) };
const init = () => { resize(); sync(); };
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})(window);
