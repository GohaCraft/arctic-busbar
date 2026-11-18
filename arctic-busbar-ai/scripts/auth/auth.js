/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/auth/auth.js  (UI-контроллер экрана входа #auth)
   Живые часы UTC+7, меню [?] с автоподстановкой, глазок, вход/выход, встряска при ошибке, ACCESS GRANTED, восстановление пароля
   (1 запрос / 24 ч на аккаунт, точный таймер), вход жюри (abai:jury-ok / abai:jury-fail) и ЛИЧНЫЙ вход с телефона (abai:session-ok от qr-jury.js).
   ЭТАП 2: все сообщения идут через I18N (6 языков, мгновенная смена без перезагрузки), строка профиля собирается из Store, окно профиля — в app-shell.js.
   События (window): abai:auth {type:'login'|'logout', user, via, ts}; via: password | jury-test | jury-code | jury-scan | jury-link | session-code | session-scan | session-link.
   Также слушает abai:pwdrequest / abai:pwdresolved (их шлёт users-db.js). Публичное API: window.AuthApp. */
(function (g) {
'use strict';
const $ = id => document.getElementById(id), qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s)), B = document.body;
const DB = () => g.UsersDB, T = (k, p) => g.I18N.t(k, p), pad = n => String(n).padStart(2, '0');
const S = { user: null, t0: 0, busy: false, rcvTimer: 0, rcvNext: 0 };
const emit = (name, detail) => g.dispatchEvent(new CustomEvent(name, { detail }));
const coarse = () => g.matchMedia('(pointer:coarse)').matches;

/* ---------- часы экрана входа (внутренние часы #app ведёт app-shell.js) ---------- */
const clock = off => { const d = new Date(Date.now() + off * 36e5); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()); };
function tick() { const a = $('authClock'); if (a) { a.textContent = 'UTC+7 ' + clock(7); a.setAttribute('datetime', new Date().toISOString()); } }
(function loop() { tick(); setTimeout(loop, 1000 - Date.now() % 1000 + 5); })();                     // тик ровно на границе секунды

/* ---------- ошибки / встряска ---------- */
function shake() {
  const c = $('card'); if (!c) return; c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake', 'err');
  clearTimeout(shake.t1); clearTimeout(shake.t2); shake.t1 = setTimeout(() => c.classList.remove('shake'), 700); shake.t2 = setTimeout(() => c.classList.remove('err'), 1500);
  if (g.FrostCanvas) g.FrostCanvas.pulse(1);
}
function authMsg(text, kind) { const m = $('authMsg'); m.textContent = text || ''; m.className = 'msg ' + (kind || 'err'); m.hidden = !text; }
function fail(text, field) { authMsg(text, 'err'); shake(); if (field) { field.focus(); try { field.select(); } catch (e) { /* ok */ } } }

/* ---------- профиль / вход / выход ---------- */
/* строка профиля: <ID>_<язык>_<тема>_<вид>_<пояс>_<анимации>, например 1073819_ru_dark_grid_utc7_anim1 */
function profile(u) {
  const St = g.Store, view = (g.AppShell && g.AppShell.view && g.AppShell.view()) || 'grid';
  return [u.id, St.get('lang'), St.get('theme'), view, St.get('tz'), St.get('anim') ? 'anim1' : 'anim0'].join('_');
}
function mark(u) { B.dataset.role = u.role; B.dataset.uid = u.id; qa('[data-perm=admin]').forEach(b => { b.hidden = u.role !== 'admin'; }); }
function grant(user, via) {
  if (S.user || S.busy || !user) return; S.busy = true;
  if (g.QRJury) g.QRJury.toggle(false); closeRcv(true); closePop();
  $('loginBtn').disabled = true; $('grantMsg').textContent = T('auth.grant', { cfg: profile(user) }); $('grant').hidden = false;
  setTimeout(() => {
    S.user = user; S.t0 = Date.now(); S.busy = false; mark(user);
    B.classList.add('entering'); B.classList.remove('locked'); $('grant').hidden = true; $('loginBtn').disabled = false; $('loginPass').value = ''; authMsg('');
    setTimeout(() => B.classList.remove('entering'), 700);
    emit('abai:auth', { type: 'login', user, via: via || 'password', ts: Date.now() });
  }, 1400);
}
function logout() {
  const prev = S.user; if (!prev) return; S.user = null; delete B.dataset.role; delete B.dataset.uid;
  B.classList.add('locked'); $('loginPass').value = ''; $('loginPass').type = 'password'; $('eyeBtn').setAttribute('aria-pressed', 'false'); authMsg('');
  const c = $('card'); c.classList.remove('shake', 'err'); c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
  if (g.QRJury) g.QRJury.toggle(false); closeRcv(true); closePop();
  emit('abai:auth', { type: 'logout', user: prev, ts: Date.now() });
  if (!coarse()) $('loginUser').focus();
}
$('loginForm').addEventListener('submit', e => {
  e.preventDefault(); if (S.busy) return;
  const u = $('loginUser').value.trim(), p = $('loginPass').value;
  if (u && !p) { $('loginPass').focus(); return; }                                                   // Enter в логине → к паролю
  const r = DB().authenticate(u, p);
  if (r.ok) return grant(r.user, 'password');
  if (r.reason === 'NO_USER') fail(T('auth.err.nouser'), $('loginUser'));
  else if (r.reason === 'BAD_PASS') { $('loginPass').value = ''; fail(T('auth.err.badpass'), $('loginPass')); }
  else fail(T('auth.err.empty'), u ? $('loginPass') : $('loginUser'));
});
['loginUser', 'loginPass'].forEach(id => $(id).addEventListener('input', () => { const m = $('authMsg'); if (!m.hidden && m.classList.contains('err')) authMsg(''); }));
$('loginPass').addEventListener('keyup', e => { const on = e.getModifierState && e.getModifierState('CapsLock'); const m = $('authMsg'); if (on) authMsg(T('auth.caps'), 'info'); else if (m.classList.contains('info')) authMsg(''); });
$('eyeBtn').addEventListener('click', () => { const i = $('loginPass'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('eyeBtn').setAttribute('aria-pressed', show); i.focus(); });

/* ---------- меню [?] ---------- */
const pop = $('acctPop'), hb = $('helpBtn');
function closePop(focus) { if (pop.hidden) return; pop.hidden = true; hb.setAttribute('aria-expanded', 'false'); if (focus) hb.focus(); }
function openPop() { pop.hidden = false; hb.setAttribute('aria-expanded', 'true'); const f = qa('.acct', pop)[0]; if (f && !coarse()) f.focus(); }
hb.addEventListener('click', e => { e.stopPropagation(); pop.hidden ? openPop() : closePop(); });
pop.addEventListener('click', e => {
  const a = e.target.closest('.acct'); if (!a) return;
  $('loginUser').value = a.dataset.u; $('loginPass').value = a.dataset.p; authMsg(''); closePop(); $('loginBtn').focus();
});
pop.addEventListener('keydown', e => {
  const items = qa('.acct', pop), i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
});
document.addEventListener('click', e => { if (!pop.hidden && !pop.contains(e.target) && e.target !== hb) closePop(); });

/* ---------- восстановление пароля ---------- */
const rcv = $('rcvModal');
function trap(e, root) {
  if (e.key !== 'Tab') return; const f = qa('button:not([disabled]),input,a[href]', root).filter(x => x.offsetParent !== null); if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
}
function rcvMsg(text, kind) { const m = $('rcvMsg'); m.textContent = text || ''; m.className = 'msg ' + (kind || 'err'); m.hidden = !text; }
function stopRcvTimer() { clearInterval(S.rcvTimer); S.rcvTimer = 0; }
function openRcv() {
  closePop(); if (g.QRJury) g.QRJury.toggle(false);
  const hit = DB().find($('loginUser').value); $('rcvUser').value = hit ? hit.login : $('loginUser').value.trim();
  rcvMsg(''); $('rcvLimit').hidden = true; $('rcvSent').hidden = true; stopRcvTimer(); $('rcvSend').disabled = false;
  rcv.hidden = false; if ('inert' in $('stage')) $('stage').inert = true; setTimeout(() => $('rcvUser').focus(), 40);
}
function closeRcv(silent) { if (rcv.hidden) return; rcv.hidden = true; stopRcvTimer(); if ('inert' in $('stage')) $('stage').inert = false; if (!silent) $('rcvLink').focus(); }
function showLimit(r) {
  $('rcvLimit').hidden = false; S.rcvNext = r.nextAt; S.rcvFio = r.fio; const span = $('rcvLimit').querySelector('span');
  span.textContent = T('rcv.limit', { fio: r.fio });
  const upd = () => {
    const left = Math.max(0, S.rcvNext - Date.now()); $('rcvTimer').textContent = DB().formatClock(left); $('rcvBar').style.transform = 'scaleX(' + (left / DB().RESET_LIMIT_MS).toFixed(5) + ')';
    if (left <= 0) { stopRcvTimer(); $('rcvLimit').hidden = true; rcvMsg(T('rcv.unlocked'), 'ok'); }
  };
  stopRcvTimer(); upd(); S.rcvTimer = setInterval(upd, 1000);
}
function showSent(r) {
  rcvMsg(''); $('sentTo').textContent = r.to; $('sentSubj').textContent = r.subject; $('sentBody').textContent = r.body; $('sentMailto').href = r.mailto;     // письмо администратору предприятия остаётся на русском
  $('rcvReq').textContent = T('rcv.req', { id: r.request.id }); $('rcvSent').hidden = false; $('rcvLimit').hidden = true; stopRcvTimer();
}
$('rcvLink').addEventListener('click', openRcv);
$('rcvClose').addEventListener('click', () => closeRcv()); $('rcvBack').addEventListener('click', () => closeRcv());
rcv.addEventListener('mousedown', e => { if (e.target === rcv) closeRcv(); });
rcv.addEventListener('keydown', e => trap(e, rcv));
$('rcvForm').addEventListener('submit', e => {
  e.preventDefault(); const q = $('rcvUser').value.trim();
  if (!q) { rcvMsg(T('rcv.err.empty'), 'err'); $('rcvUser').focus(); return; }
  const r = DB().requestReset(q);
  if (r.ok) return showSent(r);
  if (r.reason === 'LIMIT') { rcvMsg(''); return showLimit(r); }
  $('rcvLimit').hidden = true; rcvMsg(T('auth.err.nouser'), 'err'); const m = rcv.querySelector('.modal'); m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake'); setTimeout(() => m.classList.remove('shake'), 700);
});
$('sentCopy').addEventListener('click', () => {
  const txt = T('rcv.to') + ': ' + $('sentTo').textContent + '\n' + T('rcv.subj') + ': ' + $('sentSubj').textContent + '\n\n' + $('sentBody').textContent, b = $('sentCopy').querySelector('span');
  const done = ok => { const o = b.textContent; b.textContent = T(ok ? 'rcv.copied' : 'rcv.copyfail'); setTimeout(() => { b.textContent = o; }, 1400); };
  try { navigator.clipboard.writeText(txt).then(() => done(true), () => done(false)); } catch (e) { done(false); }
});
document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (!rcv.hidden) closeRcv(); else closePop(true); });

/* ---------- вход жюри и личный вход с телефона (qr-jury.js) ---------- */
g.addEventListener('abai:jury-ok', e => grant(DB().juryUser(), 'jury-' + ((e.detail && e.detail.via) || 'test')));
g.addEventListener('abai:session-ok', e => { const d = e.detail || {}; if (d.user) grant(d.user, 'session-' + (d.via || 'code')); });
g.addEventListener('abai:jury-fail', () => shake());
g.addEventListener('abai:lang', () => { const m = $('authMsg'); if (m && !m.hidden && m.classList.contains('info')) authMsg(T('auth.caps'), 'info'); if (S.rcvTimer && !$('rcvLimit').hidden && S.rcvFio) $('rcvLimit').querySelector('span').textContent = T('rcv.limit', { fio: S.rcvFio }); });

/* ---------- публичное API ---------- */
g.AuthApp = { user: () => S.user, isAuthed: () => !!S.user, since: () => S.t0, logout, login: grant, shake, profile, clock };

/* ---------- старт ---------- */
function start() {
  if (!coarse()) $('loginUser').focus();
  const r = g.QRJury && g.QRJury.consumeUrlAuth();
  if (r && !r.bad) grant(r.user || DB().juryUser(), (r.personal ? 'session-' : 'jury-') + 'link');
  else if (r && r.bad) { authMsg(T(r.personal ? 'auth.link.bad2' : 'auth.link.bad'), 'err'); if (g.QRJury) setTimeout(() => { g.QRJury.toggle(true); g.QRJury.setTab('phone'); }, 600); }
}
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})(window);
