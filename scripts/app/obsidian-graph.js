/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/app/obsidian-graph.js  (ЭТАП 3: граф топологии в стиле Obsidian Graph View)
   Canvas 2D, чёткий на Retina (DPR ≤ 2), до 60 FPS. Силовая симуляция в духе d3-force: отталкивание узлов (many-body), пружины связей (link),
   притяжение к центру (center), коллизии (collide), остывание alpha и затухание скорости.
   Узлы — минималистичные ЗАЛИТЫЕ ТОЧКИ разного размера (joint крупнее, датчики мельче; радиус растёт со степенью узла) со мягким свечением: цвет = состояние.
   Перетаскивание узла мышью / пальцем (соседи реагируют пружинами; брошенный узел остаётся там, куда его положили — «закреплён»; двойной клик/тап — освободить),
   зум колесом и щипком, панорама, подсветка узла и прямых связей при наведении (остальные плавно гаснут), светящиеся импульсы по активным линиям
   (при АВР поток переключается на Ввод 2, при блэкауте идёт от LTO / ДГУ), фильтры (поиск, сенсоры, резервные линии, подписи формул), силы, миникарта.

   LOD (уровень детализации): при отдалении сначала плавно гаснут значения («42 °C»), затем формулы на линиях, затем названия узлов;
   остаются светящиеся точки, связи и бегущие импульсы (при этом чуть крупнее — чтобы поток читался издалека). Наведённый узел всегда подписан.

   РАСКЛАДКА ПО ПОЛЬЗОВАТЕЛЮ: позиции и закрепления узлов хранятся в Store.layout под user.id (localStorage, не привилегированные данные).
   Зашёл админ — его расстановка, зашёл диспетчер — его собственная; смена пользователя и выход очищают граф до исходной раскладки.
   Сохранение — когда симуляция остыла после перетаскивания, при выходе из вида / сессии и при закрытии вкладки. Координаты хранятся в «широкой»
   ориентации (на телефоне граф транспонирован — изометрия), поэтому раскладка переносится между ПК и телефоном. «Сбросить раскладку» очищает запись.

   Данные потоков — PINN.flows(), состояния узлов — PINN.state(). Отрисовка идёт только пока вид «Граф» открыт.
   API: window.ObsidianGraph = { init, start, stop, resize, fit, focus, select, setPinned, nodes, edges, byId, onSelect, onBackground, hover, selected, camera, isRunning,
                                 stats, lod, layout, saveLayout, loadLayout, resetLayout, togglePin, pins } */
(function (g) {
'use strict';
const $ = id => document.getElementById(id), clamp = (v, a, b) => Math.max(a, Math.min(b, v)), sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }, TAU = 6.2832;
let cv, ctx, mm, mctx, wrap, tip, W = 0, H = 0, dpr = 1, raf = 0, running = false, inited = false, last = 0, frames = 0, fpsAvg = 60, lastDraw = 0;
const cam = { x: 0, y: 0, k: 1 }, camT = { x: 0, y: 0, k: 1, on: false };
let nodes = [], edges = [], byId = {}, alpha = 1, alphaTarget = 0, hover = null, selected = null, drag = null, pinned = false, query = '';
const ptrs = new Map(); let pinch = null, panning = null, lastTap = { n: null, t: 0 };
const opt = { rep: 60, len: 150, flow: 50, showS: true, showR: true, showF: true };
let cbSelect = null, cbBg = null, pulses = 0;
const SEED = { in1: [-330, -120], joint: [-150, -120], bus1: [50, -70], in2: [-330, 140], bus2: [-100, 150], ats: [70, 70], s_ir: [-200, -270], s_cur: [60, -240], s_vib: [-50, -250], core: [270, -110], lto: [420, 30], dgu: [340, 190] };
const DOT = { joint: 8.5, core: 7.5, source: 6.5, backup: 5.6, bus: 5.6, breaker: 5, sensor: 3.8 };      // радиусы точек в мировых px (на экране × k^0.85, не меньше 2.2)
const LOD = { lab: 0, fx: 0, sub: 0 };                                                                  // 0..1: названия узлов / формулы на линиях / значения под названиями
const lay = { uid: null, ready: false, dirty: false, saved: false, timer: 0, at: 0 };                    // раскладка текущего пользователя
const TT = (k, p) => (g.I18N ? g.I18N.t(k, p) : k);

/* ---------- данные ---------- */
function build() {
  const T = g.PINN.TOPO;
  nodes = T.nodes.map(n => { const s = SEED[n.id] || [0, 0]; return Object.assign({}, n, { x: s[0], y: s[1], vx: 0, vy: 0, fx: null, fy: null, pin: false, hl: 1, vis: 1, lab: 0, lt: 0, lr: null, lines: [], deg: 0, r: DOT[n.kind] || 5 }); });
  byId = {}; nodes.forEach(n => { byId[n.id] = n; });
  edges = T.edges.map(e => Object.assign({}, e, { A: byId[e.a], B: byId[e.b], hl: 1, vis: 1, ph: Math.random(), flow: 0 }));
  edges.forEach(e => { e.A.deg++; e.B.deg++; });
  nodes.forEach(n => { n.r = (DOT[n.kind] || 5) * (1 + 0.05 * n.deg); });                                // чем больше связей, тем крупнее точка
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
const dotR = n => Math.max(2.2, n.r * Math.pow(cam.k, 0.85));

/* ---------- физика (d3-force): many-body + link + center + collide ---------- */
function physics(step) {
  if (pinned && !drag) return;
  if (alpha < 0.0015 && !drag && alphaTarget === 0) return;
  const rep = 3500 + opt.rep * 150, N = nodes.length;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const a = nodes[i], b = nodes[j]; let dx = b.x - a.x, dy = b.y - a.y; const d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
    const f = rep * alpha / (d2 + 600) * step; dx /= d; dy /= d;
    a.vx -= f * dx; a.vy -= f * dy; b.vx += f * dx; b.vy += f * dy;
    const md = a.r + b.r + 22; if (d < md) { const p = (md - d) * 0.18 * step; a.vx -= p * dx; a.vy -= p * dy; b.vx += p * dx; b.vy += p * dy; }
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
  const wide = W > 820, padX = wide ? 110 : 64, padT = wide ? 60 : 68, padB = wide ? 88 : 128;     // запас в px под подписи узлов, панель фильтров сверху и миникарту / нижний док снизу
  const k = clamp(Math.min((W - 2 * padX) / bw, (H - padT - padB) / bh), 0.3, 1.8);
  camT.x = (bb.x0 + bb.x1) / 2; camT.y = (bb.y0 + bb.y1) / 2 - (padT - padB) / (2 * k); camT.k = k; camT.on = true;
  if (instant) { cam.x = camT.x; cam.y = camT.y; cam.k = camT.k; camT.on = false; }
}
function focus(id) { const n = byId[id]; if (!n) return; camT.x = n.x; camT.y = n.y; camT.k = Math.max(cam.k, 1); camT.on = true; }
function zoomAt(px, py, f) {
  const k0 = cam.k, k1 = clamp(k0 * f, 0.18, 3), x = wx(px), y = wy(py); cam.k = k1; cam.x = x - (px - W / 2) / k1; cam.y = y - (py - H / 2) / k1; camT.on = false;
}

/* ---------- раскладка по пользователю ---------- */
const uid = () => { const S = g.Store, u = S && S.session && S.session.user; return u && u.id != null ? String(u.id) : null; };
const canon = n => portrait ? [n.y, n.x] : [n.x, n.y];                                                  // в хранилище — «широкая» ориентация
function layoutMap() { const m = {}; nodes.forEach(n => { const c = canon(n); m[n.id] = [Math.round(c[0] * 10) / 10, Math.round(c[1] * 10) / 10, n.pin ? 1 : 0]; }); return m; }
function saveLayout() {
  clearTimeout(lay.timer); lay.timer = 0; lay.dirty = false;
  if (!lay.uid || !nodes.length || !g.Store || !g.Store.layout) return false;
  const ok = g.Store.layout.set(lay.uid, layoutMap()); if (ok) lay.saved = true; return !!ok;
}
const flushSave = () => { if (lay.dirty) saveLayout(); };
function markDirty() { lay.dirty = true; lay.at = performance.now(); clearTimeout(lay.timer); lay.timer = setTimeout(() => { if (lay.dirty) saveLayout(); }, 7000); }
function toSeed() {                                                                                      // исходная раскладка: семена → короткая предварительная «варка» силами
  const fr = pinned; pinned = false;
  nodes.forEach(n => { const s = SEED[n.id] || [0, 0]; n.x = portrait ? s[1] : s[0]; n.y = portrait ? s[0] : s[1]; n.vx = n.vy = 0; n.fx = n.fy = null; n.pin = false; });
  alpha = 0.6; alphaTarget = 0; for (let i = 0; i < 260; i++) physics(1); alpha = 0.04; pinned = fr;
  if (fr) nodes.forEach(n => { n.fx = n.x; n.fy = n.y; });
}
function loadLayout() {                                                                                  // раскладка текущего user.id → узлы; false — своей раскладки ещё нет
  const u = uid(); lay.uid = u; lay.saved = false; if (!u || !nodes.length || !g.Store || !g.Store.layout) return false;
  const m = g.Store.layout.get(u); if (!m) return false; lay.saved = true;
  nodes.forEach(n => { const v = m[n.id]; if (!v) return; n.x = portrait ? v[1] : v[0]; n.y = portrait ? v[0] : v[1]; n.vx = n.vy = 0; n.pin = !!v[2]; if (n.pin || pinned) { n.fx = n.x; n.fy = n.y; } else { n.fx = n.fy = null; } });
  alpha = 0; return true;                                                                                // положения ровно такие, как были сохранены: симуляция не трогает их, пока их не потревожат
}
function applyUser() {                                                                                   // вызывается при открытии вида и после входа
  const u = uid(); if (lay.ready && u === lay.uid) return; flushSave();
  toSeed(); loadLayout(); lay.ready = true; lay.dirty = false; lay.uid = u; hover = null; selected = null; fit(true);
}
function resetLayout() {
  const u = uid() || lay.uid; if (u && g.Store && g.Store.layout) g.Store.layout.clear(u);
  clearTimeout(lay.timer); lay.dirty = false; lay.saved = false; toSeed(); fit(false); return true;
}
function togglePin(n) {
  n = typeof n === 'string' ? byId[n] : n; if (!n) return false; n.pin = !n.pin;
  if (n.pin) { n.fx = n.x; n.fy = n.y; } else if (!pinned) { n.fx = n.fy = null; reheat(0.3); }
  markDirty(); return n.pin;
}
g.addEventListener('abai:auth', e => {
  const d = e.detail || {}; if (!inited) { lay.ready = false; return; }
  if (d.type === 'logout') { flushSave(); lay.uid = null; lay.ready = false; lay.saved = false; hover = null; selected = null; query = ''; toSeed(); hideTip(); }
  else if (d.type === 'login') { lay.ready = false; if (running) applyUser(); }
});
g.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });

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
function nodeColor(n, st, P) {                                                                           // цвет точки: смысл узла, перекрывается состоянием warn / err
  const bad = st.st === 'err' ? P.err : st.st === 'warn' ? P.warn : null;
  switch (n.kind) {
    case 'joint': return bad || P.fg;
    case 'sensor': return bad || (st.st === 'off' ? P.subtle : P.mute);
    case 'bus': return bad || P.mute;
    case 'breaker': case 'backup': return st.st === 'err' ? P.err : P.warn;
    default: return bad || P.acc;                                                                        // source, core
  }
}

/* ---------- подписи узлов: приоритет и защита от наложений (как в Obsidian: в тесноте скрываются менее важные подписи) ---------- */
const LPRIO = { joint: 0, core: 1, source: 2, bus: 3, breaker: 4, backup: 5, sensor: 6 };
function layoutLabels(P, S, focusSet, focusing, dt) {
  const ease = 1 - Math.pow(0.0008, dt), taken = [];
  nodes.forEach(n => { n.lt = 0; if (n.vis > 0.3) { const r = dotR(n) + 5, x = sx(n.x), y = sy(n.y); taken.push([x - r, y - r, x + r, y + r, n]); } });
  const fs = n => (focusing && focusSet.has(n.id) ? 1 : 0), showSub = LOD.sub > 0.5;
  const list = nodes.filter(n => n.vis > 0.3 && (LOD.lab > 0.04 || n === hover)).sort((a, b) => ((b === hover) - (a === hover)) || ((b === selected) - (a === selected)) || (fs(b) - fs(a)) || ((LPRIO[a.kind] == null ? 9 : LPRIO[a.kind]) - (LPRIO[b.kind] == null ? 9 : LPRIO[b.kind])));
  ctx.save();
  list.forEach(n => {
    const x = sx(n.x), y = sy(n.y), r = dotR(n), st = nodeState(n, S), sub = !!st.sub && (showSub || n === hover); let w = 0;
    ctx.font = '500 11.5px ' + P.sans; n.lines.forEach(l => { w = Math.max(w, ctx.measureText(l).width); });
    if (sub) { ctx.font = '500 10.5px ' + P.mono; w = Math.max(w, ctx.measureText(st.sub).width); }
    const rc = [x - w / 2 - 4, y + r + 4, x + w / 2 + 4, y + r + 7 + n.lines.length * 14 + (sub ? 14 : 0)];
    const clash = taken.some(t => t[4] !== n && rc[0] < t[2] && rc[2] > t[0] && rc[1] < t[3] && rc[3] > t[1]);
    n.lr = rc; n.lt = n === hover || n === selected || !clash ? 1 : 0;
    if (n.lt) taken.push([rc[0], rc[1], rc[2], rc[3], n]);
  });
  ctx.restore();
  nodes.forEach(n => { n.lab += (n.lt - n.lab) * ease; });
  return taken;
}
function drawLabel(n, x, y, r, st, P, alphaV, back) {
  ctx.save(); ctx.globalAlpha = alphaV; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  if (back && n.lr) { const rc = n.lr; ctx.fillStyle = g.Store.rgba(P.card, 0.92); ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(rc[0], rc[1] - 1, rc[2] - rc[0], rc[3] - rc[1] + 2, 6); else ctx.rect(rc[0], rc[1] - 1, rc[2] - rc[0], rc[3] - rc[1] + 2); ctx.fill(); }
  ctx.font = '500 11.5px ' + P.sans; ctx.fillStyle = P.fg;
  n.lines.forEach((ln, i) => ctx.fillText(ln, x, y + r + 6 + i * 14));
  if (st.sub && (LOD.sub > 0.5 || n === hover)) { ctx.globalAlpha = alphaV * (n === hover ? 1 : sm((LOD.sub - 0.5) * 2)); ctx.font = '500 10.5px ' + P.mono; ctx.fillStyle = st.st === 'err' ? P.err : st.st === 'warn' ? P.warn : P.mute; ctx.fillText(st.sub, x, y + r + 7 + n.lines.length * 14); }
  ctx.restore();
}

/* ---------- отрисовка ---------- */
function draw(now, dt) {
  const P = g.Store.palette(), S = g.PINN.state(), F = g.PINN.flows(), pn = now / 1000, k = cam.k, ease = 1 - Math.pow(0.0008, dt), lightK = P.light ? 0.6 : 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  /* LOD: значения → формулы → названия гаснут по мере отдаления */
  LOD.lab += (sm((k - 0.4) / 0.3) - LOD.lab) * ease; LOD.fx += (sm((k - 0.62) / 0.3) - LOD.fx) * ease; LOD.sub += (sm((k - 0.8) / 0.3) - LOD.sub) * ease;
  const far = 1 - LOD.lab;                                                                                // 0 вблизи … 1 далеко: точки и импульсы крупнее и ярче

  /* фокус: наведение, иначе поиск */
  const focusSet = new Set(); let focusing = false;
  const q = query.trim().toLowerCase();
  if (hover) { focusing = true; focusSet.add(hover.id); edges.forEach(e => { if (e.A === hover) focusSet.add(e.B.id); if (e.B === hover) focusSet.add(e.A.id); }); }
  else if (q) { focusing = true; nodes.forEach(n => { if (TT(n.k).toLowerCase().indexOf(q) >= 0 || (n.sensor || '').toLowerCase().indexOf(q) >= 0 || n.id.indexOf(q) >= 0) focusSet.add(n.id); }); }
  nodes.forEach(n => { const tv = isVis(n) ? 1 : 0, th = !focusing || focusSet.has(n.id) ? 1 : 0.16; n.vis += (tv - n.vis) * ease; n.hl += (th - n.hl) * ease; });
  pulses = 0;

  /* связи */
  const flowSpeed = 14 + opt.flow * 1.6, placed = layoutLabels(P, S, focusSet, focusing, dt).map(r => r.slice(0, 4));   // placed — занятые прямоугольники: узлы, показанные подписи и уже нарисованные формулы (без наложений)
  edges.forEach(e => {
    const th = !focusing || (hover ? (e.A === hover || e.B === hover) : (focusSet.has(e.A.id) && focusSet.has(e.B.id))) ? 1 : 0.1;
    e.hl += (th - e.hl) * ease; e.flow += ((F[e.id] || 0) - e.flow) * (1 - Math.pow(0.003, dt));
    if (!edgeVis(e)) return;
    const x1 = sx(e.A.x), y1 = sy(e.A.y), x2 = sx(e.B.x), y2 = sy(e.B.y), len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const warmC = e.res || e.t === 'backup' ? P.warn : P.acc, vis = Math.min(e.A.vis, e.B.vis), f = e.flow, ra = dotR(e.A) + 1.5, rb = dotR(e.B) + 1.5;
    ctx.save(); ctx.globalAlpha = vis * (0.35 + 0.65 * e.hl);
    ctx.lineCap = 'round';
    if (f > 0.5 && e.t !== 'tele' && e.t !== 'sensor') {                                                   // мягкое свечение активной линии
      ctx.beginPath(); ctx.moveTo(x1 + ux * ra, y1 + uy * ra); ctx.lineTo(x2 - ux * rb, y2 - uy * rb);
      ctx.strokeStyle = g.Store.rgba(warmC, (0.06 + 0.06 * f + 0.05 * far) * lightK); ctx.lineWidth = 5 + 3 * far; ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(x1 + ux * ra, y1 + uy * ra); ctx.lineTo(x2 - ux * rb, y2 - uy * rb);
    if (e.t === 'power') { ctx.strokeStyle = f > 0.5 ? g.Store.rgba(warmC, 0.6) : g.Store.rgba(P.subtle, 0.45); ctx.lineWidth = 1.1 + 1.2 * f + 0.4 * far; if (e.res && f < 0.5) ctx.setLineDash([6, 5]); }
    else if (e.t === 'backup') { ctx.strokeStyle = f > 0.3 ? g.Store.rgba(P.warn, 0.6) : g.Store.rgba(P.subtle, 0.42); ctx.lineWidth = 1 + 0.8 * f + 0.3 * far; ctx.setLineDash(f > 0.3 ? [] : [6, 5]); }
    else if (e.t === 'cmd') { ctx.strokeStyle = f > 0.5 ? g.Store.rgba(P.acc, 0.7) : g.Store.rgba(P.subtle, 0.42); ctx.lineWidth = 1.1 + 0.3 * far; ctx.setLineDash([3, 4]); }
    else if (e.t === 'tele') { ctx.strokeStyle = g.Store.rgba(P.subtle, 0.5); ctx.lineWidth = 1 + 0.3 * far; ctx.setLineDash([1.5, 4]); }
    else { ctx.strokeStyle = g.Store.rgba(P.subtle, 0.6); ctx.lineWidth = 1 + 0.3 * far; }
    ctx.stroke(); ctx.setLineDash([]);
    /* импульсы энергии / данных вдоль линии: светящаяся точка с хвостом; вдали — крупнее */
    if (f > 0.03 && opt.flow > 0) {
      e.ph += dt * flowSpeed * (0.35 + f) / len; const n = Math.max(1, Math.floor(len / 95)), c = e.t === 'power' || e.t === 'cmd' ? warmC : (e.t === 'backup' ? P.warn : P.subtle), ps = 1 + 0.7 * far;
      for (let i = 0; i < n; i++) {
        const u = ((e.ph + i / n) % 1 + 1) % 1; pulses++;
        for (let tr = 0; tr < 4; tr++) { const uu = u - tr * 0.014; if (uu < 0.03 || uu > 0.97) continue; const px = x1 + (x2 - x1) * uu, py = y1 + (y2 - y1) * uu; ctx.fillStyle = g.Store.rgba(c, (tr === 0 ? 0.95 : 0.32 / tr) * Math.min(1, f + 0.25)); ctx.beginPath(); ctx.arc(px, py, (tr === 0 ? 2.3 : 1.9 - tr * 0.3) * ps, 0, TAU); ctx.fill(); }
        const px = x1 + (x2 - x1) * u, py = y1 + (y2 - y1) * u, gr = ctx.createRadialGradient(px, py, 0, px, py, 9 * ps); gr.addColorStop(0, g.Store.rgba(c, 0.34 * Math.min(1, f + 0.3) * lightK)); gr.addColorStop(1, g.Store.rgba(c, 0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px, py, 9 * ps, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
    /* подпись формулы: гаснет при отдалении (LOD.fx) */
    if (opt.showF && e.fx && LOD.fx > 0.02 && len > 90 && (focusing ? e.hl > 0.9 : (e.t === 'power' || e.t === 'cmd'))) {
      ctx.save(); ctx.font = '500 10.5px ' + P.mono; const tw = ctx.measureText(e.fx).width, mx = (x1 + x2) / 2, my = (y1 + y2) / 2, bx = mx - tw / 2 - 6, by = my - 9, bw = tw + 12;
      if (!placed.some(r => bx < r[2] && bx + bw > r[0] && by < r[3] && by + 18 > r[1])) {
        placed.push([bx, by, bx + bw, by + 18]); ctx.globalAlpha = vis * (0.25 + 0.75 * e.hl) * LOD.fx;
        ctx.fillStyle = g.Store.rgba(P.card, 0.88); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, 18, 6) : ctx.rect(bx, by, bw, 18); ctx.fill();
        ctx.fillStyle = P.mute; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(e.fx, mx, my + 0.5);
      }
      ctx.restore();
    }
  });

  /* узлы: залитые точки со свечением */
  const order = nodes.slice().sort((a, b) => a.r - b.r); let late = null;
  order.forEach(n => {
    if (n.vis < 0.02) return;
    const st = nodeState(n, S), x = sx(n.x), y = sy(n.y), r = dotR(n), col = nodeColor(n, st, P);
    const alarm = st.st === 'err' || (n.id === 'joint' && S.alarm.active && S.alarm.kind === 'heat') || (n.id === 'bus1' && S.alarm.active && S.alarm.kind === 'blackout');
    const a = n.vis * (0.3 + 0.7 * n.hl) * (st.on || n.kind === 'sensor' || n.kind === 'core' ? 1 : 0.55);
    ctx.save(); ctx.globalAlpha = a;
    const hr = r * (alarm ? 4.6 + Math.sin(pn * 5) * 0.9 : 3 + 0.9 * far) + (n === hover ? 6 : 0), ha = (alarm ? 0.42 : st.on ? 0.26 + 0.1 * far : 0.1) * lightK;     // мягкое свечение: ярче у аварии и в далёком виде
    const gr = ctx.createRadialGradient(x, y, r * 0.5, x, y, hr); gr.addColorStop(0, g.Store.rgba(alarm ? P.err : col, ha)); gr.addColorStop(1, g.Store.rgba(alarm ? P.err : col, 0));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, hr, 0, TAU); ctx.fill();
    if (n === selected) { ctx.strokeStyle = g.Store.rgba(P.acc, 0.95); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 5.5, 0, TAU); ctx.stroke(); }
    if (n.pin) { ctx.strokeStyle = g.Store.rgba(P.mute, 0.55); ctx.lineWidth = 1; ctx.setLineDash([2, 2.5]); ctx.beginPath(); ctx.arc(x, y, r + 3.2, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }   // закреплён пользователем
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    if (n.crit) { ctx.strokeStyle = g.Store.rgba(P.bg, 0.55); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, Math.max(1, r - 2.2), 0, TAU); ctx.stroke(); }                    // у критичного узла — тонкое «ядро»
    ctx.restore();
    /* подписи: наведённая рисуется последней и на подложке — читается поверх соседних, и видна даже при полном отдалении */
    const la = n.vis * LOD.lab * (0.4 + 0.6 * n.hl) * n.lab;
    if (n === hover) late = { n, x, y, r, st }; else if (la > 0.02) drawLabel(n, x, y, r, st, P, la, false);
  });
  if (late) drawLabel(late.n, late.x, late.y, late.r, late.st, P, late.n.vis, true);
  drawMini(P);
}

/* ---------- миникарта ---------- */
function drawMini(P) {
  if (!mctx) return; const w = mm.width / dpr, h = mm.height / dpr; mctx.setTransform(dpr, 0, 0, dpr, 0, 0); mctx.clearRect(0, 0, w, h);
  const bb = bounds(false), pad = 60, bw = bb.x1 - bb.x0 + pad * 2, bh = bb.y1 - bb.y0 + pad * 2, s = Math.min(w / bw, h / bh), ox = (w - bw * s) / 2 - (bb.x0 - pad) * s, oy = (h - bh * s) / 2 - (bb.y0 - pad) * s;
  mm._m = { s, ox, oy };
  mctx.lineWidth = 1; mctx.strokeStyle = g.Store.rgba(P.subtle, 0.4);
  edges.forEach(e => { if (!edgeVis(e)) return; mctx.beginPath(); mctx.moveTo(e.A.x * s + ox, e.A.y * s + oy); mctx.lineTo(e.B.x * s + ox, e.B.y * s + oy); mctx.stroke(); });
  nodes.forEach(n => { if (n.vis < 0.05) return; mctx.fillStyle = n === selected ? P.acc : g.Store.rgba(n.kind === 'joint' ? P.fg : n.kind === 'sensor' ? P.subtle : P.mute, 0.9); mctx.beginPath(); mctx.arc(n.x * s + ox, n.y * s + oy, Math.max(1.8, n.r * s * 0.9), 0, TAU); mctx.fill(); });
  const vx0 = wx(0) * s + ox, vy0 = wy(0) * s + oy, vx1 = wx(W) * s + ox, vy1 = wy(H) * s + oy;
  mctx.strokeStyle = P.acc; mctx.lineWidth = 1.2; mctx.fillStyle = g.Store.rgba(P.acc, 0.08); mctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0); mctx.strokeRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
}
function miniMove(e) { const r = mm.getBoundingClientRect(), m = mm._m; if (!m) return; const px = e.clientX - r.left, py = e.clientY - r.top; camT.x = (px - m.ox) / m.s; camT.y = (py - m.oy) / m.s; camT.k = cam.k; camT.on = true; }

/* ---------- ввод ---------- */
function pick(px, py) {
  let best = null, bd = 1e9;
  nodes.forEach(n => { if (n.vis < 0.3) return; const d = Math.hypot(sx(n.x) - px, sy(n.y) - py), rr = Math.max(14, dotR(n) + 9); if (d < rr && d < bd) { best = n; bd = d; } });   // зона попадания шире точки — удобно пальцем
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
    const d = drag, n = d.n; drag = null; alphaTarget = 0; cv.classList.remove('drag');
    if (d.moved) { n.pin = true; n.x = n.fx; n.y = n.fy; markDirty(); lastTap = { n: null, t: 0 }; }       // брошенный узел остаётся там, куда его положили
    else {
      if (!n.pin && !pinned) { n.fx = null; n.fy = null; }
      const now = performance.now();
      if (lastTap.n === n && now - lastTap.t < 340) { lastTap = { n: null, t: 0 }; togglePin(n); return; }         // двойной клик / тап: закрепить ↔ освободить
      lastTap = { n, t: now }; select(n, true);
    }
  } else if (panning) { const p = panning; panning = null; cv.classList.remove('drag'); if (!p.moved) { select(null, true); } }
}
function onWheel(e) { e.preventDefault(); const [px, py] = pos(e); zoomAt(px, py, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0012))); }
function onLeave() { if (!drag) { hover = null; cv.classList.remove('node'); hideTip(); } }
function showTip(n, px, py) {
  if (!tip) return; const S = g.PINN.state(), st = nodeState(n, S);
  tip.textContent = TT(n.k) + (st.sub ? ' · ' + st.sub : '') + (n.pin ? ' · ' + TT('g.pinned') : ''); tip.style.left = Math.min(W - 40, px + 16) + 'px'; tip.style.top = Math.min(H - 40, py + 14) + 'px'; tip.classList.add('on');
}
function hideTip() { if (tip) tip.classList.remove('on'); }
function select(n, user) {
  const was = selected; selected = n && typeof n === 'object' ? n : (typeof n === 'string' ? byId[n] || null : null);
  if (user) { if (selected && cbSelect) cbSelect(selected); else if (!selected && was && cbBg) cbBg(); else if (!selected && cbBg) cbBg(); }
}
function onKey(e) {
  if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.2); else if (e.key === '-') zoomAt(W / 2, H / 2, 1 / 1.2); else if (e.key === '0') fit(false);
  else if ((e.key === 'p' || e.key === 'P') && selected) togglePin(selected);
  else if (e.key.indexOf('Arrow') === 0) { const s = 40 / cam.k; if (e.key === 'ArrowLeft') cam.x -= s; if (e.key === 'ArrowRight') cam.x += s; if (e.key === 'ArrowUp') cam.y -= s; if (e.key === 'ArrowDown') cam.y += s; camT.on = false; e.preventDefault(); }
}

/* ---------- цикл ---------- */
/* ориентация раскладки: исходная — «широкая»; на вертикальном экране (телефон) узлы транспонируются, чтобы граф занимал всю высоту, а не узкую полосу.
   Транспонирование — изометрия (отражение по диагонали): длины связей и физика не меняются, а в Store.layout координаты всегда «широкие».
   Гистерезис 1.12 / 0.9 защищает от экранной клавиатуры. */
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
  if (lay.dirty && !drag && alpha < 0.004 && performance.now() - lay.at > 600) saveLayout();               // симуляция остыла — фиксируем расстановку
  if (camT.on) { const e = 1 - Math.pow(0.0006, dt); cam.x += (camT.x - cam.x) * e; cam.y += (camT.y - cam.y) * e; cam.k += (camT.k - cam.k) * e; if (Math.abs(camT.x - cam.x) + Math.abs(camT.y - cam.y) < 0.3 && Math.abs(camT.k - cam.k) < 0.002) camT.on = false; }
  draw(t, dt);
}
function start() {
  if (!inited) init(); if (running) return; resize(); running = true; last = 0;
  const fresh = !lay.ready; applyUser();
  if (fresh || !cam.k || (cam.x === 0 && cam.y === 0 && frames === 0)) fit(true);
  raf = requestAnimationFrame(frame);
}
function stop() { running = false; cancelAnimationFrame(raf); flushSave(); }
function setOpt(k, v) { opt[k] = v; if (k === 'rep' || k === 'len') reheat(0.7); if (k === 'showS' || k === 'showR') { camT.on = false; } }
function setPinned(v) {
  pinned = !!v; nodes.forEach(n => { if (pinned) { n.fx = n.x; n.fy = n.y; } else if (!n.pin) { n.fx = null; n.fy = null; } }); if (!pinned) reheat(0.5);
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
  const bind = (id, key) => { const el = $(id); if (!el) return; const f = () => { const v = el.type === 'checkbox' ? el.checked : +el.value; setOpt(key, v); const o = $(id + 'V'); if (o) o.textContent = el.value; }; el.addEventListener('input', f); f(); };
  bind('gRep', 'rep'); bind('gLen', 'len'); bind('gFlow', 'flow'); bind('gShowS', 'showS'); bind('gShowR', 'showR'); bind('gShowF', 'showF');
  const gs = $('gSearch'); if (gs) { gs.addEventListener('input', () => { query = gs.value; }); gs.addEventListener('keydown', e => { if (e.key === 'Enter') { const q = gs.value.trim().toLowerCase(); const m = q && nodes.find(n => TT(n.k).toLowerCase().indexOf(q) >= 0 || n.id.indexOf(q) >= 0 || (n.sensor || '').toLowerCase().indexOf(q) >= 0); if (m) { focus(m.id); select(m, true); } } }); }
  const fb = $('gFit'); if (fb) fb.addEventListener('click', () => fit(false));
  const pb = $('gPin'); if (pb) pb.addEventListener('click', () => setPinned(!pinned));
  const rb = $('gReset'); if (rb) rb.addEventListener('click', () => resetLayout());
  const th = $('gpToggle'), pn = $('gPanel'); if (th && pn) th.addEventListener('click', () => { const c = pn.dataset.c === '1' ? '0' : '1'; pn.dataset.c = c; th.setAttribute('aria-expanded', c === '1' ? 'false' : 'true'); });
  if (g.matchMedia && g.matchMedia('(max-width:820px)').matches && pn) { pn.dataset.c = '1'; th.setAttribute('aria-expanded', 'false'); }
  g.addEventListener('abai:lang', () => { wrapLabels(); setPinned(pinned); });
}
const lodInfo = () => ({ k: +cam.k.toFixed(3), labels: +LOD.lab.toFixed(3), formulas: +LOD.fx.toFixed(3), values: +LOD.sub.toFixed(3), level: LOD.lab < 0.15 ? 'dots' : LOD.sub < 0.5 ? 'names' : 'full' });
g.ObsidianGraph = { init, start, stop, resize, fit, focus, select: id => { select(id, false); }, setPinned, nodes: () => nodes, edges: () => edges, byId: id => byId[id],
  onSelect: f => { cbSelect = f; }, onBackground: f => { cbBg = f; }, hover: () => hover, selected: () => selected, camera: () => cam, isRunning: () => running,
  lod: lodInfo, layout: layoutMap, saveLayout, loadLayout, resetLayout, togglePin, pins: () => nodes.filter(n => n.pin).map(n => n.id),
  stats: () => ({ fps: Math.round(fpsAvg), frames, nodes: nodes.length, edges: edges.length, pulses, k: +cam.k.toFixed(3), alpha: +alpha.toFixed(4), W, H, dpr, pinned,
    labelsAlpha: +LOD.lab.toFixed(3), formulasAlpha: +LOD.fx.toFixed(3), layoutSaved: lay.saved, uid: lay.uid, pins: nodes.filter(n => n.pin).length, portrait }) };
})(window);
