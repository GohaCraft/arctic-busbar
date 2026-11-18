/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/app/scada-ui.js  (рабочие виды #app: датчики, инспектор, калибровка, аудит, плагины)
   • Матрица датчиков: 4 живые карточки (значения плавно «скользят», спарклайн 60 FPS с градиентной заливкой и пунктирной уставкой, статусы, формулы PINN, «Калибровка уставки»).
   • Инспектор: выезжающий лист справа (клик по карточке датчика или узлу графа) — живые параметры, формулы, управление с проверкой RBAC.
   • Журнал аудита: фильтры период / сотрудник / тип, сортировка колонок, «Откатить (Rollback)», .CSV. Все события симулятора и действия пользователей пишутся в журнал.
   • Плагины: переключатели, JSON-параметры ⚙, редактор собственного JS / Python-плагина.
   • Верхняя панель: метрики, аварийная плашка, меню «Испытания стенда».
   Зависимости (загружаются раньше): Store, UsersDB, I18N, PINN, AuthApp. Окна/тосты/переключение видов — AppShell (вызывается во время работы).
   API: window.ScadaUI = { init, setView, renderGrid, renderAudit, renderPlugins, inspect, closeInspector, inspectorTarget, openCalibration, openPluginEditor, auditFilter, evText, whoName, tok, can, stats } */
(function (g) {
'use strict';
const D = document, $ = id => D.getElementById(id), qa = (s, r) => Array.prototype.slice.call((r || D).querySelectorAll(s));
const T = (k, p) => g.I18N.t(k, p), ST = () => g.Store, PN = () => g.PINN, DB = () => g.UsersDB;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), fx = (v, d) => (+v).toFixed(d == null ? 1 : d);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (n, c) => '<svg class="ico' + (c ? ' ' + c : '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>';
const me = () => (g.AuthApp && g.AuthApp.user && g.AuthApp.user()) || null;
const can = perm => { const u = me(); return !!(u && (DB().permsOf(u.id) || {})[perm]); };
const toast = (k, a, b) => { if (g.AppShell && g.AppShell.toast) g.AppShell.toast(k, a, b); };
const setT = (el, s) => { if (el && el.textContent !== s) el.textContent = s; };
const whoName = e => (e.role === 'jury' ? T('name.jury') : e.user);
const SRC_S = { IN1: 'ok', IN2: 'warn', LTO: 'err', DGU: 'err' };
let view = 'grid', run = false, raf = 0, lastT = 0, frame = 0, draws = 0, simTick = 0;

/* ======================= ДАТЧИКИ ======================= */
const stT = st => T(st === 'err' ? 'sc.err' : st === 'warn' ? 'sc.warn' : 'sc.ok');
const SENS = [
  { id: 'MLX90614-IR-01', tag: 'temp', thr: 'T_max', ser: 'temp', ms: 0.7, raw: true,
    m: [['sc.l.temp', S => S.T, 1, '°C', S => (S.status['MLX90614-IR-01'] === 'err' ? 'hot' : '')], ['sc.l.rk', S => S.Rk, 1, 'µΩ', S => (S.Rk > 40 ? 'hot' : '')], ['sc.l.force', S => S.F, 1, 'kN']],
    fx: S => 'R_k = K/√F = ' + fx(S.Rk, 1) + ' µΩ',
    flag: S => (S.guard.active ? ['warn', 'Kirchhoff Guard · SPOOF FILTERED'] : S.alarm.active && S.alarm.kind !== 'blackout' ? ['err', T('sc.flag.alarm')] : S.status['MLX90614-IR-01'] === 'warn' ? ['warn', T('sc.flag.warn')] : null) },
  { id: 'INA219-CUR-01', tag: 'current', thr: 'I_max', ser: 'cur', ms: 10,
    m: [['sc.l.cur', S => S.mI, 0, 'u.a'], ['sc.l.volt', S => S.mU, 1, 'u.kv'], ['sc.l.pow', S => S.mS, 1, 'MVA']],
    fx: S => 'S = √3·U·I = ' + fx(S.mS, 1) + ' MVA',
    flag: S => (!S.link.ina ? ['warn', 'LINK LOST'] : S.U < 5 ? ['warn', T('sc.flag.nov')] : S.status['INA219-CUR-01'] === 'err' ? ['err', T('sc.flag.over')] : null) },
  { id: 'MPU6050-VIB-01', tag: 'vib', thr: 'A_max', ser: 'acc', ms: 0.035,
    m: [['sc.l.freq', S => S.freq, 1, 'Hz'], ['sc.l.acc', S => S.acc, 2, 'g'], ['sc.l.state', S => stT(S.vibState), 'txt', '', S => S.vibState]],
    fx: S => 'a_rms = √(Σa²/N) = ' + fx(S.acc, 2) + ' g',
    flag: S => (S.vibState !== 'ok' ? [S.vibState, T('sc.flag.vib')] : null) },
  { id: 'LTO-BAT-BUF', tag: 'power', thr: 'U_min', ser: 'vdc', ms: 0.7,
    m: [['sc.l.vdc', S => S.vdc, 1, 'V DC'], ['sc.l.soc', S => S.soc, 0, '%'], ['sc.l.state', S => T('sc.lto.' + S.ltoState), 'txt', '', S => (S.ltoState === 'discharge' ? 'warn' : 'ok')]],
    fx: S => 'U_dc = f(SoC) = ' + fx(S.vdc, 1) + ' V',
    flag: S => (S.ltoState === 'discharge' ? ['warn', T('sc.flag.dis')] : S.status['LTO-BAT-BUF'] === 'err' ? ['err', 'U < U_min'] : null) }
];
const SBY = {}; SENS.forEach(s => { SBY[s.id] = s; });
const THR_OF = {}; Object.keys(ST().THR).forEach(k => { THR_OF[ST().THR[k].sensor] = k; });
let cards = [], gridFilter = { tag: 'all', q: '' };

function cardHTML(s) {
  const th = ST().THR[s.thr];
  return '<article class="sc" data-sid="' + s.id + '" data-tag="' + s.tag + '" data-st="ok" tabindex="0" role="button" aria-label="' + s.id + '">' +
    '<div class="sc-head"><div class="sc-id"><i class="sc-dot"></i><b>' + s.id + '</b></div><span class="pill" data-i18n="tag.' + s.tag + '"></span></div>' +
    '<p class="sc-desc" data-i18n="sd.' + s.id + '"></p>' +
    '<div class="sc-read">' + s.m.map(m => '<div class="sc-m"><div class="sc-val' + (m[2] === 'txt' ? ' st' : '') + '"><span class="v">—</span>' +
      (m[2] === 'txt' ? '' : '<u' + (/^u\./.test(m[3]) ? ' data-i18n="' + m[3] + '"' : '') + '>' + (/^u\./.test(m[3]) ? '' : m[3]) + '</u>') + '</div><span class="sc-lbl" data-i18n="' + m[0] + '"></span></div>').join('') + '</div>' +
    '<div class="sc-spark"><canvas aria-hidden="true"></canvas><span class="pill sc-flag"></span></div>' +
    '<div class="sc-foot"><span class="sc-fx"></span><span class="sc-thr"><span class="mono sc-sp">' + s.thr + ' —</span><button type="button" class="btn btn-sm" data-calib="' + s.thr + '" data-i18n="cb.btn"></button></span></div></article>';
}
function renderGrid() {
  const grid = $('sensorGrid'); if (!grid) return;
  if (!cards.length) {
    grid.innerHTML = SENS.map(cardHTML).join(''); I18N_apply(grid);
    cards = qa('.sc', grid).map((el, i) => ({ el, s: SENS[i], vals: [], v: qa('.sc-val .v', el), val: qa('.sc-val', el), fx: el.querySelector('.sc-fx'), sp: el.querySelector('.sc-sp'), flag: el.querySelector('.sc-flag'), cv: el.querySelector('canvas'), rng: null, st: 'ok', txt: [], fl: '' }));
    cards.forEach(c => { c.box = c.cv.parentElement; });
    if (g.ResizeObserver) { const ro = new ResizeObserver(es => es.forEach(en => { const c = cards.find(x => x.box === en.target); if (c) fit(c.cv); })); cards.forEach(c => ro.observe(c.box)); }
    cards.forEach(c => fit(c.cv));
  }
  states('grid'); applyGridFilter(); updateCards(0, true);
}
function fit(cv) {
  const r = cv.parentElement.getBoundingClientRect(); if (r.width < 8) return;
  cv._d = Math.min(2, g.devicePixelRatio || 1); cv._w = r.width; cv._h = r.height; cv.width = Math.round(r.width * cv._d); cv.height = Math.round(r.height * cv._d);
}
function I18N_apply(root) { g.I18N.apply(root); }
function states(name) {
  const box = D.querySelector('.states[data-for="' + name + '"]'); if (!box) return;
  if (!box.firstChild) box.innerHTML = '<div data-s="loading"><span class="spin"></span><span data-i18n="st.loading"></span></div><div data-s="empty"><b>∅</b><span data-i18n="st.empty"></span></div><div data-s="offline"><b>!</b><span data-i18n="st.offline"></span></div><div data-s="error"><b>×</b><span data-i18n="st.error"></span></div>';
  I18N_apply(box);
}
function applyGridFilter() {
  const q = gridFilter.q.trim().toLowerCase(); let n = 0;
  cards.forEach(c => {
    const ok = (gridFilter.tag === 'all' || (gridFilter.tag === 'anomaly' ? c.st !== 'ok' : c.s.tag === gridFilter.tag)) && (!q || (c.s.id + ' ' + T('sd.' + c.s.id) + ' ' + T('tag.' + c.s.tag)).toLowerCase().indexOf(q) >= 0);
    c.el.hidden = !ok; if (ok) n++;
  });
  const v = $('view-grid'); if (v) v.dataset.state = !PN().isRunning() ? 'offline' : n ? 'ok' : 'empty';
}

/* значения карточек: плавное скольжение к целевым (60 FPS), текст обновляется только при изменении */
function updateCards(dt, force) {
  const S = PN().state(), thr = ST().thr.all(), k = force ? 1 : 1 - Math.exp(-dt / 0.16), fxOn = !!ST().get('fx');
  cards.forEach(c => {
    c.s.m.forEach((m, i) => {
      if (m[2] === 'txt') { const t = m[1](S); if (c.txt[i] !== t) { c.txt[i] = t; c.v[i].textContent = t; } const cl = m[4] ? m[4](S) : 'ok'; c.val[i].className = 'sc-val st ' + (cl === 'ok' ? '' : cl); return; }
      const tg = +m[1](S); c.vals[i] = c.vals[i] == null ? tg : c.vals[i] + (tg - c.vals[i]) * k;
      setT(c.v[i], fx(c.vals[i], m[2])); const cl = m[4] ? m[4](S) : ''; if (c.val[i].dataset.c !== cl) { c.val[i].dataset.c = cl; c.val[i].classList.toggle('hot', cl === 'hot'); }
    });
    const st = S.status[c.s.id] || 'ok'; if (c.st !== st) { c.st = st; c.el.dataset.st = st; if (gridFilter.tag === 'anomaly') applyGridFilter(); }
    c.el.dataset.off = c.s.id === 'INA219-CUR-01' && !S.link.ina ? '1' : '0';
    const sp = THR_OF[c.s.id] ? thr[c.s.thr] : 0; setT(c.sp, c.s.thr + ' ' + ST().thr.fmt(c.s.thr, sp) + ' ' + ST().THR[c.s.thr].unit);
    c.fx.hidden = !fxOn; if (fxOn) setT(c.fx, c.s.fx(S));
    const f = c.s.flag(S), key = f ? f[0] + '|' + f[1] : ''; if (c.fl !== key) { c.fl = key; c.flag.classList.toggle('on', !!f); if (f) { c.flag.className = 'pill sc-flag on pill-' + f[0]; c.flag.textContent = f[1]; } }
  });
}

/* ---------- спарклайн: плавная лента 60 с, градиент, пунктирная уставка ---------- */
const WIN = 60000;
function spark(cv, o) {
  const w = cv._w, h = cv._h; if (!w || !h) return;
  const s = PN().series(o.ser), n = s.t.length; if (n < 2) return;
  const x = cv.getContext('2d'), d = cv._d, P = ST().palette(), now = Date.now(), t0 = now - WIN, S = PN().state();
  x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, h);
  let i0 = 0; while (i0 < n - 1 && s.t[i0 + 1] < t0) i0++;
  const showRaw = !!(o.raw && S.guard.active); let lo = 1e18, hi = -1e18;
  for (let i = i0; i < n; i++) { const v = s.v[i]; if (v < lo) lo = v; if (v > hi) hi = v; if (showRaw) { const r = s.r[i]; if (r < lo) lo = r; if (r > hi) hi = r; } }
  const span = Math.max(hi - lo, o.ms), c = (hi + lo) / 2; let tl = c - span * 0.62, th = c + span * 0.62;
  if (Math.abs(o.sp - c) < span * 3.4) { tl = Math.min(tl, o.sp - span * 0.12); th = Math.max(th, o.sp + span * 0.12); }
  const rg = o.rng || (o.rng = { lo: tl, hi: th }), a = o.first ? 1 : 1 - Math.pow(0.002, o.dt || 0.016);
  rg.lo += (tl - rg.lo) * a; rg.hi += (th - rg.hi) * a;
  const pad = 7, yy = v => h - pad - (v - rg.lo) / (rg.hi - rg.lo) * (h - pad * 2), xx = t => (t - t0) / WIN * w;
  const col = o.st === 'err' ? P.err : o.st === 'warn' ? P.warn : P.acc;
  const pts = [], stride = Math.max(1, Math.floor((n - i0) / (w * 0.8)));
  for (let i = i0; i < n; i += stride) pts.push([xx(s.t[i]), yy(s.v[i])]);
  pts.push([w, yy(s.v[n - 1])]);
  /* уставка */
  if (o.sp != null && isFinite(o.sp)) {
    const inRange = o.sp >= rg.lo && o.sp <= rg.hi, ys = inRange ? yy(o.sp) : (o.sp > rg.hi ? 5 : h - 5);
    x.save(); x.setLineDash([5, 4]); x.lineWidth = 1; x.strokeStyle = ST().rgba(P.warn, 0.85); x.beginPath(); x.moveTo(0, ys); x.lineTo(w, ys); x.stroke(); x.restore();
    x.font = '500 10px ' + P.mono; x.fillStyle = ST().rgba(P.warn, 0.95); x.textAlign = 'left'; x.textBaseline = ys < h / 2 ? 'top' : 'bottom';
    x.fillText((inRange ? '' : o.sp > rg.hi ? '▲ ' : '▼ ') + o.spT, 2, ys + (ys < h / 2 ? 3 : -3));
  }
  /* сырой сигнал при подавленной помехе */
  if (showRaw) {
    x.save(); x.setLineDash([2, 3]); x.lineWidth = 1; x.strokeStyle = ST().rgba(P.err, 0.7); x.beginPath(); let first = true;
    for (let i = i0; i < n; i += stride) { const px = xx(s.t[i]), py = yy(s.r[i]); if (first) { x.moveTo(px, py); first = false; } else x.lineTo(px, py); }
    x.stroke(); x.restore();
  }
  /* градиент и линия */
  const path = () => { x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; x.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); } x.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); };
  path(); x.lineTo(w, h); x.lineTo(pts[0][0], h); x.closePath();
  const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, ST().rgba(col, P.light ? 0.26 : 0.3)); gr.addColorStop(1, ST().rgba(col, 0)); x.fillStyle = gr; x.fill();
  path(); x.lineWidth = 1.6; x.lineJoin = 'round'; x.lineCap = 'round'; x.strokeStyle = col; x.stroke();
  const lx = w - 1, ly = pts[pts.length - 1][1], pr = 3 + (g.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : (Math.sin(now / 340) + 1) * 1.6);
  x.fillStyle = ST().rgba(col, 0.2); x.beginPath(); x.arc(lx - 3, ly, pr + 2, 0, 6.2832); x.fill(); x.fillStyle = col; x.beginPath(); x.arc(lx - 3, ly, 2.6, 0, 6.2832); x.fill();
  o.first = false; draws++;
}
function drawCards(dt) {
  const thr = ST().thr.all(), S = PN().state();
  cards.forEach(c => { if (c.el.hidden) return; const th = ST().THR[c.s.thr]; c.o = c.o || { first: true, ser: c.s.ser, ms: c.s.ms, raw: c.s.raw }; c.o.sp = thr[c.s.thr]; c.o.spT = ST().thr.fmt(c.s.thr, c.o.sp); c.o.st = S.status[c.s.id] || 'ok'; c.o.rng = c.o.rng || null; c.o.dt = dt; spark(c.cv, c.o); });
}

/* ======================= ВЕРХНЯЯ ПАНЕЛЬ, ТРЕВОГИ ======================= */
function onSim(S) {
  const thr = ST().thr.all();
  setT($('tU'), fx(S.mU, 1)); setT($('tI'), fx(S.mI, 0)); setT($('tT'), fx(S.T, 1)); setT($('tRul'), g.I18N.dur(S.rul)); setT($('mU'), fx(S.mU, 1)); setT($('mT'), fx(S.T, 1));
  const hot = S.T >= thr.T_max * 0.9; $('tT').classList.toggle('hot', hot); const tp = $('mTp'); if (tp) tp.classList.toggle('hot', hot);
  const sl = T('src.' + S.src), ss = SRC_S[S.src] || 'ok'; setT($('tSrc'), sl); setT($('mSrc'), sl); $('tSrcBox').dataset.s = ss; $('mSrc').dataset.s = ss;
  const cs = $('coreStatus'); if (cs) cs.dataset.s = S.alarm.active ? 'err' : S.guard.active ? 'warn' : 'ok';
  alarmUI(S); if ((++simTick & 3) === 0) { if (view === 'grid') applyGridFilter(); } updateInspector(S);
}
function alarmUI(S) {
  const A = S.alarm, el = $('alarm'); if (!el) return; const show = A.active && !A.acked;
  if (!show) { if (!el.hidden) el.hidden = true; return; }
  const k = A.kind; el.dataset.k = k === 'false' ? 'warn' : 'err';
  setT($('alarmTitle'), T('al.' + k + '.t')); setT($('alarmMsg'), T('al.' + k + '.m', { t: fx(S.T, 1), rul: g.I18N.dur(S.rul), src: T('src.' + S.src), soc: Math.round(S.soc) }));
  if (el.hidden) el.hidden = false;
}

/* ======================= ИНСПЕКТОР ======================= */
let insp = null;                                                               // {kind:'sensor'|'node', id, rows:[], o}
const NODE = {
  in1: { t: 'node.in1', d: 'nd.in1', kv: [['kv.volt', S => fx(S.mU, 1) + ' ' + T('u.kv')], ['kv.state', S => (S.in1 === 'closed' ? (S.U > 5 ? T('sd.load') : T('sd.off')) : T('sd.open')), S => (S.in1 === 'closed' && S.U > 5 ? 'ok' : 'warn')], ['kv.cur', S => fx(S.mI, 0) + ' ' + T('u.a')]], acts: [] },
  in2: { t: 'node.in2', d: 'nd.in2', kv: [['kv.volt', S => fx(S.U, 1) + ' ' + T('u.kv')], ['kv.state', S => (S.U > 5 ? (S.in1 === 'open' ? T('sd.load') : T('sd.standby')) : T('sd.off')), S => (S.in1 === 'open' ? 'warn' : 'ok')]], acts: [] },
  ats: { t: 'node.ats', d: 'nd.ats', kv: [['kv.pos', S => (S.ats === 'closed' ? T('sd.closed') : T('sd.open')), S => (S.ats === 'closed' ? 'warn' : 'ok')], ['kv.src', S => T('src.' + S.src)], ['kv.rulmin', S => '≤ ' + ((ST().plugins.get('ATS-AUTO-TRANSFER') || { params: {} }).params.rul_min || 15) + ' ' + T('u.min')]],
    fx: ['RUL ≤ RUL_min → ATS', 'ΣI = 0'], acts: [['transfer', 'in.transfer', 'CAN_SWITCH_RELAY', S => S.ats === 'open' && S.in1 === 'closed'], ['return', 'in.return', 'CAN_SWITCH_RELAY', S => S.ats === 'closed' || S.in1 === 'open']] },
  bus1: { t: 'node.bus1', d: 'nd.bus', kv: [['kv.volt', S => fx(S.mU, 1) + ' ' + T('u.kv')], ['kv.cur', S => fx(S.mI, 0) + ' ' + T('u.a')], ['kv.pow', S => fx(S.mS, 1) + ' MVA']], fx: ['S = √3·U·I'], acts: [] },
  bus2: { t: 'node.bus2', d: 'nd.bus', kv: [['kv.volt', S => fx(S.U, 1) + ' ' + T('u.kv')], ['kv.state', S => (S.U > 5 ? T('sd.standby') : T('sd.off'))]], acts: [] },
  joint: { t: 'node.joint', d: 'nd.joint', sensor: 'MLX90614-IR-01', kv: [['kv.t', S => fx(S.T, 1) + ' °C', S => S.status['MLX90614-IR-01']], ['kv.rk', S => fx(S.Rk, 1) + ' µΩ', S => (S.Rk > 40 ? 'err' : '')], ['kv.f', S => fx(S.F, 1) + ' kN'], ['kv.p', S => fx(S.P, 1) + ' ' + T('u.w')], ['kv.rul', S => g.I18N.dur(S.rul), S => (S.rul < 60 ? 'err' : S.rul < 600 ? 'warn' : '')]],
    fx: ['R_k = K / √F · film', 'ΔP = I² · R_k', 'RUL = RUL₀ · exp(−c · (R_k/R₀ − 1))', 'T → T_ss = T_amb + ΔT·(I/I₀)²'], acts: [['calib:T_max', 'cb.btn', 'CAN_EDIT_PINN']] },
  s_ir: { sensor: 'MLX90614-IR-01' }, s_cur: { sensor: 'INA219-CUR-01' }, s_vib: { sensor: 'MPU6050-VIB-01' }, lto: { sensor: 'LTO-BAT-BUF', extra: true },
  core: { t: 'node.core', d: 'nd.core', kv: [['kv.guard', S => (S.guard.active ? 'SPOOF FILTERED' : T('sd.standby')), S => (S.guard.active ? 'warn' : 'ok')], ['kv.traw', S => fx(S.Traw, 1) + ' °C', S => (S.guard.active ? 'warn' : '')], ['kv.test', S => fx(S.guard.est, 1) + ' °C'], ['kv.plug', () => ST().plugins.list().filter(p => p.on).length + ' / ' + ST().plugins.list().length]],
    fx: ['|T_ir − T_phys| > 6 °C ∧ ΔI = 0 → SPOOF', 'ΣI_in = ΣI_out'], acts: [['ack', 'al.ack', 'CAN_SWITCH_RELAY', S => S.alarm.active && !S.alarm.acked]] },
  dgu: { t: 'node.dgu', d: 'nd.dgu', kv: [['kv.state', S => T('sd.' + S.dgu), S => (S.dgu === 'active' ? 'warn' : '')], ['kv.soc', S => Math.round(S.soc) + ' %']], acts: [['dgu.start', 'in.dgustart', 'CAN_SWITCH_RELAY', S => S.dgu === 'standby'], ['dgu.stop', 'in.dgustop', 'CAN_SWITCH_RELAY', S => S.dgu !== 'standby']] }
};
function sensRows(sid) {
  const s = SBY[sid];
  return { t: sid, d: 'sd.' + sid, sensor: sid, kv: s.m.map(m => [m[0], S => (m[2] === 'txt' ? m[1](S) : fx(m[1](S), m[2]) + ' ' + (/^u\./.test(m[3]) ? T(m[3]) : m[3])), S => (m[2] === 'txt' ? (m[4] ? m[4](S) : '') : '')]).concat([['kv.setp', () => s.thr + ' = ' + ST().thr.fmt(s.thr, ST().thr.get(s.thr)) + ' ' + ST().THR[s.thr].unit]]),
    fx: ({ 'MLX90614-IR-01': ['R_k = K / √F · film', 'ΔP = I² · R_k'], 'INA219-CUR-01': ['S = √3 · U · I / 1000', 'ΣI = 0 (Kirchhoff)'], 'MPU6050-VIB-01': ['a_rms = √(Σa² / N)'], 'LTO-BAT-BUF': ['SoC = Q / Q₀ · 100 %', 'T_LTO ≥ −55 °C'] })[sid], acts: [['calib:' + s.thr, 'cb.btn', 'CAN_EDIT_PINN']] };
}
function defOf(t) {
  if (t.kind === 'sensor') return sensRows(t.id);
  const n = NODE[t.id]; if (!n) return null;
  if (n.sensor && !n.kv) return sensRows(n.sensor);
  if (n.sensor && n.kv) return Object.assign({}, n, { sensor: n.sensor });
  return n;
}
function inspect(target) {
  const t = typeof target === 'string' ? { kind: 'node', id: target } : target, def = defOf(t); if (!def) return;
  const S = PN().state(), sid = def.sensor || (t.kind === 'sensor' ? t.id : null);
  insp = { t, def, sid, o: { first: true, ser: sid ? SBY[sid].ser : '', ms: sid ? SBY[sid].ms : 1, raw: sid && SBY[sid].raw }, rows: [] };
  const body = $('inspBody');
  body.innerHTML = '<div class="in-id"><b>' + esc(def.t.indexOf('node.') === 0 ? T(def.t) : def.t) + '</b><span>' + esc(T(def.d)) + '</span><div class="in-row" id="inPills"></div></div>' +
    '<div class="in-sec"><h4 data-i18n="insp.live"></h4><div class="in-kv" id="inKv">' + def.kv.map(r => '<div><span data-i18n="' + r[0] + '"></span><b></b></div>').join('') + '</div></div>' +
    (sid ? '<div class="in-sec"><div class="sc-spark" id="inSpark" style="height:96px"><canvas aria-hidden="true"></canvas></div></div>' : '') +
    (def.fx ? '<div class="in-sec"><h4 data-i18n="insp.phys"></h4><div class="in-fx">' + def.fx.map(f => '<span>' + esc(f) + '</span>').join('') + '</div></div>' : '') +
    '<div class="in-sec" id="inCtl"><h4 data-i18n="insp.ctl"></h4><div class="in-acts" id="inActs"></div><p class="in-note" id="inNote"></p></div>';
  I18N_apply(body); insp.rows = qa('#inKv > div > b', body); insp.cv = sid ? body.querySelector('canvas') : null; if (insp.cv) fit(insp.cv);
  renderActs(); updateInspector(S, true);
  const el = $('insp'); el.classList.add('open'); el.setAttribute('aria-hidden', 'false'); $('inspTitle').textContent = T('insp.title');
  qa('.sc[data-sel="1"]').forEach(c => { c.dataset.sel = '0'; }); if (t.kind === 'sensor') { const c = cards.find(x => x.s.id === t.id); if (c) c.el.dataset.sel = '1'; }
  if (t.kind === 'node' && g.ObsidianGraph) g.ObsidianGraph.select(t.id);
}
function renderActs() {
  if (!insp) return; const S = PN().state(), box = $('inActs'), notes = []; let html = '';
  (insp.def.acts || []).forEach(a => {
    if (a[3] && !a[3](S)) return; const ok = !a[2] || can(a[2]); if (!ok && notes.indexOf(a[2]) < 0) notes.push(a[2]);
    html += '<button type="button" class="btn' + (a[0] === 'transfer' || a[0] === 'dgu.start' ? ' btn-pri' : '') + '" data-act="' + a[0] + '"' + (ok ? '' : ' disabled') + '>' + ico(a[0].indexOf('calib') === 0 ? 'sliders' : a[0] === 'ack' ? 'check' : a[0].indexOf('dgu') === 0 ? 'power' : 'reset') + '<span data-i18n="' + a[1] + '"></span></button>';
  });
  box.innerHTML = html; I18N_apply(box); $('inCtl').hidden = !html;
  setT($('inNote'), notes.length ? T('perm.denied', { perm: notes[0] }) : '');
}
function updateInspector(S, force) {
  if (!insp) return; const d = insp.def;
  d.kv.forEach((r, i) => { const b = insp.rows[i]; if (!b) return; setT(b, r[1](S)); const c = r[2] ? r[2](S) : ''; if (b.dataset.c !== c) { b.dataset.c = c; b.className = c || ''; } });
  const pills = $('inPills'); if (pills) {
    const st = insp.sid ? (S.status[insp.sid] || 'ok') : (insp.t.id === 'joint' ? (S.status['MLX90614-IR-01'] || 'ok') : insp.t.id === 'core' ? (S.guard.active ? 'warn' : 'ok') : 'ok');
    const key = st + (insp.sid ? '|' + SBY[insp.sid].tag : '');
    if (pills.dataset.k !== key + g.I18N.get()) { pills.dataset.k = key + g.I18N.get(); pills.innerHTML = '<span class="pill pill-' + (st === 'ok' ? 'ok' : st) + '">' + esc(stT(st)) + '</span>' + (insp.sid ? '<span class="pill">' + esc(T('tag.' + SBY[insp.sid].tag)) + '</span>' : ''); }
  }
  if (force || (simTick & 7) === 0) renderActs();
}
function closeInspector() {
  const el = $('insp'); if (!el) return; el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); insp = null;
  qa('.sc[data-sel="1"]').forEach(c => { c.dataset.sel = '0'; }); if (g.ObsidianGraph) g.ObsidianGraph.select(null);
}
function inspAction(a) {
  const S = PN().state();
  if (a.indexOf('calib:') === 0) return openCalibration(a.slice(6));
  const need = { transfer: 'CAN_SWITCH_RELAY', return: 'CAN_SWITCH_RELAY', 'dgu.start': 'CAN_SWITCH_RELAY', 'dgu.stop': 'CAN_SWITCH_RELAY', ack: 'CAN_SWITCH_RELAY' }[a];
  if (need && !can(need)) return toast('err', T('perm.t'), T('perm.denied', { perm: need }));
  if (a === 'ack') { ackAlarm(); } else { const r = PN().act(a); if (!r.ok) toast('warn', T('act.fail'), T('act.state')); else if (a === 'dgu.start' || a === 'dgu.stop') { /* журнал пишет мост событий */ } }
  renderActs(); updateInspector(S, true);
}
function ackAlarm() {
  const S = PN().state(); if (!S.alarm.active || S.alarm.acked) return; const kind = S.alarm.kind;
  if (PN().ack()) { ST().log({ cat: 'PINN', k: 'ev.alarm.ack', p: { kind }, node: kind === 'blackout' ? 'SUBSTATION' : 'A-1', old: 'ALARM', nw: 'ACK' }); toast('ok', T('al.acked'), T('al.' + kind + '.t')); }
}

/* ======================= КАЛИБРОВКА УСТАВКИ ======================= */
let calKey = '';
function openCalibration(key) {
  const th = ST().THR[key]; if (!th) return; calKey = key;
  const cur = ST().thr.get(key); $('cbSensor').textContent = th.sensor + ' · ' + key; $('cbName').textContent = T('thr.' + key);
  $('cbCur').textContent = ST().thr.fmt(key, cur); $('cbUnit').textContent = th.unit; const inp = $('cbInput'); inp.value = ST().thr.fmt(key, cur); inp.step = th.dec ? String(Math.pow(10, -th.dec)) : '1';
  $('cbRange').textContent = T('cb.range', { min: th.min, max: th.max, unit: th.unit }); $('cbErr').textContent = '';
  const ok = can('CAN_EDIT_PINN'); $('cbPerm').hidden = ok; inp.disabled = !ok; $('cbApply').disabled = !ok;
  if (g.AppShell) g.AppShell.openWnd('mCalib', ok ? inp : null);
}
function applyCalibration(ev) {
  ev.preventDefault(); const key = calKey, th = ST().THR[key]; if (!th) return;
  if (!can('CAN_EDIT_PINN')) { $('cbErr').textContent = T('perm.denied', { perm: 'CAN_EDIT_PINN' }); return; }
  const raw = $('cbInput').value.replace(',', '.'), v = raw.trim() === '' ? NaN : +raw, r = ST().thr.set(key, v);
  if (!r.ok) { $('cbErr').textContent = r.reason === 'RANGE' ? T('cb.err.range', { min: th.min, max: th.max, unit: th.unit }) : T('cb.err.num'); return; }
  if (r.old === r.value) { g.AppShell.closeWnd('mCalib'); return; }
  const fmt = x => ST().thr.fmt(key, x) + ' ' + th.unit;
  ST().log({ cat: 'THRESHOLD', k: 'ev.setpoint', p: { name: key }, node: th.sensor, old: fmt(r.old), nw: fmt(r.value), undo: { kind: 'setpoint', data: { key, value: r.old } } });
  g.AppShell.closeWnd('mCalib'); toast('ok', T('cb.done'), key + ': ' + fmt(r.old) + ' → ' + fmt(r.value));
}

/* ======================= ЖУРНАЛ АУДИТА ======================= */
const AU = { period: '30d', from: NaN, to: NaN, user: '', type: '', sort: 'ts', dir: -1, limit: 250 };
const TOKS = /\b(IN1|IN2|ATS|DGU|LTO|SUBSTATION)\b/g;
function tok(s) {
  s = String(s == null ? '' : s); if (!s) return '';
  if (g.I18N.has('st.' + s)) return T('st.' + s);
  if (g.I18N.has('via.' + s)) return T('via.' + s);
  return s.replace(TOKS, m => T('nt.' + m));
}
function evText(e) { const p = Object.assign({}, e.p); if (e.k === 'ev.demo') p.name = T('demo.' + (e.p.name || 'reset')); else if (e.k === 'ev.alarm.ack' && e.p.kind) p.kind = T('al.' + e.p.kind + '.t'); return T(e.k, p); }
const sev = e => (/^ev\.(alarm\.(heat|false|blackout)|blackout)$/.test(e.k) ? 'err' : /^ev\.(ats|dgu|spoof|alarm|plugin\.(alarm|error))/.test(e.k) || e.cat === 'ROLLBACK' ? 'warn' : e.cat === 'THRESHOLD' || e.cat === 'RBAC' ? 'acc' : '');
function auditRows() {
  const now = Date.now(); let L = ST().audit.list().slice();
  if (AU.period === '24h') L = L.filter(e => e.ts >= now - 864e5); else if (AU.period === '30d') L = L.filter(e => e.ts >= now - 30 * 864e5);
  else if (AU.period === 'custom') L = L.filter(e => (isNaN(AU.from) || e.ts >= AU.from) && (isNaN(AU.to) || e.ts <= AU.to + 59999));
  if (AU.user) L = L.filter(e => e.userId === AU.user); if (AU.type) L = L.filter(e => e.cat === AU.type);
  const d = AU.dir, num = e => +String(e.id).replace(/\D/g, '');
  const key = { tx: e => num(e), ts: e => e.ts, user: e => whoName(e).toLowerCase(), cat: e => T('cat.' + e.cat).toLowerCase(), ev: e => evText(e).toLowerCase() }[AU.sort] || (e => e.ts);
  L.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * d || (b.ts - a.ts); });
  return L;
}
function auditRow(e) {
  const rb = e.undo && !e.rb, okp = can('CAN_ROLLBACK_LOGS'), chg = e.old && e.nw ? esc(tok(e.old)) + '<i>→</i>' + esc(tok(e.nw)) : (e.nw || e.old) ? esc(tok(e.nw || e.old)) : '—', s = sev(e);
  const act = e.rb ? '<span class="pill pill-warn">' + esc(T('a.rolled')) + '</span>' : rb ? '<button type="button" class="btn btn-sm" data-rb="' + e.id + '"' + (okp ? '' : ' disabled title="' + esc(T('perm.denied', { perm: 'CAN_ROLLBACK_LOGS' })) + '"') + '>' + ico('undo') + '<span>' + esc(T('a.rb')) + '</span></button>' : '';
  return '<tr data-id="' + e.id + '"' + (e.rb ? ' class="rb"' : '') + '><td class="au-tx" data-c="tx">' + e.id + '</td><td class="au-ts" data-c="ts">' + ST().fmtDT(e.ts) + '</td>' +
    '<td data-c="who"><div class="au-who"><b>' + esc(whoName(e)) + '</b><span>' + esc(T('role.' + e.role)) + '</span></div></td>' +
    '<td data-c="cat"><span class="pill au-cat' + (s ? ' pill-' + s : '') + '">' + esc(T('cat.' + e.cat)) + '</span></td>' +
    '<td data-c="ev"><div class="au-ev"><b>' + esc(evText(e)) + '</b><span>' + esc(tok(e.node)) + '</span></div></td><td class="au-chg" data-c="chg">' + chg + '</td><td class="au-act" data-c="act">' + act + '</td></tr>';
}
function renderAudit() {
  const body = $('auditBody'); if (!body) return;
  const L = auditRows(), all = ST().audit.count(); body.innerHTML = L.slice(0, AU.limit).map(auditRow).join('');
  $('view-audit').dataset.state = L.length ? 'ok' : 'empty'; states('audit');
  const f = $('auditFoot'); f.textContent = T('a.foot', { n: Math.min(L.length, AU.limit), m: L.length, all }); setT($('cAudit'), String(all));
  qa('#auditTable th[data-sort]').forEach(th => { const on = th.dataset.sort === AU.sort; if (on) th.dataset.dir = AU.dir; else delete th.dataset.dir; const a = th.querySelector('.arr'); if (a) a.textContent = on && AU.dir > 0 ? '↑' : '↓'; });
  qa('#auditPeriod button').forEach(b => b.classList.toggle('on', b.dataset.p === AU.period)); $('auditRange').classList.toggle('on', AU.period === 'custom');
}
function fillAuditUsers() {
  const sel = $('auditUser'); if (!sel) return; const cur = AU.user, seen = {}, opts = [['', T('a.allUsers')]];
  DB().list().forEach(u => { seen[u.id] = 1; opts.push([u.id, fio(u)]); }); ST().audit.list().forEach(e => { if (!seen[e.userId]) { seen[e.userId] = 1; opts.push([e.userId, whoName(e)]); } });
  sel.innerHTML = opts.map(o => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join(''); sel.value = cur;
}
function fio(u) { return u.role === 'jury' ? T('name.jury') : u.fio; }
function auditFilter(o) { Object.assign(AU, o || {}); if (o && ('from' in o || 'to' in o)) AU.period = AU.period; renderAudit(); }
function rollback(id) {
  const r = ST().audit.rollback(id);
  if (r.ok) { toast('ok', T('a.rbdone'), id); renderAudit(); renderPlugins(); updateCards(0, true); if (g.AppShell && g.AppShell.refreshAccess) g.AppShell.refreshAccess(); }
  else toast('err', T('a.rbfail'), r.reason === 'PERM' ? T('perm.denied', { perm: 'CAN_ROLLBACK_LOGS' }) : T('a.rb.' + r.reason));
}

/* обработчики отката (журнал пишет сам Store.audit.rollback) */
function registerUndo() {
  const A = ST().audit;
  A.registerUndo('setpoint', d => { const th = ST().THR[d.key], old = ST().thr.get(d.key), r = ST().thr.set(d.key, d.value); return r.ok ? { node: th.sensor, old: ST().thr.fmt(d.key, old) + ' ' + th.unit, nw: ST().thr.fmt(d.key, d.value) + ' ' + th.unit } : null; });
  A.registerUndo('rbac', d => { const o = (DB().permsOf(d.userId) || {})[d.perm], r = DB().setPerm(d.userId, d.perm, d.value); return r.ok ? { node: d.perm + ' · ' + d.userId, old: o ? 'ON' : 'OFF', nw: d.value ? 'ON' : 'OFF' } : null; });
  A.registerUndo('plugin', d => { const p = ST().plugins.get(d.id), o = p && p.on, r = ST().plugins.setOn(d.id, d.on); return r ? { node: d.id, old: o ? 'ON' : 'OFF', nw: d.on ? 'ON' : 'OFF' } : null; });
  A.registerUndo('pluginParams', d => { const p = ST().plugins.get(d.id), o = p && JSON.stringify(p.params), r = ST().plugins.setParams(d.id, d.params); return r ? { node: d.id, old: o, nw: JSON.stringify(d.params) } : null; });
}

/* ======================= ПЛАГИНЫ ======================= */
function plugRow(p) {
  const err = PN().pluginErrors()[p.id], lang = p.lang === 'py' ? 'Python' : 'JavaScript';
  return '<div class="pl-row" data-on="' + (p.on ? 1 : 0) + '" data-id="' + esc(p.id) + '"><div class="pl-main"><b>' + esc(p.id) + '</b><span>' + esc(p.builtin ? T('pd.' + p.id) : T('p.custom.d', { lang })) + '</span>' +
    '<div class="pl-meta"><span class="pill">' + esc(T(p.cat)) + '</span><span class="pill">v' + esc(p.ver) + '</span><span class="pill">' + p.lat + ' ' + esc(T('u.ms')) + '</span>' + (p.builtin ? '' : '<span class="pill pill-acc">' + (p.lang === 'py' ? 'PY' : 'JS') + '</span>') + (err ? '<span class="pill pill-err">' + esc(err) + '</span>' : '') + '</div></div>' +
    '<div class="pl-ctl"><button type="button" class="btn btn-ghost btn-sm btn-ic" data-pl-cfg="' + esc(p.id) + '" aria-label="' + esc(T('p.cfg')) + '" title="' + esc(T('p.cfg')) + '">' + ico('gear') + '</button>' +
    (p.builtin ? '' : '<button type="button" class="btn btn-ghost btn-sm btn-ic" data-pl-del="' + esc(p.id) + '" aria-label="' + esc(T('p.del')) + '" title="' + esc(T('p.del')) + '">' + ico('x') + '</button>') +
    '<label class="sw"><input type="checkbox" data-pl-on="' + esc(p.id) + '"' + (p.on ? ' checked' : '') + ' aria-label="' + esc(p.id) + '"><i></i></label></div></div>';
}
function renderPlugins() {
  const box = $('plugList'); if (!box) return; const L = ST().plugins.list();
  box.innerHTML = L.map(plugRow).join(''); setT($('plCount'), T('p.count', { n: L.length, a: L.filter(p => p.on).length })); setT($('cPlug'), String(L.length)); states('plugins'); $('view-plugins').dataset.state = 'ok';
}
let PE = null;
function openPluginEditor(id) {
  const p = id ? ST().plugins.get(id) : null; if (id && !p) return; PE = { id: id || null, p };
  const isNew = !p, bi = !!(p && p.builtin);
  $('plTitle').textContent = T(isNew ? 'p.new' : 'p.edit'); $('plSub').textContent = isNew ? '' : p.id; $('plNameF').hidden = !isNew; $('plLangF').hidden = !isNew; $('plCodeF').hidden = bi; $('plNote').hidden = false; $('plErr').textContent = '';
  $('plName').value = isNew ? '' : p.id; $('plLang').value = p ? p.lang : 'js'; $('plParams').value = JSON.stringify(p ? p.params : { threshold: 85, enabled: true }, null, 2);
  $('plCode').value = p && !bi ? p.code : T('p.code.tpl'); noteFor(bi ? 'cfg' : (p ? p.lang : 'js'));
  if (g.AppShell) g.AppShell.openWnd('mPlugin', isNew ? $('plName') : $('plParams'));
}
function noteFor(l) { const sp = $('plNote').querySelector('span'), k = l === 'py' ? 'p.note.py' : l === 'cfg' ? 'p.note.cfg' : 'p.note.js'; sp.setAttribute('data-i18n', k); sp.textContent = T(k); }
function savePlugin() {
  const err = m => { $('plErr').textContent = m; }; if (!PE) return;
  if (!can('CAN_MANAGE_PLUGINS')) return err(T('perm.denied', { perm: 'CAN_MANAGE_PLUGINS' }));
  let params; try { params = JSON.parse($('plParams').value.trim() || '{}'); if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('obj'); } catch (e) { return err(T('p.err.json')); }
  const bi = !!(PE.p && PE.p.builtin), lang = PE.p ? PE.p.lang : $('plLang').value, code = $('plCode').value;
  if (!bi && lang === 'js') { try { new Function('plugin', '"use strict";\n' + code); } catch (e) { return err(T('p.err.js', { m: e.message })); } }
  if (!PE.p) {
    const id = $('plName').value.trim(), r = ST().plugins.add({ id, lang, code, params });
    if (!r.ok) return err(T(r.reason === 'DUP' ? 'p.err.dup' : 'p.err.id'));
    ST().log({ cat: 'PLUGIN', k: 'ev.plugin.add', p: { id }, node: id, old: '', nw: 'ON' }); toast('ok', T('p.added'), id);
  } else {
    const p = PE.p, oldParams = JSON.parse(JSON.stringify(p.params || {})), oldCode = p.code;
    if (!bi) p.code = code; ST().plugins.setParams(p.id, params);
    const ch = JSON.stringify(oldParams) !== JSON.stringify(params);
    ST().log({ cat: 'PLUGIN', k: 'ev.plugin.params', p: { id: p.id }, node: p.id, old: JSON.stringify(oldParams), nw: JSON.stringify(params), undo: ch ? { kind: 'pluginParams', data: { id: p.id, params: oldParams } } : null });
    toast('ok', T('p.saved'), p.id); void oldCode;
  }
  g.AppShell.closeWnd('mPlugin'); renderPlugins();
}
function togglePlugin(id, on, input) {
  if (!can('CAN_MANAGE_PLUGINS')) { input.checked = !on; return toast('err', T('perm.t'), T('perm.denied', { perm: 'CAN_MANAGE_PLUGINS' })); }
  const r = ST().plugins.setOn(id, on); if (!r) return;
  ST().log({ cat: 'PLUGIN', k: on ? 'ev.plugin.on' : 'ev.plugin.off', p: { id }, node: id, old: r.old ? 'ON' : 'OFF', nw: on ? 'ON' : 'OFF', undo: { kind: 'plugin', data: { id, on: r.old } } });
  const row = input.closest('.pl-row'); if (row) row.dataset.on = on ? '1' : '0'; setT($('plCount'), T('p.count', { n: ST().plugins.list().length, a: ST().plugins.list().filter(p => p.on).length }));
}
function deletePlugin(id) {
  if (!can('CAN_MANAGE_PLUGINS')) return toast('err', T('perm.t'), T('perm.denied', { perm: 'CAN_MANAGE_PLUGINS' }));
  if (ST().plugins.remove(id)) { ST().log({ cat: 'PLUGIN', k: 'ev.plugin.remove', p: { id }, node: id, old: 'ON', nw: '' }); toast('ok', T('p.removed'), id); renderPlugins(); }
}

/* ======================= МОСТ: события стенда и системы → журнал аудита и уведомления ======================= */
function bridge() {
  const on = (n, f) => g.addEventListener(n, e => f(e.detail || {}));
  const L = e => ST().log(e), S = () => PN().state();
  on('abai:auth', d => {
    if (d.type === 'login') L({ cat: 'AUTH', k: 'ev.login', node: '', old: '', nw: d.via || 'password', userObj: d.user });
    else if (d.type === 'logout') L({ cat: 'AUTH', k: 'ev.logout', node: '', old: '', nw: '', userObj: d.user });
  });
  on('abai:pwdrequest', r => L({ cat: 'PWD_RESET', k: 'ev.pwd.req', p: { id: r.id }, node: r.id, old: '', nw: 'PENDING', userObj: DB().byId(r.userId) }));
  on('abai:pwdresolved', d => { const r = d.request; L({ cat: 'PWD_RESET', k: r.status === 'APPROVED' ? 'ev.pwd.ok' : 'ev.pwd.no', p: { id: r.id }, node: r.id, old: 'PENDING', nw: r.status }); });
  on('abai:alarm', d => {
    if (!d.active || d.acked) return; const s = S();
    if (d.kind === 'blackout') { L({ sys: true, cat: 'PINN', k: 'ev.blackout', node: 'SUBSTATION', old: '110.2 kV', nw: '0 kV' }); toast('err', T('al.blackout.t'), T('al.blackout.m', { src: T('src.LTO'), soc: Math.round(s.soc) })); }
    else if (d.kind === 'heat') { L({ sys: true, cat: 'PINN', k: 'ev.alarm.heat', p: { t: fx(d.T, 1), rul: fx(d.rul, 0) }, node: 'A-1', old: '42.4 °C', nw: fx(d.T, 1) + ' °C' }); toast('err', T('al.heat.t'), T('al.heat.m', { t: fx(d.T, 1), rul: g.I18N.dur(d.rul), src: T('src.' + s.src) })); }
    else { L({ sys: true, cat: 'PINN', k: 'ev.alarm.false', p: { t: fx(d.T, 1) }, node: 'MLX90614-IR-01', old: '42.4 °C', nw: fx(d.T, 1) + ' °C' }); toast('warn', T('al.false.t'), T('al.false.m')); }
  });
  on('abai:ats', d => {
    if (d.auto) { L({ sys: true, cat: 'RELAY', k: 'ev.ats.auto', node: 'ATS', old: 'IN1', nw: 'IN2' }); toast('warn', T('toast.ats'), T('toast.ats.d')); }
    else if (d.to === 'IN2') { L({ cat: 'RELAY', k: 'ev.ats.manual', node: 'ATS', old: 'IN1', nw: 'IN2' }); toast('ok', T('toast.ats.m'), T('toast.ats.d')); }
    else { L({ cat: 'RELAY', k: 'ev.ats.back', node: 'ATS', old: 'IN2', nw: 'IN1' }); toast('ok', T('toast.back'), T('src.IN1')); }
  });
  on('abai:dgu', d => {
    if (d.state === 'active') { L({ sys: !!d.auto, cat: 'RELAY', k: 'ev.dgu.start', node: 'DGU', old: 'STANDBY', nw: 'ACTIVE' }); toast('warn', T('toast.dgu'), T('toast.dgu.d')); }
    else if (d.state === 'standby') L({ cat: 'RELAY', k: 'ev.dgu.stop', node: 'DGU', old: 'ACTIVE', nw: 'STANDBY' });
  });
  on('abai:spoof', d => { L({ sys: true, cat: 'PINN', k: 'ev.spoof', p: { raw: fx(d.raw, 1), t: fx(d.filtered, 1) }, node: 'MLX90614-IR-01', old: fx(d.raw, 1) + ' °C', nw: fx(d.filtered, 1) + ' °C' }); toast('warn', 'Kirchhoff Guard · SPOOF FILTERED', T('toast.spoof', { raw: fx(d.raw, 1), t: fx(d.filtered, 1) })); });
  on('abai:scenario', d => {
    if (d.phase === 'start') { L({ cat: 'PINN', k: 'ev.demo', p: { name: d.name }, node: d.name === 'blackout' ? 'SUBSTATION' : 'MLX90614-IR-01', old: '', nw: d.name.toUpperCase() }); toast('info', T('demo.' + d.name), T('demo.' + d.name + '.d')); }
    else if (d.phase === 'reset') { L({ cat: 'PINN', k: 'ev.demo', p: { name: 'reset' }, node: 'DEMO', old: String(d.name || '').toUpperCase(), nw: 'OK' }); toast('info', T('demo.reset'), T('demo.reset.d')); }
  });
  on('abai:plugin-alarm', d => L({ sys: true, cat: 'PLUGIN', k: 'ev.plugin.alarm', p: { id: d.id }, node: d.id, old: '', nw: d.note || 'ALARM' }));
  on('abai:plugin-error', d => { L({ sys: true, cat: 'PLUGIN', k: 'ev.plugin.error', p: { id: d.id }, node: d.id, old: '', nw: String(d.message).slice(0, 80) }); renderPlugins(); });
  on('abai:sim', () => { /* значения обновляет onSim через опрос ниже */ });
  on('abai:audit', () => { setT($('cAudit'), String(ST().audit.count())); if (view === 'audit') { fillAuditUsers(); renderAudit(); } });
  on('abai:thresholds', () => { updateCards(0, true); if (insp) updateInspector(S(), true); });
  on('abai:plugins', () => { if (view === 'plugins') renderPlugins(); });
  on('abai:restored', () => { renderGrid(); renderPlugins(); fillAuditUsers(); renderAudit(); });
  on('abai:lang', () => { cards.forEach(c => { c.txt = []; c.fl = ''; }); renderGrid(); fillAuditUsers(); renderAudit(); renderPlugins(); if (insp) inspect(insp.t); });
  on('abai:settings', d => { if (d.key === 'fx') updateCards(0, true); if (d.key === 'tz') renderAudit(); if (d.key === 'theme' || d.key === 'accent') { ST().palette(true); cards.forEach(c => { c.o && (c.o.first = true); }); } });
}

/* ======================= ЦИКЛ ОТРИСОВКИ ======================= */
function loop(t) {
  if (!run) return; raf = requestAnimationFrame(loop);
  const dt = Math.min(0.1, (t - (lastT || t)) / 1000); lastT = t; if (dt <= 0) return; frame++;
  if (ST().get('fps') === 30 && (frame & 1)) return;
  if (!PN().isRunning()) return;
  if (view === 'grid') { updateCards(dt); drawCards(dt); }
  if (insp && insp.cv && insp.sid) { const S = PN().state(); insp.o.sp = ST().thr.get(SBY[insp.sid].thr); insp.o.spT = ST().thr.fmt(SBY[insp.sid].thr, insp.o.sp); insp.o.st = S.status[insp.sid] || 'ok'; insp.o.dt = dt; if (!insp.cv._w) fit(insp.cv); spark(insp.cv, insp.o); }
}
function start() { if (run) return; run = true; lastT = 0; raf = requestAnimationFrame(loop); }
function stop() { run = false; cancelAnimationFrame(raf); }
function setView(v) { view = v; if (v === 'grid') { applyGridFilter(); cards.forEach(c => fit(c.cv)); cards.forEach(c => { if (c.o) c.o.first = true; }); } if (v === 'audit') { fillAuditUsers(); renderAudit(); } if (v === 'plugins') renderPlugins(); }

/* ======================= ИНИЦИАЛИЗАЦИЯ ======================= */
function init() {
  registerUndo(); bridge(); renderGrid(); states('audit'); states('plugins'); fillAuditUsers();
  const on = (id, ev, f) => { const el = $(id); if (el) el.addEventListener(ev, f); };
  /* матрица датчиков */
  on('gridSearch', 'input', e => { gridFilter.q = e.target.value; applyGridFilter(); });
  on('gridTags', 'click', e => { const b = e.target.closest('[data-tag]'); if (!b) return; gridFilter.tag = b.dataset.tag; qa('#gridTags .chip').forEach(c => c.classList.toggle('on', c === b)); applyGridFilter(); });
  on('sensorGrid', 'click', e => {
    const b = e.target.closest('[data-calib]'); if (b) { e.stopPropagation(); return openCalibration(b.dataset.calib); }
    const c = e.target.closest('.sc'); if (c) inspect({ kind: 'sensor', id: c.dataset.sid });
  });
  on('sensorGrid', 'keydown', e => { if (e.key !== 'Enter' && e.key !== ' ') return; const c = e.target.closest('.sc'); if (c && e.target === c) { e.preventDefault(); inspect({ kind: 'sensor', id: c.dataset.sid }); } });
  /* инспектор */
  on('inspClose', 'click', closeInspector);
  on('inspBody', 'click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) inspAction(b.dataset.act); });
  if (g.ObsidianGraph) { g.ObsidianGraph.onSelect(n => inspect({ kind: 'node', id: n.id })); g.ObsidianGraph.onBackground(closeInspector); }
  /* калибровка */
  on('calibForm', 'submit', applyCalibration);
  /* аудит */
  on('auditPeriod', 'click', e => { const b = e.target.closest('[data-p]'); if (!b) return; AU.period = b.dataset.p; if (AU.period === 'custom' && isNaN(AU.from)) { AU.from = Date.now() - 7 * 864e5; AU.to = Date.now(); $('auditFrom').value = ST().toInput(AU.from); $('auditTo').value = ST().toInput(AU.to); } renderAudit(); });
  on('auditFrom', 'change', e => { AU.from = ST().fromInput(e.target.value); renderAudit(); }); on('auditTo', 'change', e => { AU.to = ST().fromInput(e.target.value); renderAudit(); });
  on('auditUser', 'change', e => { AU.user = e.target.value; renderAudit(); }); on('auditType', 'change', e => { AU.type = e.target.value; renderAudit(); });
  on('auditTable', 'click', e => {
    const th = e.target.closest('th[data-sort]'); if (th) { const k = th.dataset.sort; if (AU.sort === k) AU.dir = -AU.dir; else { AU.sort = k; AU.dir = k === 'ts' || k === 'tx' ? -1 : 1; } return renderAudit(); }
    const b = e.target.closest('[data-rb]'); if (b && !b.disabled) rollback(b.dataset.rb);
  });
  on('auditCsv', 'click', () => { const L = auditRows(), csv = ST().audit.csv(L); ST().backup.download('arctic-busbar-audit-' + ST().fmtDT(Date.now()).replace(/[: ]/g, '-') + '.csv', csv, 'text/csv;charset=utf-8'); toast('ok', T('a.csvdone'), T('a.foot', { n: L.length, m: L.length, all: ST().audit.count() })); });
  /* плагины */
  on('btnAddPlugin', 'click', () => { if (!can('CAN_MANAGE_PLUGINS')) return toast('err', T('perm.t'), T('perm.denied', { perm: 'CAN_MANAGE_PLUGINS' })); openPluginEditor(null); });
  on('plugList', 'change', e => { const i = e.target.closest('[data-pl-on]'); if (i) togglePlugin(i.dataset.plOn, i.checked, i); });
  on('plugList', 'click', e => { const c = e.target.closest('[data-pl-cfg]'); if (c) return openPluginEditor(c.dataset.plCfg); const d = e.target.closest('[data-pl-del]'); if (d) deletePlugin(d.dataset.plDel); });
  on('plSave', 'click', savePlugin); on('plLang', 'change', e => { noteFor(e.target.value); });
  /* тревоги */
  on('alarmAck', 'click', () => { if (!can('CAN_SWITCH_RELAY')) return toast('err', T('perm.t'), T('perm.denied', { perm: 'CAN_SWITCH_RELAY' })); ackAlarm(); });
  g.addEventListener('abai:sim', e => onSim(e.detail));
  g.addEventListener('abai:auth', e => { const d = e.detail || {}; if (d.type === 'login') { cards.forEach(c => { c.vals = []; c.txt = []; c.fl = ''; if (c.o) { c.o.first = true; c.o.rng = null; } }); renderGrid(); renderPlugins(); fillAuditUsers(); renderAudit(); start(); } else if (d.type === 'logout') { stop(); closeInspector(); $('alarm').hidden = true; } });
}
function stats() { return { draws, frame, view, running: run, inspector: insp ? insp.t : null, cards: cards.length, audit: auditRows().length }; }

g.ScadaUI = { init, setView, renderGrid, renderAudit, renderPlugins, inspect, closeInspector, inspectorTarget: () => (insp ? insp.t : null), openCalibration, openPluginEditor, auditFilter, evText, whoName, tok, can, stats, start, stop, ackAlarm, rollback, fio };
init();
})(window);
