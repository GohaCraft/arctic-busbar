/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/qr-jury.js
   Выдвижная панель комиссии: настоящий QR (qr-encoder.js) на #qrCanvas, 6-значный код с окном 30 с и полоской таймера,
   вкладка «С телефона» (6 ячеек, автопереход, вставка), сканер камеры (getUserMedia + BarcodeDetector).
   Зависит от: window.UsersDB (jury.*, juryLink, devices, countDevice), window.QREncoder.
   ЭТАП 2: submit() принимает и код жюри (включая универсальный PIN), и ПЕРСОНАЛЬНЫЙ 6-значный PIN аккаунта (UsersDB.session) — тогда вход строго в этот аккаунт.
   Ссылки: ?qr_auth=jury_session&code=XXXXXX (жюри) и ?qr_auth=session&uid=<ID>&code=XXXXXX (личный вход с телефона).
   События (window): abai:jury-ok {via: 'test'|'code'|'scan'|'link'}, abai:session-ok {user, via: 'code'|'scan'|'link'}, abai:jury-fail {via}. Вход выполняет auth.js. */
(function (g) {
'use strict';
const $ = id => document.getElementById(id), qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const DB = () => g.UsersDB, T = (k, p) => (g.I18N ? g.I18N.t(k, p) : k);
const emit = (name, detail) => g.dispatchEvent(new CustomEvent(name, { detail }));

/* ---------- QR: лучший уровень коррекции из помещающихся (H → Q → M → L) ---------- */
function encodeBest(text) {
  const plan = [['H', 9], ['Q', 10], ['M', 10], ['L', 10]];
  for (let i = 0; i < plan.length; i++) { try { return g.QREncoder.encode(text, { ecc: plan[i][0], maxVersion: plan[i][1], minVersion: 4 }); } catch (e) { /* пробуем слабее */ } }
  throw new Error(T('qr.toolong'));
}
function rr(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
/* Отрисовка: тёмные модули на светлой подложке (читается любым сканером), «поисковые квадраты» со скруглением, синхродорожки и
   выравнивающие узоры — как в матрице; в центре — круглый значок-молния на тёмно-синей подложке (без белого квадрата). */
function drawQR(cv, qr, opt) {
  opt = opt || {};
  const dpr = Math.min(g.devicePixelRatio || 1, 3), css = cv.clientWidth || +cv.getAttribute('data-size') || 244, px = Math.round(css * dpr);
  if (cv.width !== px) { cv.width = px; cv.height = px; }
  const c = cv.getContext('2d'), N = qr.size, m = Math.max(2, Math.floor(px / (N + 8.6))), off = Math.round((px - m * N) / 2);   // тихая зона ≥ 4 модулей по ISO 18004
  c.clearRect(0, 0, px, px);
  const paper = c.createLinearGradient(0, 0, px, px); paper.addColorStop(0, '#F5FAFF'); paper.addColorStop(1, '#DDEAF6');
  c.fillStyle = paper; c.beginPath(); rr(c, 0, 0, px, px, m * 1.8); c.fill();
  const ink = c.createLinearGradient(0, off, 0, off + m * N); ink.addColorStop(0, '#0A2D52'); ink.addColorStop(1, '#050F1B');
  const mid = (N - 1) / 2, logo = opt.logo !== false, d = Math.min(9, Math.max(5, Math.round(N * 0.17) | 1)), clearR = d / 2 + 0.9;
  c.fillStyle = ink; c.beginPath();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!qr.modules[y][x] || qr.isFinder(x, y)) continue;
    if (logo && Math.hypot(x - mid, y - mid) <= clearR) continue;
    rr(c, off + x * m + m * 0.02, off + y * m + m * 0.02, m * 0.96, m * 0.96, m * 0.24);
  }
  c.fill();
  [[0, 0], [N - 7, 0], [0, N - 7]].forEach(f => {                                                  // поисковые квадраты 7×7 (слабое скругление: пропорция 1:1:3:1:1 строго сохранена)
    const X = off + f[0] * m, Y = off + f[1] * m;
    c.beginPath(); rr(c, X, Y, 7 * m, 7 * m, m * 1.25); rr(c, X + m, Y + m, 5 * m, 5 * m, m * 0.4); c.fillStyle = ink; c.fill('evenodd');
    c.beginPath(); rr(c, X + 2 * m, Y + 2 * m, 3 * m, 3 * m, m * 0.7); c.fillStyle = '#093B69'; c.fill();
  });
  if (logo) {                                                                                       // значок в центре
    const cx = off + (mid + 0.5) * m, R = d / 2 * m, bg = c.createRadialGradient(cx, cx - R * 0.35, R * 0.1, cx, cx, R);
    bg.addColorStop(0, '#12497E'); bg.addColorStop(1, '#050F1B');
    c.beginPath(); c.arc(cx, cx, R, 0, 6.2832); c.fillStyle = bg; c.fill();
    c.lineWidth = Math.max(1, m * 0.2); c.strokeStyle = '#38BDF8'; c.beginPath(); c.arc(cx, cx, R - m * 0.42, 0, 6.2832); c.stroke();
    const u = R * 0.052, bolt = [[2, -7.6], [-4.2, 1.1], [-0.3, 1.1], [-2.2, 7.6], [4.2, -1.3], [0.3, -1.3]], bf = c.createLinearGradient(cx, cx - 8 * u, cx, cx + 8 * u);
    bf.addColorStop(0, '#E9F9FF'); bf.addColorStop(1, '#38BDF8'); c.beginPath();
    bolt.forEach((p, i) => { i ? c.lineTo(cx + p[0] * u, cx + p[1] * u) : c.moveTo(cx + p[0] * u, cx + p[1] * u); }); c.closePath(); c.fillStyle = bf; c.fill();
  }
}

/* ---------- состояние панели ---------- */
const S = { win: -1, code: '', url: '', qr: null, qrKey: '', open: false, cam: null, tab: 'pc' };
const visible = el => !!(el && el.offsetParent !== null);
function msg(kind, text) { const m = $('qrMsg'); if (!m) return; m.textContent = text; m.className = 'msg ' + kind; m.hidden = !text; }

function refresh(force) {
  const db = DB(); if (!db) return;
  const w = db.jury.win();
  if (w !== S.win || force) { S.win = w; S.code = db.jury.code(); S.url = db.juryLink(S.code); S.qr = null; }
  const targets = qa('[data-qr]').filter(visible);
  if (targets.length && !S.qr) { try { S.qr = encodeBest(S.url); } catch (e) { msg('err', e.message); } }
  targets.forEach(cv => { const key = S.url + '|' + cv.clientWidth + '|' + (g.devicePixelRatio || 1); if (cv.dataset.key !== key && S.qr) { drawQR(cv, S.qr); cv.dataset.key = key; } });
  qa('[data-code]').forEach(bx => qa('b', bx).forEach((b, i) => {
    if (b.textContent !== S.code[i]) { b.textContent = S.code[i]; b.classList.remove('flip'); void b.offsetWidth; b.classList.add('flip'); }
  }));
  qa('[data-qr-url]').forEach(x => { x.textContent = S.url.replace(/^https?:\/\//, ''); x.title = S.url; });
  qa('[data-qr-devices]').forEach(x => { x.textContent = db.devices(); });
}
function tickTimer() {
  const db = DB(); if (!db) return; const left = db.jury.left();
  qa('[data-qr-timer]').forEach(i => { i.style.transform = 'scaleX(' + left.toFixed(4) + ')'; i.parentNode.classList.toggle('low', left < 0.17); });
  qa('[data-qr-sec]').forEach(x => { x.textContent = Math.ceil(left * 30) + ' ' + T('u.s'); });
}
setInterval(() => { if (qa('[data-qr]').some(visible)) { refresh(false); tickTimer(); } }, 100);

/* ---------- выдвижная панель ---------- */
function setTab(t) {
  S.tab = t; const dr = $('drawer'); if (!dr) return; dr.dataset.tab = t;
  qa('.tabs button', dr).forEach(b => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  if (t === 'pc') { closeCam(); refresh(true); } else { const f = qa('#otp input').find(x => !x.value) || qa('#otp input')[0]; if (f && S.open && !g.matchMedia('(pointer:coarse)').matches) f.focus(); }
}
function toggle(force) {
  const auth = $('auth'), dr = $('drawer'), btn = $('qrBtn'); if (!auth || !dr) return;
  const open = force == null ? !S.open : !!force; if (open === S.open) return;
  S.open = open; auth.dataset.drawer = open ? 'open' : 'closed'; dr.setAttribute('aria-hidden', !open); if (btn) btn.setAttribute('aria-expanded', open);
  if ('inert' in dr) dr.inert = !open;
  if (open) { clearCells(false); setTab(g.matchMedia('(max-width:820px)').matches ? 'phone' : 'pc'); msg('', ''); setTimeout(() => { refresh(true); tickTimer(); }, 30); setTimeout(() => refresh(true), 560); }
  else { closeCam(); if (btn) btn.focus({ preventScroll: true }); }
}

/* ---------- ввод кода (вкладка «С телефона») ---------- */
function parseLink(text) {                                                                         // {code, uid?} из ссылки QR или 6 цифр
  text = String(text || '').trim(); if (/^\d{6}$/.test(text)) return { code: text };
  try {
    const u = new URL(text), k = u.searchParams.get('qr_auth'), code = (u.searchParams.get('code') || '').replace(/\D/g, '');
    if (k === 'jury_session') return { code };
    if (k === 'session') return { code, uid: u.searchParams.get('uid') || '' };
  } catch (e) { /* не ссылка */ }
  const mt = /code=(\d{6})/.exec(text); return mt ? { code: mt[1] } : null;
}
const codeFrom = text => { const r = parseLink(text); return r ? r.code : ''; };
function bad(via) {
  msg('err', T('auth.msg.bad'));
  const row = $('otp'); if (row) { row.classList.remove('bad'); void row.offsetWidth; row.classList.add('bad'); }
  clearCells(via === 'code'); emit('abai:jury-fail', { via }); return false;
}
function submit(code, via, uid) {
  const db = DB(); code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6) return bad(via);
  if (uid) {                                                                                       // ссылка с известным аккаунтом: проверяем строго его
    if (!db.session.verify(uid, code)) return bad(via);
    const u = db.byId(uid); msg('ok', T('auth.msg.ok', { who: g.ScadaUI ? g.ScadaUI.fio(u) : u.fio })); if (via !== 'test') db.countDevice(); refresh(false); clearCells(false); emit('abai:session-ok', { user: u, via }); return true;
  }
  if (db.jury.verify(code)) {
    msg('ok', T('auth.msg.ok', { who: T('name.jury') })); if (via !== 'test') db.countDevice(); refresh(false); clearCells(false); emit('abai:jury-ok', { via }); return true;
  }
  const hit = db.session.match(code);                                                              // персональный PIN аккаунта
  if (hit) { msg('ok', T('auth.msg.ok', { who: hit.role === 'jury' ? T('name.jury') : hit.fio })); db.countDevice(); refresh(false); clearCells(false); emit('abai:session-ok', { user: hit, via }); return true; }
  return bad(via);
}
const cells = () => qa('#otp input');
function clearCells(focus) { cells().forEach(c => { c.value = ''; c.classList.remove('filled'); }); if (focus && cells()[0]) cells()[0].focus(); }
function fillFrom(start, digits) {
  const cs = cells(); Array.prototype.slice.call(digits).slice(0, 6 - start).forEach((ch, j) => { cs[start + j].value = ch; cs[start + j].classList.add('filled'); });
  cs[Math.min(start + digits.length, 5)].focus(); if (cs.every(x => x.value)) submit(cs.map(x => x.value).join(''), 'code');
}
function initCells() {
  const cs = cells();
  cs.forEach((c, i) => {
    c.addEventListener('input', () => {
      const v = c.value.replace(/\D/g, '');
      if (v.length >= 6) return fillFrom(0, v.slice(0, 6));                                         // автоподстановка кода целиком
      c.value = v.slice(-1); c.classList.toggle('filled', !!c.value);
      if (c.value && cs[i + 1]) cs[i + 1].focus();
      if (cs.every(x => x.value)) submit(cs.map(x => x.value).join(''), 'code');
    });
    c.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !c.value && cs[i - 1]) { e.preventDefault(); cs[i - 1].value = ''; cs[i - 1].classList.remove('filled'); cs[i - 1].focus(); }
      else if (e.key === 'ArrowLeft' && cs[i - 1]) { e.preventDefault(); cs[i - 1].focus(); }
      else if (e.key === 'ArrowRight' && cs[i + 1]) { e.preventDefault(); cs[i + 1].focus(); }
    });
    c.addEventListener('paste', e => {
      const d = ((e.clipboardData || g.clipboardData).getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (d) { e.preventDefault(); fillFrom(0, d); }
    });
    c.addEventListener('focus', () => { try { c.select(); } catch (e) { /* ok */ } });
  });
}

/* ---------- сканер камеры ---------- */
function camMsg(t, cls) { const m = $('camMsg'); if (m) { m.textContent = t; m.className = 'msg ' + (cls || ''); } }
function closeCam() {
  const c = S.cam; S.cam = null; if (c) { c.stop = true; clearTimeout(c.timer); if (c.stream) c.stream.getTracks().forEach(t => t.stop()); }
  const ov = $('cam'); if (ov) ov.hidden = true; const v = $('camVideo'); if (v) v.srcObject = null;
}
async function openCam() {
  const ov = $('cam'); if (!ov) return; ov.hidden = false; camMsg(T('cam.req'), 'info');
  const cam = S.cam = { stop: false, stream: null, timer: 0, det: null };
  if (!g.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camMsg(T('cam.insecure'), 'err'); return; }
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if (cam.stop) { cam.stream.getTracks().forEach(t => t.stop()); return; }
    const v = $('camVideo'); v.srcObject = cam.stream; await v.play();
  } catch (e) { camMsg(e && e.name === 'NotAllowedError' ? T('cam.denied') : T('cam.fail', { m: (e && e.message) || e }), 'err'); return; }
  if (!('BarcodeDetector' in g)) { camMsg(T('cam.nodet'), 'err'); return; }
  try { cam.det = new g.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { camMsg(T('cam.nodet2'), 'err'); return; }
  camMsg(T('cam.aim'), 'info');
  const loop = async () => {
    if (cam.stop || S.cam !== cam) return;
    try {
      const v = $('camVideo');
      if (v.readyState >= 2) { const r = await cam.det.detect(v); for (let i = 0; i < r.length; i++) { const pl = parseLink(r[i].rawValue); if (pl && pl.code) { closeCam(); setTab('phone'); submit(pl.code, 'scan', pl.uid); return; } } }
    } catch (e) { /* кадр не готов */ }
    cam.timer = setTimeout(loop, 180);
  };
  loop();
}

/* ---------- инициализация ---------- */
function init() {
  const qb = $('qrBtn'), dc = $('drawerClose');
  if (qb) qb.addEventListener('click', () => toggle());
  if (dc) dc.addEventListener('click', () => toggle(false));
  qa('#drawer .tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  initCells();
  const tj = $('qrJury'); if (tj) tj.addEventListener('click', () => { msg('ok', T('auth.msg.test')); emit('abai:jury-ok', { via: 'test' }); });
  const cb = $('camBtn'); if (cb) cb.addEventListener('click', openCam);
  const cc = $('camClose'); if (cc) cc.addEventListener('click', closeCam);
  qa('[data-qr-url]').forEach(x => x.addEventListener('click', () => {
    const done = ok => { const o = x.textContent; x.textContent = T(ok ? 'qr.copied' : 'qr.copyfail'); setTimeout(() => { x.textContent = o; }, 1200); };
    try { navigator.clipboard.writeText(S.url).then(() => done(true), () => done(false)); } catch (e) { done(false); }
  }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('cam') && !$('cam').hidden) closeCam(); else if (S.open) toggle(false); } });
  document.addEventListener('click', e => {                                                         // клик по фону закрывает панель
    if (S.open && e.target.closest && !e.target.closest('.card, .drawer, #cam, .modal') && e.target.closest('#auth')) toggle(false);
  });
  g.matchMedia('(max-width:820px)').addEventListener('change', e => { if (S.open) setTab(e.matches ? 'phone' : 'pc'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) closeCam(); });
  refresh(true); tickTimer();
}
function consumeUrlAuth() {                                                                        // ?qr_auth=jury_session&code=XXXXXX  |  ?qr_auth=session&uid=ID&code=XXXXXX
  try {
    const sp = new URLSearchParams(g.location.search), kind = sp.get('qr_auth');
    if (kind !== 'jury_session' && kind !== 'session') return null;
    const code = (sp.get('code') || '').replace(/\D/g, ''), uid = sp.get('uid') || '';
    ['qr_auth', 'code', 'uid'].forEach(k => sp.delete(k)); const q = sp.toString();
    try { g.history.replaceState(null, '', g.location.pathname + (q ? '?' + q : '') + g.location.hash); } catch (e) { /* file:// */ }
    if (kind === 'session') {
      if (DB().session.verify(uid, code)) { DB().countDevice(); return { via: 'link', user: DB().byId(uid), personal: true }; }
      return { via: 'link', bad: true, personal: true };
    }
    if (DB().jury.verify(code)) { DB().countDevice(); return { via: 'link' }; }
    return { via: 'link', bad: true };
  } catch (e) { return null; }
}

g.QRJury = { init, toggle, setTab, refresh, encodeBest, drawQR, codeFrom, parseLink, submit, consumeUrlAuth, closeCam,
  isOpen: () => S.open, state: () => ({ code: S.code, url: S.url, version: S.qr && S.qr.version, ecc: S.qr && S.qr.ecc }) };
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})(window);
