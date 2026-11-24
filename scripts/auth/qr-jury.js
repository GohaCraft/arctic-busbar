/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/auth/qr-jury.js
   Выдвижная панель входа по QR / коду: настоящий QR (qr-encoder.js) на #qrCanvas, 6-значный код с окном 30 с и полоской таймера,
   вкладка «С телефона» (6 ячеек, автопереход, вставка), сканер камеры (getUserMedia + BarcodeDetector).
   Зависит от: window.UsersDB (jury.*, qr.*, pin.*), window.QREncoder.

   ЭТАП 3 — ZERO TRUST:
   • В ссылке больше НЕТ открытого кода (?code=123456 запрещён). QR кодирует <адрес>#abai-qr=<JWT-образный токен HS256>:
     подпись, срок жизни, тип, одноразовый jti. Токен в #-части не попадает на сервер / в логи / в Referer и стирается из адресной строки сразу после чтения.
   • Старые ссылки ?qr_auth=…&code=… отвергаются явно (сообщение «ссылка устарела»).
   • Витрина жюри (QR на экране стенда, код, универсальный PIN, кнопка «Тестовый вход») существует только при DEMO_MODE === true.
     В боевом режиме панель остаётся приёмной стороной: ввод 6-значного PIN из профиля сотрудника и сканирование его личного QR.
   • Все ответы «сервера» (UsersDB) содержат токен сессии; вход выполняет auth.js по событию.
   События (window): abai:session-ok {user, token, kind:'personal'|'jury', via:'code'|'scan'|'link'|'test'}, abai:jury-fail {via}. */
(function (g) {
'use strict';
const $ = id => document.getElementById(id), qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const DB = () => g.UsersDB, T = (k, p) => (g.I18N ? g.I18N.t(k, p) : k);
const DEMO = !!(g.ABAI_CONFIG && g.ABAI_CONFIG.DEMO_MODE === true);
const emit = (name, detail) => g.dispatchEvent(new CustomEvent(name, { detail }));

/* ---------- QR: лучший уровень коррекции из помещающихся (Q → M → M/12 → L/13); токен-ссылка ≈ 190–210 байт ---------- */
function encodeBest(text) {
  const plan = [['Q', 10], ['M', 10], ['M', 12], ['L', 13]];
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
const S = { win: -1, code: '', url: '', qr: null, open: false, cam: null, tab: DEMO ? 'pc' : 'phone' };
const visible = el => !!(el && el.offsetParent !== null);
function msg(kind, text) { const m = $('qrMsg'); if (!m) return; m.textContent = text; m.className = 'msg ' + kind; m.hidden = !text; }

function refresh(force) {
  const db = DB(); if (!db || !db.jury.enabled) return;                                             // витрина жюри — только DEMO_MODE
  const w = db.jury.win();
  if (w !== S.win || force) { S.win = w; S.code = db.jury.code(); S.url = db.jury.link(); S.qr = null; }
  const targets = qa('[data-qr]').filter(visible);
  if (targets.length && !S.qr) { try { S.qr = encodeBest(S.url); } catch (e) { msg('err', e.message); } }
  targets.forEach(cv => { const key = S.url + '|' + cv.clientWidth + '|' + (g.devicePixelRatio || 1); if (cv.dataset.key !== key && S.qr) { drawQR(cv, S.qr); cv.dataset.key = key; } });
  qa('[data-code]').forEach(bx => qa('b', bx).forEach((b, i) => {
    if (b.textContent !== S.code[i]) { b.textContent = S.code[i]; b.classList.remove('flip'); void b.offsetWidth; b.classList.add('flip'); }
  }));
  qa('[data-qr-url]').forEach(x => { x.textContent = S.url.replace(/^https?:\/\//, ''); x.title = T('qr.url'); });
  qa('[data-qr-devices]').forEach(x => { x.textContent = db.devices(); });
}
function tickTimer() {
  const db = DB(); if (!db) return; const left = db.jury.left();
  qa('[data-qr-timer]').forEach(i => { i.style.transform = 'scaleX(' + left.toFixed(4) + ')'; i.parentNode.classList.toggle('low', left < 0.17); });
  qa('[data-qr-sec]').forEach(x => { x.textContent = Math.ceil(left * 30) + ' ' + T('u.s'); });
}
setInterval(() => { if (DEMO && qa('[data-qr]').some(visible)) { refresh(false); tickTimer(); } }, 100);

/* ---------- выдвижная панель ---------- */
function setTab(t) {
  if (!DEMO) t = 'phone';
  S.tab = t; const dr = $('drawer'); if (!dr) return; dr.dataset.tab = t;
  qa('.tabs button', dr).forEach(b => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  if (t === 'pc') { closeCam(); refresh(true); } else { const f = qa('#otp input').find(x => !x.value) || qa('#otp input')[0]; if (f && S.open && !g.matchMedia('(pointer:coarse)').matches) f.focus(); }
}
function toggle(force) {
  const auth = $('auth'), dr = $('drawer'), btn = $('qrBtn'); if (!auth || !dr) return;
  const open = force == null ? !S.open : !!force; if (open === S.open) return;
  S.open = open; auth.dataset.drawer = open ? 'open' : 'closed'; dr.setAttribute('aria-hidden', !open); if (btn) btn.setAttribute('aria-expanded', open);
  if ('inert' in dr) dr.inert = !open;
  if (open) { clearCells(false); setTab(DEMO && !g.matchMedia('(max-width:820px)').matches ? 'pc' : 'phone'); msg('', ''); if (DEMO) { setTimeout(() => { refresh(true); tickTimer(); }, 30); setTimeout(() => refresh(true), 560); } }
  else { closeCam(); if (btn) btn.focus({ preventScroll: true }); }
}

/* ---------- разбор введённого / отсканированного ---------- */
/* → {code} (6 цифр) | {link} (ссылка или токен) | {legacy:true} (старая ссылка с открытым кодом) | null */
function parseLink(text) {
  text = String(text || '').trim(); if (!text) return null;
  if (/^\d{6}$/.test(text)) return { code: text };
  const db = DB(), tok = db.qr.parse(text); if (tok) return { link: tok };
  return db.qr.isLegacy(text) ? { legacy: true } : null;
}
const codeFrom = text => { const r = parseLink(text); return r && r.code ? r.code : ''; };
const REASON = { EXPIRED: 'auth.link.expired', USED: 'auth.link.used', LEGACY: 'auth.link.legacy', DISABLED: 'auth.link.disabled', NOT_YET: 'auth.link.expired' };
function bad(via, reason) {
  msg('err', reason && REASON[reason] ? T(REASON[reason]) : T(via === 'code' ? 'auth.msg.bad' : 'auth.link.bad'));
  const row = $('otp'); if (row) { row.classList.remove('bad'); void row.offsetWidth; row.classList.add('bad'); }
  clearCells(via === 'code'); emit('abai:jury-fail', { via, reason: reason || 'BAD' }); return false;
}
/* res — ответ UsersDB: {ok, kind, user, token} | {ok:false, reason} */
function finish(res, via) {
  if (res && res.ok) {
    const who = res.kind === 'jury' || res.user.role === 'jury' ? T('name.jury') : res.user.fio;
    msg('ok', T('auth.msg.ok', { who })); refresh(false); clearCells(false);
    emit('abai:session-ok', { user: res.user, token: res.token, kind: res.kind, via }); return true;
  }
  if (res && res.reason === 'LOCKED') {
    msg('err', T('auth.err.locked', { s: Math.max(1, Math.ceil(res.retryMs / 1000)) })); clearCells(false); emit('abai:jury-fail', { via, reason: 'LOCKED' }); return false;
  }
  return bad(via, res && res.reason);
}
function submit(input, via) {                                                                       // 6 цифр → PIN; иначе ссылка / токен
  const db = DB(), p = parseLink(input);
  if (!p) return bad(via);
  if (p.legacy) return bad(via, 'LEGACY');
  if (p.code) return finish(db.pin.redeem(p.code), via);
  return finish(db.qr.redeem(p.link), via);
}

/* ---------- ввод кода (вкладка «С телефона») ---------- */
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
      const raw = ((e.clipboardData || g.clipboardData).getData('text') || '').trim();
      const p = parseLink(raw);
      if (p && !p.code) { e.preventDefault(); submit(raw, 'link'); return; }                         // вставлена ссылка / токен целиком
      const d = raw.replace(/\D/g, '').slice(0, 6); if (d) { e.preventDefault(); fillFrom(0, d); }
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
      if (v.readyState >= 2) { const r = await cam.det.detect(v); for (let i = 0; i < r.length; i++) { const pl = parseLink(r[i].rawValue); if (pl) { closeCam(); setTab('phone'); submit(r[i].rawValue, 'scan'); return; } } }
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
  if (!DEMO) {                                                                                      // боевой режим: витрины жюри нет в DOM вообще
    qa('#drawer .tabs button[data-tab="pc"], #drawer .tp-pc').forEach(el => el.remove());
    const tabs = qa('#drawer .tabs')[0]; if (tabs) tabs.hidden = true;
  }
  qa('#drawer .tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  initCells();
  const tj = $('qrJury'); if (tj) tj.addEventListener('click', () => { const r = DB().jury.login(); if (r.ok) { msg('ok', T('auth.msg.test')); emit('abai:session-ok', { user: r.user, token: r.token, kind: 'jury', via: 'test' }); } });
  const cb = $('camBtn'); if (cb) cb.addEventListener('click', openCam);
  const cc = $('camClose'); if (cc) cc.addEventListener('click', closeCam);
  qa('[data-qr-url]').forEach(x => x.addEventListener('click', () => {
    const done = ok => { const o = x.textContent; x.textContent = T(ok ? 'qr.copied' : 'qr.copyfail'); setTimeout(() => { x.textContent = o; }, 1200); };
    try { navigator.clipboard.writeText(S.url).then(() => done(true), () => done(false)); } catch (e) { done(false); }
  }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('cam') && !$('cam').hidden) closeCam(); else if (S.open) toggle(false); } });
  document.addEventListener('click', e => {                                                         // клик по фону закрывает панель
    if (S.open && e.target.closest && !e.target.closest('.card, .drawer, #cam, .modal, .auth-top') && e.target.closest('#auth')) toggle(false);
  });
  g.matchMedia('(max-width:820px)').addEventListener('change', e => { if (S.open) setTab(DEMO && !e.matches ? 'pc' : 'phone'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) closeCam(); });
  if (DEMO) { refresh(true); tickTimer(); }
}
/* Вход по ссылке: <адрес>#abai-qr=<токен>. Токен читается и СРАЗУ стирается из адресной строки.
   → null (ссылки нет) | {ok:true, user, token, kind, via:'link'} | {bad:true, reason, via:'link'} */
function consumeUrlAuth() {
  try {
    const db = DB(), loc = g.location, sp = new URLSearchParams(loc.search), legacy = sp.has('qr_auth') || sp.has('code') || sp.has('uid');
    const hash = loc.hash || '', hasTok = hash.indexOf(db.qr.KEY + '=') >= 0;
    if (!hasTok && !legacy) return null;
    ['qr_auth', 'code', 'uid'].forEach(k => sp.delete(k)); const q = sp.toString();
    try { g.history.replaceState(null, '', loc.pathname + (q ? '?' + q : '')); } catch (e) { /* file:// */ }
    if (hasTok) { const r = db.qr.redeem(hash); return r.ok ? { ok: true, user: r.user, token: r.token, kind: r.kind, via: 'link' } : { bad: true, reason: r.reason, via: 'link' }; }
    return { bad: true, reason: 'LEGACY', via: 'link' };
  } catch (e) { return null; }
}

g.QRJury = { init, toggle, setTab, refresh, encodeBest, drawQR, codeFrom, parseLink, submit, consumeUrlAuth, closeCam,
  isOpen: () => S.open, state: () => ({ code: S.code, url: S.url, version: S.qr && S.qr.version, ecc: S.qr && S.qr.ecc }) };
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})(window);
