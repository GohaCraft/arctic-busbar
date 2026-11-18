/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/frost-scene.js
   Процедурная «картинка за окном» для #bgCanvas (без внешних изображений): полярные сумерки #050E1A → #0D2238 → #03070E,
   огни подстанции (боке: ледяной циан / янтарь / изумруд), силуэты порталов и опор, метель, дымка;
   а также текстура изморози по краям стекла и конденсатная вуаль. Два режима отрисовки одной сцены:
   renderSharp — чёткая (видна в дорожках капель и внутри капель), renderSoft — расфокус (видна сквозь запотевшее стекло).
   API: window.FrostScene.create(seed) → { resize, update, renderSharp, renderSoft, makeFrost, makeFogTex } */
(function (g) {
'use strict';
const TAU = Math.PI * 2;
const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
function radial(size, stops) {
  const c = mk(size, size), x = c.getContext('2d'), r = size / 2, gr = x.createRadialGradient(r, r, 0, r, r, r);
  stops.forEach(s => gr.addColorStop(s[0], s[1])); x.fillStyle = gr; x.fillRect(0, 0, size, size); return c;
}

/* ---------- спрайты ---------- */
const COLORS = { ice: [96, 205, 255], cyan: [150, 226, 255], amber: [255, 184, 64], emerald: [60, 222, 156], white: [226, 240, 255] };
const SPR = {};
Object.keys(COLORS).forEach(k => { const c = COLORS[k];
  SPR[k] = { glow: radial(128, [[0, rgba(c, 1)], [.1, rgba(c, .9)], [.3, rgba(c, .3)], [.65, rgba(c, .07)], [1, rgba(c, 0)]]),
             disc: radial(128, [[0, rgba(c, .12)], [.7, rgba(c, .2)], [.9, rgba(c, .38)], [1, rgba(c, 0)]]) }; });
const FLAKE = radial(32, [[0, 'rgba(255,255,255,.95)'], [.35, 'rgba(235,245,255,.55)'], [1, 'rgba(235,245,255,0)']]);
const MIST = (() => { const c = mk(256, 64), x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 256, 0);
  gr.addColorStop(0, 'rgba(190,220,250,0)'); gr.addColorStop(.5, 'rgba(190,220,250,.9)'); gr.addColorStop(1, 'rgba(190,220,250,0)'); x.fillStyle = gr; x.fillRect(0, 0, 256, 64);
  x.globalCompositeOperation = 'destination-in'; const v = x.createLinearGradient(0, 0, 0, 64); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(.5, '#000'); v.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = v; x.fillRect(0, 0, 256, 64); return c; })();

/* ---------- силуэты подстанции (рисуются один раз) ---------- */
function portal(c, x, y, gw, hh) {
  c.fillRect(x - gw / 2 - 1.5, y - hh, 3, hh); c.fillRect(x + gw / 2 - 1.5, y - hh, 3, hh);
  c.fillRect(x - gw / 2 - 5, y - hh, gw + 10, 3.4); c.fillRect(x - gw / 2 - 2, y - hh * .62, gw + 4, 2);
  for (let k = -1; k <= 1; k++) { const ix = x + k * gw / 3; c.fillRect(ix - 1.1, y - hh + 3, 2.2, 15);
    for (let j = 0; j < 4; j++) { c.beginPath(); c.arc(ix, y - hh + 6 + j * 3.4, 2.4, 0, TAU); c.fill(); } }
}
function tower(c, x, y, hg) {
  const w0 = hg * .17, w1 = hg * .03; c.lineWidth = 1.5; c.beginPath();
  c.moveTo(x - w0, y); c.lineTo(x - w1, y - hg); c.moveTo(x + w0, y); c.lineTo(x + w1, y - hg);
  const n = Math.round(hg / 16);
  for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n, a0 = w0 + (w1 - w0) * t0, a1 = w0 + (w1 - w0) * t1;
    c.moveTo(x - a0, y - hg * t0); c.lineTo(x + a1, y - hg * t1); c.moveTo(x + a0, y - hg * t0); c.lineTo(x - a1, y - hg * t1); c.moveTo(x - a1, y - hg * t1); c.lineTo(x + a1, y - hg * t1); }
  c.moveTo(x - hg * .16, y - hg * .88); c.lineTo(x + hg * .16, y - hg * .88); c.moveTo(x - hg * .11, y - hg * .72); c.lineTo(x + hg * .11, y - hg * .72); c.stroke();
}
function drawFar(c, w, h, R) {
  const gy = h * .74, ground = x => gy + Math.sin(x * .011) * 5 + Math.sin(x * .037 + 1.7) * 3;
  const gr = c.createLinearGradient(0, gy - 12, 0, h); gr.addColorStop(0, '#05121F'); gr.addColorStop(.3, '#020811'); gr.addColorStop(1, '#010409');
  c.fillStyle = '#020912'; c.strokeStyle = '#020912';
  const n = Math.max(5, Math.round(w / 190)), xs = [];
  for (let i = 0; i < n; i++) { const x = (i + .5 + (R() - .5) * .45) * (w / n), hh = h * (.11 + R() * .09); xs.push([x, ground(x), hh]); portal(c, x, ground(x) + 2, 54 + R() * 26, hh); }
  c.lineWidth = .9; c.strokeStyle = 'rgba(2,9,18,.92)';
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < 2; k++) { const a = xs[i], b = xs[i + 1]; c.beginPath(); c.moveTo(a[0], a[1] - a[2] + 5 + k * 3); c.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - (a[2] + b[2]) / 2 + 5 + 16, b[0], b[1] - b[2] + 5 + k * 3); c.stroke(); }
  c.fillStyle = '#020912'; c.strokeStyle = '#020912'; tower(c, w * .06, ground(w * .06) + 2, h * .36); tower(c, w * .94, ground(w * .94) + 2, h * .32);
  for (let i = 0; i < 6; i++) { const x = (i + .3 + R() * .4) * (w / 6), bw = 26 + R() * 22, bh = 12 + R() * 10; c.fillRect(x, ground(x) - bh + 3, bw, bh);   // трансформаторы
    for (let k = 0; k < 5; k++) c.fillRect(x + 3 + k * (bw - 6) / 4, ground(x) - bh - 7 + 3, 2, 8); }
  c.fillStyle = gr; c.beginPath(); c.moveTo(0, h); c.lineTo(0, ground(0));
  for (let x = 0; x <= w + 24; x += 24) c.lineTo(x, ground(x)); c.lineTo(w, h); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(150,195,240,.17)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, ground(0));
  for (let x = 0; x <= w + 24; x += 24) c.lineTo(x, ground(x)); c.stroke();                      // подсвеченная снегом линия горизонта
}

/* ---------- сцена ---------- */
function create(seed) {
  const R = rng(seed || 2026), S = { w: 0, h: 0, far: null, sky: null, t: 0 };
  const lights = [], pick = a => a[(R() * a.length) | 0];
  const strat = (n, y0, y1, cols, r0, r1, depth) => { for (let i = 0; i < n; i++) lights.push({ x: (i + .15 + R() * .7) / n, y: y0 + R() * (y1 - y0), c: pick(cols), r: r0 + R() * (r1 - r0), ph: R() * TAU, f: .5 + R() * 1.5, d: depth }); };
  strat(10, .62, .74, ['cyan', 'white', 'ice'], 2.4, 4.2, .5);          // прожекторы ОРУ
  strat(6, .58, .78, ['amber'], 2.6, 4.6, .55);                          // натриевые светильники
  strat(6, .70, .83, ['emerald'], 1.8, 3.2, .6);                         // индикаторы ячеек
  strat(5, .28, .52, ['ice', 'cyan'], 1.4, 2.4, .25);                    // дальние мачты
  const flakes = Array.from({ length: 190 }, () => ({ x: R(), y: R(), z: .15 + R() * .85, ph: R() * TAU, s: .6 + R() * 1.7 }));
  const mist = Array.from({ length: 4 }, (_, i) => ({ x: R(), y: .2 + i * .17 + R() * .08, w: .8 + R() * .7, h: .12 + R() * .1, v: .006 + R() * .01, a: .04 + R() * .05 }));
  const wind = t => 24 + 20 * Math.sin(t * .21) + 11 * Math.sin(t * .53 + 1);

  function resize(wl, hl, ss) {                                        // wl,hl — логические px (с запасом), ss — масштаб острого слоя
    S.w = wl; S.h = hl; S.sky = null;
    const far = mk(wl * ss, hl * ss), c = far.getContext('2d'); c.setTransform(ss, 0, 0, ss, 0, 0); drawFar(c, wl, hl, rng(7)); S.far = far;
  }
  function update(dt) {
    S.t += dt; const wv = wind(S.t);
    flakes.forEach(f => { f.y += (12 + 40 * f.z) * dt / S.h; f.x += (wv * (.35 + f.z) + Math.sin(f.ph + S.t * .8) * 7) * dt / S.w; if (f.y > 1.02) { f.y = -.02; f.x = R(); } if (f.x > 1.02) f.x -= 1.04; else if (f.x < -.02) f.x += 1.04; });
    mist.forEach(m => { m.x += m.v * dt * (1 + wv / 40); if (m.x > 1.3) m.x = -1.3; });
  }
  function sky(c) {
    if (!S.sky) { const gr = c.createLinearGradient(0, 0, 0, S.h); gr.addColorStop(0, '#050E1A'); gr.addColorStop(.55, '#0D2238'); gr.addColorStop(.74, '#0B1E33'); gr.addColorStop(1, '#03070E'); S.sky = gr; }
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.fillStyle = S.sky; c.fillRect(0, 0, S.w, S.h);
    c.globalCompositeOperation = 'lighter';
    const t = S.t, a = c.createRadialGradient(S.w * (.3 + .05 * Math.sin(t * .05)), S.h * .12, 0, S.w * .3, S.h * .12, S.w * .5);        // слабое полярное сияние
    a.addColorStop(0, 'rgba(52,211,153,.07)'); a.addColorStop(1, 'rgba(52,211,153,0)'); c.fillStyle = a; c.fillRect(0, 0, S.w, S.h * .7);
    const b = c.createRadialGradient(S.w * (.72 + .05 * Math.cos(t * .04)), S.h * .18, 0, S.w * .72, S.h * .18, S.w * .45);
    b.addColorStop(0, 'rgba(56,189,248,.07)'); b.addColorStop(1, 'rgba(56,189,248,0)'); c.fillStyle = b; c.fillRect(0, 0, S.w, S.h * .7);
    c.save(); c.translate(S.w / 2, S.h * .74); c.scale(1, .22); const hz = c.createRadialGradient(0, 0, 0, 0, 0, S.w * .62);               // зарево на горизонте
    hz.addColorStop(0, 'rgba(70,140,210,.30)'); hz.addColorStop(1, 'rgba(70,140,210,0)'); c.fillStyle = hz; c.fillRect(-S.w, -S.w, S.w * 2, S.w * 2); c.restore();
    c.globalCompositeOperation = 'source-over';
  }
  function mistLayer(c, p, k) { c.globalCompositeOperation = 'lighter'; mist.forEach(m => { c.globalAlpha = m.a * k; c.drawImage(MIST, m.x * S.w + p.x, m.y * S.h + p.y, m.w * S.w, m.h * S.h); }); c.globalAlpha = 1; }
  function snow(c, p, big, alpha) {
    c.globalCompositeOperation = 'lighter';
    flakes.forEach(f => { const s = f.s * (.8 + f.z * 1.6) * big, x = f.x * S.w + p.x * f.z, y = f.y * S.h + p.y * f.z; c.globalAlpha = alpha * (.25 + .75 * f.z); c.drawImage(FLAKE, x - s, y - s, s * 2, s * 2); });
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  const flick = (l, t) => .72 + .28 * Math.sin(t * l.f + l.ph) * Math.sin(t * l.f * .37 + l.ph * 2);

  /* чёткий слой: c уже имеет масштаб ss; P = {far,mid,near} смещения параллакса в логических px */
  function renderSharp(c, P) {
    sky(c); c.drawImage(S.far, 0, 0, S.w, S.h);                       // far уже в размере ss — масштаб применит setTransform
    const t = S.t; c.globalCompositeOperation = 'lighter';
    lights.forEach(l => { const x = l.x * S.w + P.mid.x * l.d * 1.6, y = l.y * S.h + P.mid.y * l.d * 1.6, f = flick(l, t), s = l.r * 7;
      c.globalAlpha = .85 * f; c.drawImage(SPR[l.c].glow, x - s, y - s, s * 2, s * 2);
      c.globalAlpha = .95 * f; c.drawImage(SPR.white.glow, x - l.r * .9, y - l.r * .9, l.r * 1.8, l.r * 1.8);
      if (l.c === 'amber' || l.c === 'white') { c.globalAlpha = .22 * f; c.drawImage(SPR[l.c].glow, x - l.r * 9, y - .5, l.r * 18, 1); } });
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    mistLayer(c, P.mid, 1); snow(c, P.near, 1, .85);
  }
  /* расфокус: большие мягкие пятна боке + дымка; снег — рыхлыми пятнами */
  function renderSoft(c, P) {
    sky(c); const t = S.t; c.globalCompositeOperation = 'lighter';
    lights.forEach(l => { const x = l.x * S.w + P.mid.x * l.d * 1.6, y = l.y * S.h + P.mid.y * l.d * 1.6, f = flick(l, t);
      let s = l.r * 15; c.globalAlpha = 1.15 * f; c.drawImage(SPR[l.c].disc, x - s, y - s, s * 2, s * 2);
      s = l.r * 11; c.globalAlpha = .62 * f; c.drawImage(SPR[l.c].glow, x - s, y - s, s * 2, s * 2); });
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.fillStyle = 'rgba(2,7,14,.55)'; c.fillRect(0, S.h * .76, S.w, S.h * .24);                 // тёмная земля в расфокусе
    mistLayer(c, P.mid, 1.8); snow(c, P.near, 3.2, .16);
  }

  /* ---------- изморозь по краям стекла (один раз на размер): молочная глазурь + перистые кристаллы + ледяная крошка ---------- */
  function makeFrost(cv, wl, hl, scale, sd) {
    const Rf = rng(sd || 99), c = cv.getContext('2d'); cv.width = Math.ceil(wl * scale); cv.height = Math.ceil(hl * scale);
    c.setTransform(scale, 0, 0, scale, 0, 0); c.clearRect(0, 0, wl, hl);
    const m = Math.min(wl, hl), dep = { top: m * .1, side: m * .115, bot: m * .17 };            // снизу стекло холоднее — мороза больше
    const glaze = (x0, y0, x1, y1, rx, ry, rw, rh, a) => { const gr = c.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, 'rgba(226,243,255,' + a + ')'); gr.addColorStop(.35, 'rgba(210,233,251,' + a * .42 + ')'); gr.addColorStop(1, 'rgba(204,228,247,0)'); c.fillStyle = gr; c.fillRect(rx, ry, rw, rh); };
    glaze(0, 0, 0, dep.top * 1.5, 0, 0, wl, dep.top * 1.5, .5); glaze(0, hl, 0, hl - dep.bot * 1.5, 0, hl - dep.bot * 1.5, wl, dep.bot * 1.5, .62);
    glaze(0, 0, dep.side * 1.5, 0, 0, 0, dep.side * 1.5, hl, .5); glaze(wl, 0, wl - dep.side * 1.5, 0, wl - dep.side * 1.5, 0, dep.side * 1.5, hl, .5);
    [[0, 0], [wl, 0], [0, hl], [wl, hl]].forEach(p => { const r = m * .3, gr = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], r); gr.addColorStop(0, 'rgba(230,245,255,.55)'); gr.addColorStop(1, 'rgba(230,245,255,0)'); c.fillStyle = gr; c.fillRect(p[0] - r, p[1] - r, r * 2, r * 2); });
    c.globalCompositeOperation = 'destination-out';                                           // неровная граница: вымываем мягкие «дырки»
    for (let i = 0; i < 1100; i++) { const x = Rf() * wl, y = Rf() * hl, e = Math.min(x / dep.side, (wl - x) / dep.side, y / dep.top, (hl - y) / dep.bot); if (e > 1.5 || Rf() > .22 + e * .5) continue;
      const r = 3 + Rf() * 15, gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(0,0,0,' + (.15 + Rf() * .4) + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2); }
    c.globalCompositeOperation = 'source-over'; c.lineCap = 'round';
    const P = [new Path2D(), new Path2D(), new Path2D()], W = [1, .75, .55], A = [.44, .35, .26];
    const seg = (k, x0, y0, x1, y1) => { P[k].moveTo(x0, y0); P[k].lineTo(x1, y1); };
    const fern = (x, y, ang, len) => {                                                         // перо: изогнутый стебель, ветви 60° с убывающей длиной
      const st = 3.6, n = Math.max(3, Math.round(len / st)), bend = (Rf() - .5) * .05; let px = x, py = y, side = Rf() < .5 ? 1 : -1;
      for (let i = 1; i <= n; i++) {
        ang += bend + (Rf() - .5) * .07; const nx = px + Math.cos(ang) * st, ny = py + Math.sin(ang) * st; seg(0, px, py, nx, ny); px = nx; py = ny; side = -side;
        const bl = (3 + len * .3 * Math.pow(Math.sin(Math.PI * (i / n * .85 + .05)), .7)) * (.7 + Rf() * .6), ba = ang + side * (1.02 + (Rf() - .5) * .25);
        const bx = px + Math.cos(ba) * bl, by = py + Math.sin(ba) * bl; seg(1, px, py, bx, by);
        if (bl > 6 && Rf() < .6) { const tm = .45 + Rf() * .2, tx = px + (bx - px) * tm, ty = py + (by - py) * tm, ta = ba - side * (1.0 + Rf() * .2), tl = bl * .4; seg(2, tx, ty, tx + Math.cos(ta) * tl, ty + Math.sin(ta) * tl); }
      }
    };
    const edges = [[0, 0, 1, 0, Math.PI / 2, dep.top], [wl, 0, 0, 1, Math.PI, dep.side], [wl, hl, -1, 0, -Math.PI / 2, dep.bot], [0, hl, 0, -1, 0, dep.side]];
    edges.forEach((e, k) => {
      const L = k % 2 ? hl : wl, N = Math.round(L / 13 * (k === 2 ? 1.15 : 1));
      for (let i = 0; i < N; i++) { const d = Rf() * L; fern(e[0] + e[2] * d, e[1] + e[3] * d, e[4] + (Rf() - .5) * .9, e[5] * (.24 + Rf() * Rf() * .72)); }
    });
    for (let k = 0; k < 3; k++) {                                                              // мягкое свечение кристаллов (рассеяние) + тонкая яркая жилка
      c.strokeStyle = 'rgba(232,245,255,' + A[k] * .1 + ')'; c.lineWidth = W[k] * 5.5; c.stroke(P[k]);
      c.strokeStyle = 'rgba(236,247,255,' + A[k] * .2 + ')'; c.lineWidth = W[k] * 2.6; c.stroke(P[k]);
      c.strokeStyle = 'rgba(240,249,255,' + A[k] + ')'; c.lineWidth = W[k]; c.stroke(P[k]);
    }
    const sp = [];
    for (let i = 0; i < 700; i++) { const x = Rf() * wl, y = Rf() * hl, e = Math.min(x / dep.side, (wl - x) / dep.side, y / dep.top, (hl - y) / dep.bot); if (e > 1.15 || Rf() > .92 - e * .75) continue;
      const r = .35 + Rf() * 1.0; c.fillStyle = 'rgba(245,251,255,' + (.3 + Rf() * .55) + ')'; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); if (Rf() < .12 && sp.length < 90) sp.push({ x, y, ph: Rf() * TAU, sp: .6 + Rf() * 1.8, s: 2 + Rf() * 3.5 }); }
    return sp;
  }
  /* вуаль конденсата: молочная дымка + неравномерные «пятна» + мелкое зерно (статичная текстура) */
  function makeFogTex(cv, wl, hl, scale) {
    const Rf = rng(515), c = cv.getContext('2d'); cv.width = Math.ceil(wl * scale); cv.height = Math.ceil(hl * scale); c.setTransform(scale, 0, 0, scale, 0, 0);
    const gr = c.createLinearGradient(0, 0, 0, hl); gr.addColorStop(0, 'rgba(176,206,232,.16)'); gr.addColorStop(.6, 'rgba(188,214,238,.21)'); gr.addColorStop(1, 'rgba(160,196,226,.27)'); c.fillStyle = gr; c.fillRect(0, 0, wl, hl);
    for (let i = 0; i < 70; i++) { const x = Rf() * wl, y = Rf() * hl, r = 60 + Rf() * 190, g2 = c.createRadialGradient(x, y, 0, x, y, r), light = Rf() < .55;
      g2.addColorStop(0, light ? 'rgba(210,230,248,' + (.03 + Rf() * .05) + ')' : 'rgba(6,16,30,' + (.05 + Rf() * .07) + ')'); g2.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g2; c.fillRect(x - r, y - r, r * 2, r * 2); }
    const n = mk(128, 128), nc = n.getContext('2d'), id = nc.createImageData(128, 128);
    for (let i = 0; i < id.data.length; i += 4) { const v = 150 + Rf() * 105; id.data[i] = v; id.data[i + 1] = v + 6; id.data[i + 2] = 255; id.data[i + 3] = Rf() * 26; }
    nc.putImageData(id, 0, 0); c.fillStyle = c.createPattern(n, 'repeat'); c.fillRect(0, 0, wl, hl);
  }
  return { resize, update, renderSharp, renderSoft, makeFrost, makeFogTex, lights, state: S };
}
g.FrostScene = { create, rng, mk };
})(window);
