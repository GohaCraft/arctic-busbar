/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/auth/frost-scene.js  (ЭТАП 3)
   Процедурная «картинка за окном» для #bgCanvas (без внешних изображений): небо, огни подстанции, силуэты порталов и опор,
   метель и дымка; плюс текстуры стекла — тонкая виньетка изморози по краям и конденсатная вуаль.
   Два режима отрисовки одной сцены: renderSharp — чёткая (видна в дорожках капель и внутри капель), renderSoft — расфокус
   (видна сквозь запотевшее стекло; огни — мягкие гауссовы пятна, никаких «мыльных пузырей»).

   ЭТАП 3 — сцена зависит от времени суток и от режима «Полярная ночь 24/7»:
     • setTime(часы 0..24) — небо плавно проходит ночь → рассвет → день → закат → вечер → ночь (ключевые палитры + smoothstep);
       мощность огней подстанции (прожекторы ОРУ и натриевые светильники гаснут днём, светодиоды ячеек горят всегда);
     • setPolar(true|false) — за ~2 с перетекает в палитру полярной ночи: глубокие сумерки, северное сияние (занавесы),
       плотная пурга (до 420 хлопьев, ветер сильнее, хлопья вытянуты по ветру) и густая дымка с порывами;
     • snap() — применить сразу (без перетекания), palette — текущая палитра (для CSS --sky-l и тестов).
   Нижней «ёлочной» бахромы (перистые кристаллы изморози) больше нет: только тонкая молочная виньетка по краю и ледяная крошка.
   API: window.FrostScene.create(seed) → { resize, update, renderSharp, renderSoft, makeFrost, makeFogTex, setTime, setPolar, snap, flakeCount, lights, state } */
(function (g) {
'use strict';
const TAU = Math.PI * 2;
const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const rgba = (c, a) => 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')';
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = k => { k = clamp01(k); return k * k * (3 - 2 * k); };
function radial(size, stops) {
  const c = mk(size, size), x = c.getContext('2d'), r = size / 2, gr = x.createRadialGradient(r, r, 0, r, r, r);
  stops.forEach(s => gr.addColorStop(s[0], s[1])); x.fillStyle = gr; x.fillRect(0, 0, size, size); return c;
}
/* гауссов спад яркости: exp(-4.2·r²) — мягкое пятно без кольца по краю */
function gauss(size, c, peak) {
  const st = []; for (let i = 0; i <= 10; i++) { const r = i / 10; st.push([r, rgba(c, i === 10 ? 0 : +(peak * Math.exp(-4.2 * r * r)).toFixed(4))]); }
  return radial(size, st);
}

/* ---------- спрайты ---------- */
const COLORS = { ice: [96, 205, 255], cyan: [150, 226, 255], amber: [255, 184, 64], emerald: [60, 222, 156], white: [226, 240, 255] };
const SPR = {};
Object.keys(COLORS).forEach(k => { const c = COLORS[k];
  SPR[k] = { glow: radial(128, [[0, rgba(c, 1)], [.1, rgba(c, .9)], [.3, rgba(c, .3)], [.65, rgba(c, .07)], [1, rgba(c, 0)]]), soft: gauss(128, c, 1) }; });
const FLAKE = radial(32, [[0, 'rgba(255,255,255,.95)'], [.35, 'rgba(235,245,255,.55)'], [1, 'rgba(235,245,255,0)']]);
const MIST = (() => { const c = mk(256, 64), x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 256, 0);
  gr.addColorStop(0, 'rgba(190,220,250,0)'); gr.addColorStop(.5, 'rgba(190,220,250,.9)'); gr.addColorStop(1, 'rgba(190,220,250,0)'); x.fillStyle = gr; x.fillRect(0, 0, 256, 64);
  x.globalCompositeOperation = 'destination-in'; const v = x.createLinearGradient(0, 0, 0, 64); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(.5, '#000'); v.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = v; x.fillRect(0, 0, 256, 64); return c; })();
/* занавес полярного сияния: яркая нижняя кромка (изумруд) → бирюза → фиолетовая «вуаль» вверху; по бокам мягкий спад */
const AUR = (() => { const w = 64, h = 256, c = mk(w, h), x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(150,110,255,0)'); gr.addColorStop(.26, 'rgba(116,140,255,.15)'); gr.addColorStop(.54, 'rgba(60,224,208,.4)'); gr.addColorStop(.8, 'rgba(70,255,156,.82)');
  gr.addColorStop(.93, 'rgba(130,255,196,1)'); gr.addColorStop(1, 'rgba(130,255,196,0)'); x.fillStyle = gr; x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'destination-in'; const hg = x.createLinearGradient(0, 0, w, 0); hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(.5, '#000'); hg.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = hg; x.fillRect(0, 0, w, h); return c; })();

/* ---------- палитры неба по часам ----------
   top/mid/low/bot — стопы вертикального градиента (0 / .55 / .74 / 1), glow — зарево на горизонте [r,g,b,a], gnd — вуаль над землёй [r,g,b,a],
   lamps — общая мощность огней 0..1, aur — вес северного сияния 0..1, lum — «светлота неба» 0..1 (для --sky-l: днём стекло карточки плотнее).
   Дневная палитра намеренно приглушена (сталь, не белое): белый текст на стекле остаётся читаемым. */
const PAL = (top, mid, low, bot, glow, lamps, aur, lum, gnd) => ({ top, mid, low, bot, glow, lamps, aur, lum, gnd });
const NIGHT = PAL([5, 14, 26], [13, 34, 56], [11, 30, 51], [3, 7, 14], [70, 140, 210, .30], 1, .32, 0, [3, 7, 14, 0]);
const DAWN = PAL([36, 52, 88], [92, 98, 134], [190, 138, 126], [18, 26, 40], [255, 170, 120, .34], .72, 0, .42, [90, 100, 120, .14]);
const DAY = PAL([62, 98, 136], [112, 146, 176], [158, 182, 202], [40, 56, 74], [214, 228, 242, .26], .3, 0, 1, [120, 142, 164, .5]);
const DUSK = PAL([28, 38, 72], [96, 76, 108], [200, 114, 92], [14, 18, 32], [255, 132, 84, .36], .78, 0, .4, [80, 70, 90, .14]);
const EVE = PAL([9, 20, 42], [26, 42, 74], [46, 52, 86], [5, 9, 18], [124, 112, 196, .24], .95, .1, .1, [10, 12, 24, 0]);
const POLAR = PAL([2, 6, 14], [8, 26, 48], [9, 38, 60], [2, 5, 10], [60, 190, 170, .22], 1, 1, 0, [2, 5, 10, 0]);
const KEYS = [[0, NIGHT], [5, NIGHT], [7.2, DAWN], [10, DAY], [15, DAY], [17.2, DUSK], [19.4, EVE], [21.8, NIGHT], [24, NIGHT]];
const NAMES = ['top', 'mid', 'low', 'bot'];
const blank = () => ({ top: [0, 0, 0], mid: [0, 0, 0], low: [0, 0, 0], bot: [0, 0, 0], glow: [0, 0, 0, 0], gnd: [0, 0, 0, 0], lamps: 0, aur: 0, lum: 0, key: '' });
function mix(o, a, b, k) {
  for (let n = 0; n < 4; n++) { const nm = NAMES[n]; for (let j = 0; j < 3; j++) o[nm][j] = a[nm][j] + (b[nm][j] - a[nm][j]) * k; }
  for (let j = 0; j < 4; j++) { o.glow[j] = a.glow[j] + (b.glow[j] - a.glow[j]) * k; o.gnd[j] = a.gnd[j] + (b.gnd[j] - a.gnd[j]) * k; }
  o.lamps = a.lamps + (b.lamps - a.lamps) * k; o.aur = a.aur + (b.aur - a.aur) * k; o.lum = a.lum + (b.lum - a.lum) * k; return o;
}
/* огни: прожекторы ОРУ (fl) и натриевые светильники (na) гаснут днём; светодиоды ячеек (led) и мачтовые огни (mast) горят всегда */
const lampK = (l, p) => l.g === 'fl' ? p.lamps : l.g === 'na' ? Math.pow(p.lamps, 1.3) : l.g === 'led' ? .55 + .45 * p.lamps : .5 + .5 * p.lamps;

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
const FL0 = 190, FLMAX = 420;                                                // хлопьев в обычный вечер / в полярную пургу
function create(seed) {
  const R = rng(seed || 2026), S = { w: 0, h: 0, far: null, sky: null, skyKey: '', gnd: null, gndKey: '', t: 0,
    hour: 0, hT: 0, polar: 0, polarT: 0, storm: 0, wv: 24, nFlakes: FL0, pal: blank() };
  const TP = blank(), lights = [], pick = a => a[(R() * a.length) | 0];
  const strat = (n, y0, y1, cols, r0, r1, depth, grp) => { for (let i = 0; i < n; i++) lights.push({ x: (i + .15 + R() * .7) / n, y: y0 + R() * (y1 - y0), c: pick(cols), r: r0 + R() * (r1 - r0), ph: R() * TAU, f: .5 + R() * 1.5, d: depth, g: grp }); };
  strat(10, .62, .74, ['cyan', 'white', 'ice'], 2.4, 4.2, .5, 'fl');          // прожекторы ОРУ
  strat(6, .58, .78, ['amber'], 2.6, 4.6, .55, 'na');                          // натриевые светильники
  strat(6, .70, .83, ['emerald'], 1.8, 3.2, .6, 'led');                        // индикаторы ячеек
  strat(5, .28, .52, ['ice', 'cyan'], 1.4, 2.4, .25, 'mast');                  // дальние мачты
  const flakes = Array.from({ length: FLMAX }, () => ({ x: R(), y: R(), z: .15 + R() * .85, ph: R() * TAU, s: .6 + R() * 1.7 }));
  const mist = Array.from({ length: 7 }, (_, i) => ({ x: R(), y: .12 + i * .115 + R() * .06, w: .8 + R() * .7, h: .12 + R() * .1, v: .006 + R() * .01, a: .04 + R() * .05 }));
  const wind = t => 24 + 20 * Math.sin(t * .21) + 11 * Math.sin(t * .53 + 1);

  /* время суток и режим «Полярная ночь» */
  function computePal() {
    const h = S.hour; let i = 0; while (i < KEYS.length - 2 && h >= KEYS[i + 1][0]) i++;
    const a = KEYS[i], b = KEYS[i + 1]; mix(TP, a[1], b[1], smooth((h - a[0]) / (b[0] - a[0])));
    S.storm = smooth(S.polar); mix(S.pal, TP, POLAR, S.storm);
    const p = S.pal; p.key = [p.top, p.mid, p.low, p.bot].map(x => Math.round(x[0]) + ',' + Math.round(x[1]) + ',' + Math.round(x[2])).join('|');
    S.nFlakes = Math.min(FLMAX, FL0 + Math.ceil((FLMAX - FL0) * S.storm) + (S.storm > 0 ? 24 : 0));
  }
  const setTime = h => { S.hT = ((+h % 24) + 24) % 24; };
  const setPolar = b => { S.polarT = b ? 1 : 0; };
  const snap = () => { S.hour = S.hT; S.polar = S.polarT; computePal(); };
  computePal();

  function resize(wl, hl, ss) {                                        // wl,hl — логические px (с запасом), ss — масштаб острого слоя
    S.w = wl; S.h = hl; S.sky = null; S.skyKey = ''; S.gnd = null; S.gndKey = '';
    const far = mk(wl * ss, hl * ss), c = far.getContext('2d'); c.setTransform(ss, 0, 0, ss, 0, 0); drawFar(c, wl, hl, rng(7)); S.far = far;
  }
  function update(dt) {
    S.t += dt;
    let d = S.hT - S.hour; d -= 24 * Math.round(d / 24); S.hour = (((S.hour + d * Math.min(1, dt * 1.6)) % 24) + 24) % 24;         // по короткой дуге суток, ~1 с
    const dp = S.polarT - S.polar, mx = dt / 2; S.polar += Math.abs(dp) <= mx ? dp : Math.sign(dp) * mx;                          // перетекание в полярную ночь за 2 с
    computePal();
    const st = S.storm, wv = S.wv = wind(S.t) * (1 + 1.5 * st), fall = 1 + .55 * st;
    for (let i = 0; i < S.nFlakes; i++) { const f = flakes[i];
      f.y += (12 + 40 * f.z) * fall * dt / S.h; f.x += (wv * (.35 + f.z) + Math.sin(f.ph + S.t * .8) * 7 * (1 + st)) * dt / S.w;
      if (f.y > 1.02) { f.y = -.02; f.x = R(); } if (f.x > 1.02) f.x -= 1.04; else if (f.x < -.02) f.x += 1.04; }
    mist.forEach(m => { m.x += m.v * dt * (1 + wv / 40) * (1 + st); if (m.x > 1.3) m.x = -1.3; });
  }

  /* северное сияние: ~28 вертикальных «лучей» одной текстуры; высота, смещение и яркость плывут синусами — получается колышущийся занавес */
  function curtains(c, k) {
    const N = 28, W = S.w, H = S.h, t = S.t, sw = W / N * 2.1;
    for (let i = 0; i < N; i++) {
      const u = (i + .5) / N, ph = i * .62, env = .5 + .5 * Math.sin(u * 7.3 + t * .09) * Math.sin(u * 3.1 - t * .05 + 1.3);
      const a = k * (.14 + .62 * env * env) * (.75 + .25 * Math.sin(t * .6 + ph * 2.1)); if (a < .012) continue;
      const y0 = H * (.07 + .07 * u) + Math.sin(t * .13 + ph) * H * .035 + Math.sin(u * 11 + t * .22) * H * .02, hh = H * (.32 + .1 * Math.sin(t * .07 + u * 5.3));
      c.globalAlpha = Math.min(1, a * .85); c.drawImage(AUR, 0, 0, 64, 256, u * W - sw / 2 + Math.sin(t * .1 + ph) * 8, y0, sw, hh);
    }
    c.globalAlpha = 1;
  }
  function sky(c) {
    const p = S.pal, t = S.t, W = S.w, H = S.h, key = p.key + '|' + H;
    if (S.skyKey !== key) { const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, rgba(p.top, 1)); gr.addColorStop(.55, rgba(p.mid, 1)); gr.addColorStop(.74, rgba(p.low, 1)); gr.addColorStop(1, rgba(p.bot, 1)); S.sky = gr; S.skyKey = key; }
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.fillStyle = S.sky; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'lighter';
    const gl = (1 - p.lum) * (.5 + .5 * p.aur);
    if (gl > .02) {                                                                   // слабые зелёно-голубые отсветы сияния (ночью всегда чуть заметны)
      c.globalAlpha = gl;
      const a = c.createRadialGradient(W * (.3 + .05 * Math.sin(t * .05)), H * .12, 0, W * .3, H * .12, W * .5); a.addColorStop(0, 'rgba(52,211,153,.07)'); a.addColorStop(1, 'rgba(52,211,153,0)'); c.fillStyle = a; c.fillRect(0, 0, W, H * .7);
      const b = c.createRadialGradient(W * (.72 + .05 * Math.cos(t * .04)), H * .18, 0, W * .72, H * .18, W * .45); b.addColorStop(0, 'rgba(56,189,248,.07)'); b.addColorStop(1, 'rgba(56,189,248,0)'); c.fillStyle = b; c.fillRect(0, 0, W, H * .7);
      c.globalAlpha = 1;
    }
    if (p.aur > .02) curtains(c, p.aur);
    c.save(); c.translate(W / 2, H * .74); c.scale(1, .22); const hz = c.createRadialGradient(0, 0, 0, 0, 0, W * .62);              // зарево на горизонте
    hz.addColorStop(0, rgba(p.glow, p.glow[3].toFixed(3))); hz.addColorStop(1, rgba(p.glow, 0)); c.fillStyle = hz; c.fillRect(-W, -W, W * 2, W * 2); c.restore();
    c.globalCompositeOperation = 'source-over';
  }
  function ground(c) {                                                                // дневная «снежная» вуаль над землёй и основаниями опор
    const q = S.pal.gnd; if (q[3] < .01) return; const H = S.h, key = Math.round(q[0]) + ',' + Math.round(q[1]) + ',' + Math.round(q[2]) + ',' + Math.round(q[3] * 60) + '|' + H;
    if (S.gndKey !== key) { const gr = c.createLinearGradient(0, H * .5, 0, H); gr.addColorStop(0, rgba(q, 0)); gr.addColorStop(.4, rgba(q, (q[3] * .3).toFixed(3))); gr.addColorStop(.5, rgba(q, q[3].toFixed(3))); gr.addColorStop(1, rgba(q, q[3].toFixed(3))); S.gnd = gr; S.gndKey = key; }
    c.fillStyle = S.gnd; c.fillRect(0, H * .5, S.w, H * .5);
  }
  function mistLayer(c, p, k) {
    const st = S.storm, gust = 1 + .35 * st * Math.sin(S.t * .4 + 1), base = k * (1 + 1.2 * st) * gust; c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < mist.length; i++) { const m = mist[i], e = i < 4 ? 1 : st; if (e < .02) continue; c.globalAlpha = Math.min(.5, m.a * base * e); c.drawImage(MIST, m.x * S.w + p.x, m.y * S.h + p.y, m.w * S.w, m.h * S.h); }
    c.globalAlpha = 1;
  }
  function snow(c, p, big, alpha) {
    const st = S.storm, sx = 1 + st * (1.1 + S.wv / 38), br = 1 + .3 * st, n = S.nFlakes; c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const f = flakes[i], ex = i < FL0 ? 1 : clamp01((st * (FLMAX - FL0) - (i - FL0)) / 24); if (ex <= 0) continue;
      const s = f.s * (.8 + f.z * 1.6) * big * (1 + .25 * st), x = f.x * S.w + p.x * f.z, y = f.y * S.h + p.y * f.z;
      c.globalAlpha = Math.min(1, alpha * br * (.25 + .75 * f.z) * ex); c.drawImage(FLAKE, x - s * sx, y - s, s * 2 * sx, s * 2);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  const flick = (l, t) => .72 + .28 * Math.sin(t * l.f + l.ph) * Math.sin(t * l.f * .37 + l.ph * 2);

  /* чёткий слой: c уже имеет масштаб ss; P = {far,mid,near} смещения параллакса в логических px */
  function renderSharp(c, P) {
    const p = S.pal, t = S.t; sky(c); c.drawImage(S.far, 0, 0, S.w, S.h); ground(c);                // far уже в размере ss — масштаб применит setTransform
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < lights.length; i++) { const l = lights[i], k = lampK(l, p); if (k < .02) continue;
      const x = l.x * S.w + P.mid.x * l.d * 1.6, y = l.y * S.h + P.mid.y * l.d * 1.6, f = flick(l, t) * k, s = l.r * 7;
      c.globalAlpha = .85 * f; c.drawImage(SPR[l.c].glow, x - s, y - s, s * 2, s * 2);
      c.globalAlpha = Math.min(1, .95 * f); c.drawImage(SPR.white.glow, x - l.r * .9, y - l.r * .9, l.r * 1.8, l.r * 1.8);
      if (l.c === 'amber' || l.c === 'white') { c.globalAlpha = .22 * f; c.drawImage(SPR[l.c].glow, x - l.r * 9, y - .5, l.r * 18, 1); } }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    mistLayer(c, P.mid, 1); snow(c, P.near, 1, .85);
  }
  /* расфокус: большие мягкие гауссовы пятна + дымка; снег — рыхлыми пятнами */
  function renderSoft(c, P) {
    const p = S.pal, t = S.t; sky(c); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < lights.length; i++) { const l = lights[i], k = lampK(l, p); if (k < .02) continue;
      const x = l.x * S.w + P.mid.x * l.d * 1.6, y = l.y * S.h + P.mid.y * l.d * 1.6, f = flick(l, t) * k;
      let s = l.r * 14; c.globalAlpha = Math.min(1, .8 * f); c.drawImage(SPR[l.c].soft, x - s, y - s, s * 2, s * 2);
      s = l.r * 9; c.globalAlpha = Math.min(1, .55 * f); c.drawImage(SPR[l.c].glow, x - s, y - s, s * 2, s * 2); }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.fillStyle = rgba(p.bot, (.55 * (1 - .5 * p.lum)).toFixed(3)); c.fillRect(0, S.h * .76, S.w, S.h * .24);                 // земля в расфокусе
    mistLayer(c, P.mid, 1.8); snow(c, P.near, 3.2, .16);
  }

  /* ---------- виньетка изморози по краям стекла (один раз на размер): тонкая молочная глазурь + ледяная крошка. Перистых кристаллов нет ---------- */
  function makeFrost(cv, wl, hl, scale, sd) {
    const Rf = rng(sd || 99), c = cv.getContext('2d'); cv.width = Math.ceil(wl * scale); cv.height = Math.ceil(hl * scale);
    c.setTransform(scale, 0, 0, scale, 0, 0); c.clearRect(0, 0, wl, hl);
    const m = Math.min(wl, hl), dep = { top: m * .045, side: m * .05, bot: m * .062 };         // снизу стекло чуть холоднее
    const glaze = (x0, y0, x1, y1, rx, ry, rw, rh, a) => { const gr = c.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, 'rgba(226,243,255,' + a + ')'); gr.addColorStop(.35, 'rgba(210,233,251,' + a * .42 + ')'); gr.addColorStop(1, 'rgba(204,228,247,0)'); c.fillStyle = gr; c.fillRect(rx, ry, rw, rh); };
    glaze(0, 0, 0, dep.top * 1.6, 0, 0, wl, dep.top * 1.6, .46); glaze(0, hl, 0, hl - dep.bot * 1.6, 0, hl - dep.bot * 1.6, wl, dep.bot * 1.6, .52);
    glaze(0, 0, dep.side * 1.6, 0, 0, 0, dep.side * 1.6, hl, .44); glaze(wl, 0, wl - dep.side * 1.6, 0, wl - dep.side * 1.6, 0, dep.side * 1.6, hl, .44);
    [[0, 0], [wl, 0], [0, hl], [wl, hl]].forEach(p => { const r = m * .17, gr = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], r); gr.addColorStop(0, 'rgba(230,245,255,.42)'); gr.addColorStop(1, 'rgba(230,245,255,0)'); c.fillStyle = gr; c.fillRect(p[0] - r, p[1] - r, r * 2, r * 2); });
    c.globalCompositeOperation = 'destination-out';                                           // неровная граница: вымываем мягкие «дырки»
    for (let i = 0; i < 900; i++) { const x = Rf() * wl, y = Rf() * hl, e = Math.min(x / dep.side, (wl - x) / dep.side, y / dep.top, (hl - y) / dep.bot); if (e > 1.6 || Rf() > .24 + e * .5) continue;
      const r = 3 + Rf() * 13, gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(0,0,0,' + (.15 + Rf() * .4) + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2); }
    c.globalCompositeOperation = 'source-over';
    const sp = [];
    for (let i = 0; i < 560; i++) { const x = Rf() * wl, y = Rf() * hl, e = Math.min(x / dep.side, (wl - x) / dep.side, y / dep.top, (hl - y) / dep.bot); if (e > 1.25 || Rf() > .92 - e * .7) continue;
      const r = .35 + Rf() * 1.0; c.fillStyle = 'rgba(245,251,255,' + (.3 + Rf() * .55) + ')'; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); if (Rf() < .12 && sp.length < 70) sp.push({ x, y, ph: Rf() * TAU, sp: .6 + Rf() * 1.8, s: 2 + Rf() * 3.5 }); }
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
  return { resize, update, renderSharp, renderSoft, makeFrost, makeFogTex, setTime, setPolar, snap, flakeCount: () => S.nFlakes, lights, state: S };
}
g.FrostScene = { create, rng, mk, KEYS, POLAR };
})(window);
