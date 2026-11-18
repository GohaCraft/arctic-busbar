/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/app/obsidian-graph.js  (граф топологии подстанции в стиле Obsidian Graph View)
   Canvas 2D, чёткий на Retina (DPR ≤ 2), до 60 FPS. Силовая симуляция: отталкивание узлов, пружины связей, притяжение к центру, коллизии, остывание alpha.
   Перетаскивание узла мышью / пальцем (соседи реагируют пружинами), зум колесом и щипком, панорама, подсветка узла и прямых связей при наведении
   (остальные плавно гаснут), светящиеся импульсы по активным линиям (при АВР поток переключается на Ввод 2, при блэкауте идёт от LTO / ДГУ),
   фильтры (поиск, сенсоры, резервные линии, подписи формул), силы (отталкивание, длина связей, скорость потока), миникарта, «вписать», «закрепить все».
   Данные потоков — PINN.flows(), состояния узлов — PINN.state(). Отрисовка идёт только пока вид «Граф» открыт.
   API: window.ObsidianGraph = { init, start, stop, resize, fit, focus, select, nodes, edges, stats, onSelect, onBackground }. */
(function (g) {
'use strict';
const $ = id => document.getElementById(id), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let cv, ctx, mm, mctx, wrap, tip, W = 0, H = 0, dpr = 1, raf = 0, running = false, inited = false, last = 0, frames = 0, fpsAvg = 60, lastDraw = 0;
const cam = { x: 0, y: 0, k: 1 }, camT = { x: 0, y: 0, k: 1, on: false };
let nodes = [], edges = [], byId = {}, alpha = 1, alphaTarget = 0, hover = null, selected = null, drag = null, pinned = false, query = '';
const ptrs = new Map(); let pinch = null, panning = null;
const opt = { rep: 60, len: 150, flow: 50, showS: true, showR: true, showF: true };
let cbSelect = null, cbBg = null, pulses = 0;
const SEED = { in1: [-330, -120], joint: [-150, -120], bus1: [50, -70], in2: [-330, 140], bus2: [-100, 150], ats: [70, 70], s_ir: [-200, -270], s_cur: [60, -240], s_vib: [-50, -250], core: [270, -110], lto: [420, 30], dgu: [340, 190] };
const TT = (k, p) => (g.I18N ? g.I18N.t(k, p) : k);

/* ---------- данные ---------- */
function build() {
  const T = g.PINN.TOPO;
  nodes = T.nodes.map(n => { const s = SEED[n.id] || [0, 0]; return Object.assign({}, n, { x: s[0], y: s[1], vx: 0, vy: 0, fx: null, fy: null, hl: 1, vis: 1, lab: 0, lt: 0, lr: null, lines: [] }); });
  byId = {}; nodes.forEach(n => { byId[n.id] = n; });
  edges = T.edges.map(e => Object.assign({}, e, { A: byId[e.a], B: byId[e.b], hl: 1, vis: 1, ph: Math.random(), flow: 0 }));
  wrapLabels();
}
function wrapLabels() {
  nodes.forEach(n => {
    const words = TT(n.k).split(' '), lines = []; let cur = '';
    words.forEach(w => { if ((cur + ' ' + w).trim().length > 15 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); });
    if (cur) lines.push(cur); n.lines = lines.length > 2 ? [lines[0], lines.slice(1).join(' ')] : lines;
  });
}
const linkLen = e => ({ power: 125, sensor: 95, tele: 175, cmd: 150, backup: 135 }[e.t] || 120) * (opt.len / 120);
const isVis = o => (o.sensor && o.kind === 'sensor' ? opt.showS : true) && (o.res && o.kind !== 'sensor' ? opt.showR : true);
const edgeVis = e => (e.t === 'sensor' || e.t === 'tele' ? opt.showS : true) && (e.res ? opt.showR : true) && e.A.vis > 0.02 && e.B.vis > 0.02;

/* ---------- физика ---------- */
function physics(step) {
  if (pinned && !drag) return;
  if (alpha < 0.0015 && !drag && alphaTarget === 0) return;
  const rep = 3500 + opt.rep * 150, N = nodes.length;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const a = nodes[i], b = nodes[j]; let dx = b.x - a.x, dy = b.y - a.y; const d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
    const f = rep * alpha / (d2 + 600) * step; dx /= d; dy /= d;
    a.vx -= f * dx; a.vy -= f * dy; b.vx += f * dx; b.vy += f * dy;
    const md = a.r + b.r + 24; if (d < md) { const p = (md - d) * 0.18 * step; a.vx -= p * dx; a.vy -= p * dy; b.vx += p * dx; b.vy += p * dy; }
  }
  edges.forEach(e => {
    const a = e.A, b = e.B; let dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1, k = (e.t === 'power' ? 0.09 : e.t === 'sensor' ? 0.1 : 0.04) * alpha * step, f = (d - linkLen(e)) * k;
    dx /= d; dy /= d; a.vx += f * dx; a.vy += f * dy; b.vx -= f * dx; b.vy -= f * dy;
  });
  nodes.forEach(n => {
    n.vx -= n.x * 0.018 * (portrait ? 1.9 : 1) * alpha * step; n.vy -= n.y * 0.018 * (portrait ? 0.35 : 1) * alpha * step;
    if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; return; }
    n.vx *= Math.pow(0.78, step); n.vy *= Math.pow(0.78, step); n.x += n.vx * step; n.y += n.vy * step;
  });
  alpha += (alphaTarget - alpha) * 0.0228 * step; if (alpha < 0) alpha = 0;
}
function reheat(v) { alpha = Math.max(alpha, v || 0.6); }

/* ---------- камера ---------- */
const sx = x => (x - cam.x) * cam.k + W / 2, sy = y => (y - cam.y) * cam.k + H / 2;
const wx = x => (x - W / 2) / cam.k + cam.x, wy = y => (y - H / 2) / cam.k + cam.y;
function bounds(onlyVisible) {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  nodes.forEach(n => { if (onlyVisible && !isVis(n)) return; a = Math.min(a, n.x - n.r); b = Math.min(b, n.y - n.r); c = Math.max(c, n.x + n.r); d = Math.max(d, n.y + n.r); });
  return { x0: a, y0: b, x1: c, y1: d };
}
function fit(instant) {
  const bb = bounds(true), bw = Math.max(1, bb.x1 - bb.x0), bh = Math.max(1, bb.y1 - bb.y0);
  const padX = W > 820 ? 110 : 64, padT = 60, padB = 88;                                  // запас в px под подписи узлов, панель фильтров сверху и миникарту снизу
  const k = clamp(Math.min((W - 2 * padX) / bw, (H - padT - padB) / bh), 0.3, 1.8);
  camT.x = (bb.x0 + bb.x1) / 2; camT.y = (bb.y0 + bb.y1) / 2 - (padT - padB) / (2 * k); camT.k = k; camT.on = true;
  if (instant) { cam.x = camT.x; cam.y = camT.y; cam.k = camT.k; camT.on = false; }
}
function focus(id) { const n = byId[id]; if (!n) return; camT.x = n.x; camT.y = n.y; camT.k = Math.max(cam.k, 1); camT.on = true; }
function zoomAt(px, py, f) {
  const k0 = cam.k, k1 = clamp(k0 * f, 0.3, 3), x = wx(px), y = wy(py); cam.k = k1; cam.x = x - (px - W / 2) / k1; cam.y = y - (py - H / 2) / k1; camT.on = false;
}

/* ---------- состояние узлов ---------- */
function nodeState(n, S) {
  const live = S.U > 5, p1 = live && S.in1 === 'closed', via2 = live && S.in1 === 'open' && S.ats === 'closed';
  switch (n.id) {
    case 'in1': return { on: p1, st: S.in1 === 'closed' ? (live ? 'ok' : 'off') : 'open', sub: live ? (S.in1 === 'closed' ? S.mU.toFixed(1) + ' kV' : TT('sd.open')) : TT('sd.off') };
    case 'in2': return { on: live, st: 'ok', sub: live ? (via2 ? TT('sd.load') : TT('sd.standby')) : TT('sd.off') };
    case 'ats': return { on: S.ats === 'closed', st: S.cmdUntil > Date.now() ? 'warn' : 'ok', sub: S.ats === 'closed' ? TT('sd.closed') : TT('sd.open') };
    case 'bus1': return { on: p1 || via2 || S.dgu === 'active', st: !live && S.dgu !== 'active' ? 'off' : 'ok', sub: p1 || via2 ? S.mI.toFixed(0) + ' A' : TT('sd.off') };
    case 'bus2': return { on: live, st: live ? 'ok' : 'off', sub: live ? '' : TT('sd.off') };
    case 'joint': return { on: p1, st: S.alarm.active && S.alarm.kind !== 'blackout' && S.alarm.kind !== 'false' ? 'err' : (S.Rk > 40 ? 'warn' : 'ok'), sub: S.T.toFixed(1) + ' °C · ' + S.Rk.toFixed(1) + ' µΩ' };
    case 's_ir': return { on: true, st: S.status['MLX90614-IR-01'], sub: S.T.toFixed(1) + ' °C' };
    case 's_cur': return { on: S.link.ina, st: S.status['INA219-CUR-01'], sub: S.link.ina ? S.mI.toFixed(0) + ' A' : TT('sd.lost') };
    case 's_vib': return { on: true, st: S.status['MPU6050-VIB-01'], sub: S.acc.toFixed(2) + ' g' };
    case 'core': return { on: true, st: S.guard.active ? 'warn' : 'ok', sub: S.guard.active ? 'SPOOF FILTERED' : 'Kirchhoff OK' };
    case 'lto': return { on: true, st: S.status['LTO-BAT-BUF'], sub: Math.round(S.soc) + ' % · ' + S.vdc.toFixed(1) + ' V' };
    case 'dgu': return { on: S.dgu !== 'standby', st: S.dgu === 'standby' ? 'ok' : 'warn', sub: TT('sd.' + S.dgu) };
  }
  return { on: true, st: 'ok', sub: '' };
}

/* ---------- подписи узлов: приоритет и защита от наложений (как в Obsidian: в тесноте скрываются менее важные подписи) ---------- */
const LPRIO = { joint: 0, core: 1, source: 2, bus: 3, breaker: 4, backup: 5, sensor: 6 };
function layoutLabels(P, S, k, focusSet, focusing, dt) {
  const ease = 1 - Math.pow(0.0008, dt), taken = [];
  nodes.forEach(n => { n.lt = 0; if (n.vis > 0.3) { const r = Math.max(5, n.r * k) + 5, x = sx(n.x), y = sy(n.y); taken.push([x - r, y - r, x + r, y + r, n]); } });
  const fs = n => (focusing && focusSet.has(n.id) ? 1 : 0);
  const list = k > 0.42 ? nodes.filter(n => n.vis > 0.3).sort((a, b) => ((b === hover) - (a === hover)) || ((b === selected) - (a === selected)) || (fs(b) - fs(a)) || ((LPRIO[a.kind] == null ? 9 : LPRIO[a.kind]) - (LPRIO[b.kind] == null ? 9 : LPRIO[b.kind]))) : [];
  ctx.save();
  list.forEach(n => {
    const x = sx(n.x), y = sy(n.y), r = Math.max(5, n.r * k), st = nodeState(n, S), sub = !!st.sub && (k > 0.7 || n === hover); let w = 0;
    ctx.font = '500 11.5px ' + P.sans; n.lines.forEach(l => { w = Math.max(w, ctx.measureText(l).width); });
    if (sub) { ctx.font = '500 10.5px ' + P.mono; w = Math.max(w, ctx.measureText(st.sub).width); }
    const rc = [x - w / 2 - 4, y + r + 5, x + w / 2 + 4, y + r + 8 + n.lines.length * 14 + (sub ? 14 : 0)];
    const clash = taken.some(t => t[4] !== n && rc[0] < t[2] && rc[2] > t[0] && rc[1] < t[3] && rc[3] > t[1]);
    n.lr = rc; n.lt = n === hover || n === selected || !clash ? 1 : 0;
    if (n.lt) taken.push([rc[0], rc[1], rc[2], rc[3], n]);
  });
  ctx.restore();
  nodes.forEach(n => { n.lab += (n.lt - n.lab) * ease; });
  return taken;
}
function drawLabel(n, x, y, r, st, P, k, alpha, back) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  if (back && n.lr) { const rc = n.lr; ctx.fillStyle = g.Store.rgba(P.card, 0.92); ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(rc[0], rc[1] - 1, rc[2] - rc[0], rc[3] - rc[1] + 2, 6); else ctx.rect(rc[0], rc[1] - 1, rc[2] - rc[0], rc[3] - rc[1] + 2); ctx.fill(); }
  ctx.font = '500 11.5px ' + P.sans; ctx.fillStyle = P.fg;
  n.lines.forEach((ln, i) => ctx.fillText(ln, x, y + r + 7 + i * 14));
  if (st.sub && (k > 0.7 || n === hover)) { ctx.font = '500 10.5px ' + P.mono; ctx.fillStyle = st.st === 'err' ? P.err : st.st === 'warn' ? P.warn : P.mute; ctx.fillText(st.sub, x, y + r + 8 + n.lines.length * 14); }
  ctx.restore();
}

/* ---------- отрисовка ---------- */
function draw(now, dt) {
  const P = g.Store.palette(), S = g.PINN.state(), F = g.PINN.flows(), pn = now / 1000;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  /* точечная сетка */
  let sp = 28 * cam.k; while (sp < 13) sp *= 2;
  const ox = ((sx(0) % sp) + sp) % sp, oy = ((sy(0) % sp) + sp) % sp;
  ctx.fillStyle = P.dot; const dr = clamp(cam.k * 0.9, 0.7, 1.3);
  for (let x = ox; x < W; x += sp) for (let y = oy; y < H; y += sp) { ctx.beginPath(); ctx.arc(x, y, dr, 0, 6.2832); ctx.fill(); }

  /* фокус: наведение, иначе поиск */
  const focusSet = new Set(); let focusing = false;
  const q = query.trim().toLowerCase();
  if (hover) { focusing = true; focusSet.add(hover.id); edges.forEach(e => { if (e.A === hover) focusSet.add(e.B.id); if (e.B === hover) focusSet.add(e.A.id); }); }
  else if (q) { focusing = true; nodes.forEach(n => { if (TT(n.k).toLowerCase().indexOf(q) >= 0 || (n.sensor || '').toLowerCase().indexOf(q) >= 0 || n.id.indexOf(q) >= 0) focusSet.add(n.id); }); }
  const k = cam.k, ease = 1 - Math.pow(0.0008, dt);
  nodes.forEach(n => { const tv = isVis(n) ? 1 : 0, th = !focusing || focusSet.has(n.id) ? 1 : 0.16; n.vis += (tv - n.vis) * ease; n.hl += (th - n.hl) * ease; });
  pulses = 0;

  /* связи */
  const flowSpeed = 14 + opt.flow * 1.6, placed = layoutLabels(P, S, k, focusSet, focusing, dt).map(r => r.slice(0, 4));   // placed — занятые прямоугольники: узлы, показанные подписи и уже нарисованные формулы (без наложений)
  edges.forEach(e => {
    const th = !focusing || (hover ? (e.A === hover || e.B === hover) : (focusSet.has(e.A.id) && focusSet.has(e.B.id))) ? 1 : 0.1;
    e.hl += (th - e.hl) * ease; e.flow += ((F[e.id] || 0) - e.flow) * (1 - Math.pow(0.003, dt));
    if (!edgeVis(e)) return;
    const x1 = sx(e.A.x), y1 = sy(e.A.y), x2 = sx(e.B.x), y2 = sy(e.B.y), len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const warmC = e.res || e.t === 'backup' ? P.warn : P.acc, vis = Math.min(e.A.vis, e.B.vis), f = e.flow;
    const base = e.t === 'sensor' || e.t === 'tele' ? 0.2 : 0.2 + 0.1 * (e.res ? 0 : 1);
    ctx.save(); ctx.globalAlpha = vis * (0.35 + 0.65 * e.hl);
    ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x1 + ux * e.A.r * k * 0.9, y1 + uy * e.A.r * k * 0.9); ctx.lineTo(x2 - ux * e.B.r * k * 0.9, y2 - uy * e.B.r * k * 0.9);
    if (e.t === 'power') { ctx.strokeStyle = f > 0.5 ? g.Store.rgba(warmC, 0.55) : g.Store.rgba(P.subtle, 0.4); ctx.lineWidth = 1.2 + 1.6 * f; if (e.res && f < 0.5) ctx.setLineDash([6, 5]); }
    else if (e.t === 'backup') { ctx.strokeStyle = f > 0.3 ? g.Store.rgba(P.warn, 0.55) : g.Store.rgba(P.subtle, 0.38); ctx.lineWidth = 1.1 + f; ctx.setLineDash(f > 0.3 ? [] : [6, 5]); }
    else if (e.t === 'cmd') { ctx.strokeStyle = f > 0.5 ? g.Store.rgba(P.acc, 0.7) : g.Store.rgba(P.subtle, 0.4); ctx.lineWidth = 1.2; ctx.setLineDash([3, 4]); }
    else if (e.t === 'tele') { ctx.strokeStyle = g.Store.rgba(P.subtle, 0.45); ctx.lineWidth = 1; ctx.setLineDash([1.5, 4]); }
    else { ctx.strokeStyle = g.Store.rgba(P.subtle, 0.55); ctx.lineWidth = 1; }
    ctx.stroke(); ctx.setLineDash([]);
    /* импульсы энергии / данных вдоль линии */
    if (f > 0.03 && opt.flow > 0) {
      e.ph += dt * flowSpeed * (0.35 + f) / len; const n = Math.max(1, Math.floor(len / 95)), c = e.t === 'power' || e.t === 'cmd' ? warmC : (e.t === 'backup' ? P.warn : P.subtle);
      for (let i = 0; i < n; i++) {
        const u = ((e.ph + i / n) % 1 + 1) % 1; pulses++;
        for (let tr = 0; tr < 4; tr++) { const uu = u - tr * 0.014; if (uu < 0.03 || uu > 0.97) continue; const px = x1 + (x2 - x1) * uu, py = y1 + (y2 - y1) * uu; ctx.fillStyle = g.Store.rgba(c, (tr === 0 ? 0.95 : 0.32 / tr) * Math.min(1, f + 0.25)); ctx.beginPath(); ctx.arc(px, py, tr === 0 ? 2.5 : 2 - tr * 0.3, 0, 6.2832); ctx.fill(); }
        const px = x1 + (x2 - x1) * u, py = y1 + (y2 - y1) * u; ctx.fillStyle = g.Store.rgba(c, 0.16 * Math.min(1, f + 0.3)); ctx.beginPath(); ctx.arc(px, py, 7, 0, 6.2832); ctx.fill();
      }
    }
    ctx.restore();
    /* подпись формулы */
    if (opt.showF && e.fx && k > 0.62 && len > 110 && (focusing ? e.hl > 0.9 : (e.t === 'power' || e.t === 'cmd'))) {
      ctx.save(); ctx.font = '500 10.5px ' + P.mono; const tw = ctx.measureText(e.fx).width, mx = (x1 + x2) / 2, my = (y1 + y2) / 2, bx = mx - tw / 2 - 6, by = my - 9, bw = tw + 12;
      if (!placed.some(r => bx < r[2] && bx + bw > r[0] && by < r[3] && by + 18 > r[1])) {
        placed.push([bx, by, bx + bw, by + 18]); ctx.globalAlpha = vis * (0.25 + 0.75 * e.hl) * Math.min(1, (k - 0.62) * 4);
        ctx.fillStyle = g.Store.rgba(P.card, 0.88); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, 18, 6) : ctx.rect(bx, by, bw, 18); ctx.fill();
        ctx.fillStyle = P.mute; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(e.fx, mx, my + 0.5);
      }
      ctx.restore();
    }
  });

  /* узлы */
  const order = nodes.slice().sort((a, b) => a.r - b.r); let late = null;
  order.forEach(n => {
    if (n.vis < 0.02) return;
    const st = nodeState(n, S), x = sx(n.x), y = sy(n.y), r = Math.max(5, n.r * k), pal = { ok: P.acc, warn: P.warn, err: P.err, off: P.subtle, open: P.warn };
    const col = n.kind === 'sensor' ? (st.st === 'ok' ? P.subtle : pal[st.st] || P.subtle) : n.kind === 'joint' ? (st.st === 'ok' ? P.fg : pal[st.st]) : n.kind === 'breaker' || n.kind === 'backup' ? P.warn : n.kind === 'bus' ? P.mute : P.acc;
    const ring = st.st === 'err' ? P.err : (st.st === 'warn' && n.kind !== 'backup' && n.kind !== 'breaker' ? P.warn : col), a = n.vis * (0.3 + 0.7 * n.hl) * (st.on || n.kind === 'sensor' || n.kind === 'core' ? 1 : 0.62);
    ctx.save(); ctx.globalAlpha = a;
    if ((st.st === 'err') || (n.id === 'joint' && S.alarm.active && S.alarm.kind === 'heat') || (n.id === 'bus1' && S.alarm.active && S.alarm.kind === 'blackout')) {   // аварийное свечение
      const pr = r + 8 + Math.sin(pn * 5) * 4; ctx.fillStyle = g.Store.rgba(P.err, 0.14); ctx.beginPath(); ctx.arc(x, y, pr, 0, 6.2832); ctx.fill();
    }
    if (n === selected) { ctx.strokeStyle = g.Store.rgba(P.acc, 0.9); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 6, 0, 6.2832); ctx.stroke(); }
    if (n === hover) { ctx.fillStyle = g.Store.rgba(P.acc, 0.1); ctx.beginPath(); ctx.arc(x, y, r + 9, 0, 6.2832); ctx.fill(); }
    ctx.fillStyle = n.kind === 'sensor' ? g.Store.rgba(P.acc, 0.12) : g.Store.rgba(P.card, 0.96); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    if (st.on && n.kind !== 'sensor') { ctx.fillStyle = g.Store.rgba(ring, 0.1); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); }
    ctx.strokeStyle = g.Store.rgba(ring, n.kind === 'sensor' ? 0.8 : 0.95); ctx.lineWidth = n.crit ? 2.2 : 1.5; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke();
    glyph(n, x, y, r, ring, P, S, st); ctx.restore();
    /* подписи: подсвеченная (hover) рисуется последней и на подложке — читается поверх соседних */
    const la = n.vis * Math.min(1, (k - 0.42) * 3) * (0.4 + 0.6 * n.hl) * n.lab;
    if (n === hover) late = { n, x, y, r, st }; else if (la > 0.02) drawLabel(n, x, y, r, st, P, k, la, false);
  });
  if (late) drawLabel(late.n, late.x, late.y, late.r, late.st, P, k, late.n.vis, true);
  drawMini(P);
}
function glyph(n, x, y, r, c, P, S, st) {                                                                      // простая «иконография» узлов без внешних картинок
  ctx.strokeStyle = g.Store.rgba(c, 0.95); ctx.fillStyle = g.Store.rgba(c, 0.95); ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; const u = r * 0.5;
  if (n.kind === 'core') { ctx.beginPath(); ctx.arc(x, y, u * 0.55, 0, 6.2832); ctx.fill(); for (let i = 0; i < 4; i++) { const a = i * 1.5708 + 0.785; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * u * 0.9, y + Math.sin(a) * u * 0.9); ctx.lineTo(x + Math.cos(a) * u * 1.35, y + Math.sin(a) * u * 1.35); ctx.stroke(); } }
  else if (n.kind === 'source') { ctx.beginPath(); ctx.moveTo(x + u * 0.2, y - u * 1.1); ctx.lineTo(x - u * 0.65, y + u * 0.2); ctx.lineTo(x + u * 0.05, y + u * 0.2); ctx.lineTo(x - u * 0.2, y + u * 1.1); ctx.lineTo(x + u * 0.65, y - u * 0.2); ctx.lineTo(x - u * 0.05, y - u * 0.2); ctx.closePath(); ctx.stroke(); }
  else if (n.kind === 'bus') { ctx.beginPath(); ctx.moveTo(x - u, y - u * 0.35); ctx.lineTo(x + u, y - u * 0.35); ctx.moveTo(x - u, y + u * 0.35); ctx.lineTo(x + u, y + u * 0.35); ctx.stroke(); }
  else if (n.kind === 'breaker') { ctx.beginPath(); if (S.ats === 'closed') { ctx.moveTo(x - u, y); ctx.lineTo(x + u, y); } else { ctx.moveTo(x - u, y + u * 0.3); ctx.lineTo(x - u * 0.2, y + u * 0.3); ctx.moveTo(x - u * 0.2, y + u * 0.3); ctx.lineTo(x + u * 0.55, y - u * 0.75); ctx.moveTo(x + u * 0.55, y + u * 0.3); ctx.lineTo(x + u, y + u * 0.3); } ctx.stroke(); }
  else if (n.kind === 'joint') { ctx.beginPath(); ctx.arc(x - u * 0.45, y, u * 0.45, 0, 6.2832); ctx.arc(x + u * 0.45, y, u * 0.45, 0, 6.2832); ctx.stroke(); }
  else if (n.kind === 'backup') { ctx.strokeRect(x - u, y - u * 0.55, u * 1.8, u * 1.1); ctx.fillRect(x + u * 0.85, y - u * 0.2, u * 0.22, u * 0.4); }
  else if (n.kind === 'sensor') { ctx.beginPath(); ctx.arc(x, y, Math.max(1.8, r * 0.3), 0, 6.2832); ctx.fill(); }
}

/* ---------- миникарта ---------- */
function drawMini(P) {
  if (!mctx) return; const w = mm.width / dpr, h = mm.height / dpr; mctx.setTransform(dpr, 0, 0, dpr, 0, 0); mctx.clearRect(0, 0, w, h);
  const bb = bounds(false), pad = 60, bw = bb.x1 - bb.x0 + pad * 2, bh = bb.y1 - bb.y0 + pad * 2, s = Math.min(w / bw, h / bh), ox = (w - bw * s) / 2 - (bb.x0 - pad) * s, oy = (h - bh * s) / 2 - (bb.y0 - pad) * s;
  mm._m = { s, ox, oy };
  mctx.lineWidth = 1; mctx.strokeStyle = g.Store.rgba(P.subtle, 0.4);
  edges.forEach(e => { if (!edgeVis(e)) return; mctx.beginPath(); mctx.moveTo(e.A.x * s + ox, e.A.y * s + oy); mctx.lineTo(e.B.x * s + ox, e.B.y * s + oy); mctx.stroke(); });
  nodes.forEach(n => { if (n.vis < 0.05) return; mctx.fillStyle = n === selected ? P.acc : g.Store.rgba(n.kind === 'joint' ? P.fg : n.kind === 'sensor' ? P.subtle : P.mute, 0.9); mctx.beginPath(); mctx.arc(n.x * s + ox, n.y * s + oy, Math.max(1.6, n.r * s * 0.55), 0, 6.2832); mctx.fill(); });
  const vx0 = wx(0) * s + ox, vy0 = wy(0) * s + oy, vx1 = wx(W) * s + ox, vy1 = wy(H) * s + oy;
  mctx.strokeStyle = P.acc; mctx.lineWidth = 1.2; mctx.fillStyle = g.Store.rgba(P.acc, 0.08); mctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0); mctx.strokeRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
}
function miniMove(e) { const r = mm.getBoundingClientRect(), m = mm._m; if (!m) return; const px = e.clientX - r.left, py = e.clientY - r.top; camT.x = (px - m.ox) / m.s; camT.y = (py - m.oy) / m.s; camT.k = cam.k; camT.on = true; }

/* ---------- ввод ---------- */
function pick(px, py) {
  let best = null, bd = 1e9;
  nodes.forEach(n => { if (n.vis < 0.3) return; const d = Math.hypot(sx(n.x) - px, sy(n.y) - py), rr = Math.max(5, n.r * cam.k) + 7; if (d < rr && d < bd) { best = n; bd = d; } });
  return best;
}
const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
function onDown(e) {
  cv.setPointerCapture && cv.setPointerCapture(e.pointerId); const [px, py] = pos(e); ptrs.set(e.pointerId, { x: px, y: py });
  if (ptrs.size === 2) { const p = Array.from(ptrs.values()); pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), k: cam.k }; drag = null; panning = null; return; }
  const n = pick(px, py);
  if (n) { drag = { n, sx: px, sy: py, moved: false, ox: n.x - wx(px), oy: n.y - wy(py) }; n.fx = n.x; n.fy = n.y; alphaTarget = 0.35; reheat(0.4); cv.classList.add('drag'); }
  else { panning = { sx: px, sy: py, cx: cam.x, cy: cam.y, moved: false }; cv.classList.add('drag'); camT.on = false; }
  hideTip();
}
function onMove(e) {
  const [px, py] = pos(e);
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: px, y: py });
  if (pinch && ptrs.size >= 2) { const p = Array.from(ptrs.values()), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2; if (pinch.d > 0) zoomAt(mx, my, (d / pinch.d) * pinch.k / cam.k); return; }
  if (drag) { if (Math.hypot(px - drag.sx, py - drag.sy) > 4) drag.moved = true; if (drag.moved) { drag.n.fx = wx(px) + drag.ox; drag.n.fy = wy(py) + drag.oy; if (pinned) { drag.n.x = drag.n.fx; drag.n.y = drag.n.fy; } } return; }
  if (panning) { const dx = px - panning.sx, dy = py - panning.sy; if (Math.hypot(dx, dy) > 3) panning.moved = true; cam.x = panning.cx - dx / cam.k; cam.y = panning.cy - dy / cam.k; return; }
  if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
    const n = pick(px, py); if (n !== hover) { hover = n; cv.classList.toggle('node', !!n); }
    if (n) showTip(n, px, py); else hideTip();
  }
}
function onUp(e) {
  ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
  if (drag) {
    const d = drag; drag = null; alphaTarget = 0; cv.classList.remove('drag');
    if (!pinned) { d.n.fx = null; d.n.fy = null; }
    if (!d.moved) select(d.n, true);
  } else if (panning) { const p = panning; panning = null; cv.classList.remove('drag'); if (!p.moved) { select(null, true); } }
}
function onWheel(e) { e.preventDefault(); const [px, py] = pos(e); zoomAt(px, py, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0012))); }
function onLeave() { if (!drag) { hover = null; cv.classList.remove('node'); hideTip(); } }
function showTip(n, px, py) {
  if (!tip) return; const S = g.PINN.state(), st = nodeState(n, S);
  tip.textContent = TT(n.k) + (st.sub ? ' · ' + st.sub : ''); tip.style.left = Math.min(W - 40, px + 16) + 'px'; tip.style.top = Math.min(H - 40, py + 14) + 'px'; tip.classList.add('on');
}
function hideTip() { if (tip) tip.classList.remove('on'); }
function select(n, user) {
  const was = selected; selected = n && typeof n === 'object' ? n : (typeof n === 'string' ? byId[n] || null : null);
  if (user) { if (selected && cbSelect) cbSelect(selected); else if (!selected && was && cbBg) cbBg(); else if (!selected && cbBg) cbBg(); }
}
function onKey(e) {
  if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.2); else if (e.key === '-') zoomAt(W / 2, H / 2, 1 / 1.2); else if (e.key === '0') fit(false);
  else if (e.key.indexOf('Arrow') === 0) { const s = 40 / cam.k; if (e.key === 'ArrowLeft') cam.x -= s; if (e.key === 'ArrowRight') cam.x += s; if (e.key === 'ArrowUp') cam.y -= s; if (e.key === 'ArrowDown') cam.y += s; camT.on = false; e.preventDefault(); }
}

/* ---------- цикл ---------- */
/* ориентация раскладки: исходная — «широкая»; на вертикальном экране (телефон) узлы транспонируются, чтобы граф занимал всю высоту, а не узкую полосу.
   Транспонирование — изометрия (отражение по диагонали): длины связей и физика не меняются. Гистерезис 1.12 / 0.9 защищает от экранной клавиатуры. */
let portrait = false;
function autoOrient() {
  if (!W || !H || !nodes.length) return; const p = H > W * 1.12, l = H < W * 0.9;
  if ((p && !portrait) || (l && portrait)) {
    portrait = p;
    nodes.forEach(n => { const t = n.x; n.x = n.y; n.y = t; if (n.fx != null) { const u = n.fx; n.fx = n.fy; n.fy = u; } n.vx = n.vy = 0; });
    if (frames === 0) { const a0 = alpha; alpha = 0.6; for (let i = 0; i < 260; i++) physics(1); alpha = Math.max(a0, 0.04); fit(true); }   // до первого кадра: раскладка уже устоялась
    else { reheat(0.6); setTimeout(() => { if (!drag && running) fit(false); }, 1400); }
  }
}
function resize() {
  if (!wrap) return; const r = wrap.getBoundingClientRect(); if (r.width < 40 || r.height < 40) return;
  W = r.width; H = r.height; dpr = Math.min(2, g.devicePixelRatio || 1);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const mr = mm.getBoundingClientRect(); if (mr.width > 10) { mm.width = Math.round(mr.width * dpr); mm.height = Math.round(mr.height * dpr); }
  autoOrient();
}
function frame(t) {
  if (!running) return; raf = requestAnimationFrame(frame);
  const cap = g.Store.get('fps') === 30 ? 33 : 0; if (cap && t - lastDraw < cap - 2) return;
  const dt = Math.min(0.1, (t - (last || t)) / 1000); last = t; lastDraw = t; if (dt <= 0) return;
  fpsAvg += ((1 / dt) - fpsAvg) * 0.05; frames++;
  physics(dt * 60);
  if (camT.on) { const e = 1 - Math.pow(0.0006, dt); cam.x += (camT.x - cam.x) * e; cam.y += (camT.y - cam.y) * e; cam.k += (camT.k - cam.k) * e; if (Math.abs(camT.x - cam.x) + Math.abs(camT.y - cam.y) < 0.3 && Math.abs(camT.k - cam.k) < 0.002) camT.on = false; }
  draw(t, dt);
}
function start() {
  if (!inited) init(); if (running) return; resize(); running = true; last = 0; if (!cam.k || (cam.x === 0 && cam.y === 0 && frames === 0)) fit(true); raf = requestAnimationFrame(frame);
}
function stop() { running = false; cancelAnimationFrame(raf); }
function setOpt(k, v) { opt[k] = v; if (k === 'rep' || k === 'len') reheat(0.7); if (k === 'showS' || k === 'showR') { camT.on = false; } }
function setPinned(v) {
  pinned = !!v; nodes.forEach(n => { if (pinned) { n.fx = n.x; n.fy = n.y; } else { n.fx = null; n.fy = null; } }); if (!pinned) reheat(0.5);
  const b = $('gPin'), tx = $('gPinT'); if (b) b.setAttribute('aria-pressed', pinned ? 'true' : 'false'); if (tx) tx.textContent = TT(pinned ? 'g.unpin' : 'g.pin');
}
function init() {
  if (inited) return; cv = $('graphCanvas'); mm = $('miniMap'); wrap = $('gWrap'); tip = $('gTip'); if (!cv || !g.PINN) return; ctx = cv.getContext('2d'); mctx = mm.getContext('2d'); inited = true;
  build();
  for (let i = 0; i < 220; i++) physics(1);                                                                     // предварительное «остывание» раскладки
  alpha = 0.04;
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('pointerleave', onLeave); cv.addEventListener('wheel', onWheel, { passive: false }); cv.addEventListener('keydown', onKey);
  mm.addEventListener('pointerdown', e => { mm.setPointerCapture && mm.setPointerCapture(e.pointerId); mm._d = true; miniMove(e); });
  mm.addEventListener('pointermove', e => { if (mm._d) miniMove(e); }); mm.addEventListener('pointerup', () => { mm._d = false; }); mm.addEventListener('pointercancel', () => { mm._d = false; });
  if (g.ResizeObserver) new ResizeObserver(() => { resize(); }).observe(wrap);
  /* панель фильтров */
  const bind = (id, key, num) => { const el = $(id); if (!el) return; const f = () => { const v = el.type === 'checkbox' ? el.checked : +el.value; setOpt(key, v); const o = $(id + 'V'); if (o) o.textContent = el.value; }; el.addEventListener('input', f); f(); };
  bind('gRep', 'rep'); bind('gLen', 'len'); bind('gFlow', 'flow'); bind('gShowS', 'showS'); bind('gShowR', 'showR'); bind('gShowF', 'showF');
  const gs = $('gSearch'); if (gs) { gs.addEventListener('input', () => { query = gs.value; }); gs.addEventListener('keydown', e => { if (e.key === 'Enter') { const q = gs.value.trim().toLowerCase(); const m = q && nodes.find(n => TT(n.k).toLowerCase().indexOf(q) >= 0 || n.id.indexOf(q) >= 0 || (n.sensor || '').toLowerCase().indexOf(q) >= 0); if (m) { focus(m.id); select(m, true); } } }); }
  const fb = $('gFit'); if (fb) fb.addEventListener('click', () => fit(false));
  const pb = $('gPin'); if (pb) pb.addEventListener('click', () => setPinned(!pinned));
  const th = $('gpToggle'), pn = $('gPanel'); if (th && pn) th.addEventListener('click', () => { const c = pn.dataset.c === '1' ? '0' : '1'; pn.dataset.c = c; th.setAttribute('aria-expanded', c === '1' ? 'false' : 'true'); });
  if (g.matchMedia && g.matchMedia('(max-width:820px)').matches && pn) { pn.dataset.c = '1'; th.setAttribute('aria-expanded', 'false'); }
  g.addEventListener('abai:lang', () => { wrapLabels(); setPinned(pinned); });
}
g.ObsidianGraph = { init, start, stop, resize, fit, focus, select: id => { select(id, false); }, setPinned, nodes: () => nodes, edges: () => edges, byId: id => byId[id],
  onSelect: f => { cbSelect = f; }, onBackground: f => { cbBg = f; }, hover: () => hover, selected: () => selected, camera: () => cam, isRunning: () => running,
  stats: () => ({ fps: Math.round(fpsAvg), frames, nodes: nodes.length, edges: edges.length, pulses, k: +cam.k.toFixed(3), alpha: +alpha.toFixed(4), W, H, dpr, pinned }) };
})(window);
