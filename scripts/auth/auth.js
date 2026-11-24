/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/auth/auth.js  (UI-контроллер экрана входа #auth)
   Часы UTC+7, переключатель 6 языков, меню [?] с автоподстановкой (ТОЛЬКО DEMO_MODE, собирается из demo-data.js и в боевом режиме в DOM не существует),
   глазок, вход / выход, встряска при ошибке, «Доступ разрешён», восстановление пароля (1 запрос / 24 ч на аккаунт, точный таймер),
   вход по QR / коду с телефона (abai:session-ok от qr-jury.js).

   ЭТАП 3 — ZERO TRUST:
   • Вход = «сервер» (UsersDB) проверяет пароль (PBKDF2) и выдаёт подписанный токен; Store.session.start(токен) создаёт иммутабельную сессию в памяти.
     Права (CAN_*) читаются только из неё. Пароль после проверки стирается из поля.
   • Сессия переживает F5 (токен в sessionStorage, проверяется подписью и сроком) и исчезает при закрытии вкладки.
   • «Выйти» → Store.session.end(): стираются токен, все ключи abai.s.*, все зарегистрированные таймеры; затем экран входа.
   • Срок сессии истёк или обнаружена подмена токена → принудительный выход с пояснением.
   • Баг дрожи: окно входа больше не «гаснет» при неверном пароле: встряска идёт через Web Animations API и не трогает CSS-анимацию появления .card
     (раньше при снятии класса .shake заново проигрывался cardIn с opacity:0 — окно уходило в темноту).
   События (window): abai:auth {type:'login'|'logout', user, via, ts, restored?}; via: password | jury-test | jury-code | jury-scan | jury-link | session-code | session-scan | session-link | restore.
   Слушает abai:session-ok, abai:session, abai:lang, abai:pwdrequest / abai:pwdresolved. Публичное API: window.AuthApp. */
(function (g) {
'use strict';
const $ = id => document.getElementById(id), qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s)), B = document.body, H = document.documentElement;
const DB = () => g.UsersDB, ST = () => g.Store, T = (k, p) => g.I18N.t(k, p), pad = n => String(n).padStart(2, '0');
const DEMO = !!(g.ABAI_CONFIG && g.ABAI_CONFIG.DEMO_MODE === true);
const S = { user: null, t0: 0, busy: false, rcvTimer: 0, rcvNext: 0, via: '', lockTimer: 0 };
const emit = (name, detail) => g.dispatchEvent(new CustomEvent(name, { detail }));
const coarse = () => g.matchMedia('(pointer:coarse)').matches;
const reduced = () => B.classList.contains('no-animations') || g.matchMedia('(prefers-reduced-motion:reduce)').matches;

/* ---------- часы экрана входа (внутренние часы #app ведёт app-shell.js) ---------- */
const clock = off => { const d = new Date(Date.now() + off * 36e5); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()); };
function tick() { const a = $('authClock'); if (a) { const st = ST(); a.textContent = st ? st.tzLabel() + ' ' + st.fmtClock() : 'UTC+7 ' + clock(7); a.setAttribute('datetime', new Date().toISOString()); } }
(function loop() { tick(); setTimeout(loop, 1000 - Date.now() % 1000 + 5); })();                     // тик ровно на границе секунды

/* ---------- переключатель языка (6 языков, мгновенно, без перезагрузки) ---------- */
function renderLang() { const cur = g.I18N.get(); qa('#authLang [data-lang]').forEach(b => { const on = b.dataset.lang === cur; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('on', on); }); }
/* «Полярная ночь 24/7»: тумблер в верхней полосе экрана входа дублирует настройку из #app (Store.settings.polar); фон реагирует на abai:settings */
function initPolar() {
  const b = $('authPolar'); if (!b) return;
  const sync = () => b.setAttribute('aria-pressed', ST().get('polar') === true ? 'true' : 'false');
  b.addEventListener('click', () => ST().set('polar', !ST().get('polar')));
  g.addEventListener('abai:settings', e => { if (e.detail && e.detail.key === 'polar') sync(); }); sync();
}
function initLang() { qa('#authLang [data-lang]').forEach(b => b.addEventListener('click', () => ST().set('lang', b.dataset.lang))); renderLang(); }

/* ---------- ошибки / встряска ---------- */
const SHAKE = [{ transform: 'translateX(0)' }, { transform: 'translateX(-14px) rotate(-.5deg)', offset: .1 }, { transform: 'translateX(11px) rotate(.4deg)', offset: .22 }, { transform: 'translateX(-8px)', offset: .34 },
  { transform: 'translateX(5px)', offset: .46 }, { transform: 'translateX(-3px)', offset: .58 }, { transform: 'translateX(1px)', offset: .72 }, { transform: 'translateX(0)' }];
function shake() {
  const c = $('card'); if (!c) return;
  c.classList.add('shake', 'err');                                                                   // классы — только маркеры состояния: анимации на них нет
  if (c.animate && !reduced()) c.animate(SHAKE, { duration: 620, easing: 'cubic-bezier(.36,.07,.19,.97)' });
  clearTimeout(shake.t1); clearTimeout(shake.t2); shake.t1 = setTimeout(() => c.classList.remove('shake'), 700); shake.t2 = setTimeout(() => c.classList.remove('err'), 1500);
  if (g.FrostCanvas) g.FrostCanvas.pulse(1);
}
function authMsg(text, kind) { const m = $('authMsg'); m.textContent = text || ''; m.className = 'msg ' + (kind || 'err'); m.hidden = !text; }
function fail(text, field) { authMsg(text, 'err'); shake(); if (field) { field.focus(); try { field.select(); } catch (e) { /* ok */ } } }
function showLock(ms) {                                                                              // блокировка подбора: живой отсчёт
  clearInterval(S.lockTimer); const until = Date.now() + ms;
  const upd = () => { const left = until - Date.now(); if (left <= 0) { clearInterval(S.lockTimer); const m = $('authMsg'); if (m.dataset.lock) { delete m.dataset.lock; authMsg(''); } return; } authMsg(T('auth.err.locked', { s: Math.ceil(left / 1000) }), 'err'); $('authMsg').dataset.lock = '1'; };
  upd(); S.lockTimer = setInterval(upd, 500);
}

/* ---------- профиль / вход / выход ---------- */
/* строка профиля: <ID>_<язык>_<тема>_<вид>_<пояс>_<анимации>, например 1073819_ru_dark_grid_utc7_anim1 */
function profile(u) {
  const St = g.Store, view = (g.AppShell && g.AppShell.view && g.AppShell.view()) || 'grid';
  return [u.id, St.get('lang'), St.get('theme'), view, St.get('tz'), St.get('anim') ? 'anim1' : 'anim0'].join('_');
}
function mark(u) { B.dataset.role = u.role; B.dataset.uid = u.id; qa('[data-perm=admin]').forEach(b => { b.hidden = u.role !== 'admin'; }); }
const VIA = { password: 'password', qr: 'session-link', code: 'session-code', 'qr-jury': 'jury-link', 'code-jury': 'jury-code', 'test-jury': 'jury-test' };
function enter(view, via, restored) {
  const user = view.user; S.user = user; S.t0 = view.iat; S.via = via; S.busy = false; mark(user);
  B.classList.remove('locked'); H.classList.remove('restoring'); $('grant').hidden = true; $('loginBtn').disabled = false; $('loginPass').value = ''; authMsg('');
  if (!restored) { B.classList.add('entering'); setTimeout(() => B.classList.remove('entering'), 700); }
  emit('abai:auth', { type: 'login', user, via, ts: Date.now(), restored: !!restored });
}
/* res — ответ «сервера»: {ok, user, token}. restored=true: тихое восстановление после F5 (без анимации и без записи «вход» в журнал) */
function grant(res, via) {
  if (S.user || S.busy || !res || !res.token) return false;
  const view = ST().session.start(res.token);
  if (!view) { fail(T('auth.sess.tamper')); return false; }
  S.busy = true;
  if (g.QRJury) g.QRJury.toggle(false); closeRcv(true); closePop();
  $('loginBtn').disabled = true; $('grantMsg').textContent = T('auth.grant', { cfg: profile(view.user) }); $('grant').hidden = false;
  setTimeout(() => { if (!ST().session.active()) { S.busy = false; $('grant').hidden = true; $('loginBtn').disabled = false; return; } enter(view, via || 'password', false); }, 1400);
  return true;
}
function logout(reason) {
  const prev = S.user; if (!prev) return;
  S.user = null; S.via = ''; S.t0 = 0; clearInterval(S.lockTimer);
  ST().session.end(reason || 'logout');                                                              // токен, ключи abai.s.*, ВСЕ таймеры сессии — до смены экрана
  delete B.dataset.role; delete B.dataset.uid;
  B.classList.add('locked'); H.classList.remove('restoring'); $('loginPass').value = ''; $('loginPass').type = 'password'; $('eyeBtn').setAttribute('aria-pressed', 'false'); authMsg('');
  const c = $('card'); c.classList.remove('shake', 'err'); c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
  if (g.QRJury) g.QRJury.toggle(false); closeRcv(true); closePop();
  emit('abai:auth', { type: 'logout', user: prev, reason: reason || 'logout', ts: Date.now() });
  if (reason === 'expired') authMsg(T('auth.sess.expired'), 'info'); else if (reason === 'tamper') authMsg(T('auth.sess.tamper'), 'err');
  if (!coarse()) $('loginUser').focus();
}
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); if (S.busy) return;
  const u = $('loginUser').value.trim(), p = $('loginPass').value;
  if (u && !p) { $('loginPass').focus(); return; }                                                   // Enter в логине → к паролю
  S.busy = true; $('loginBtn').disabled = true; $('loginBtn').classList.add('busy');
  let r; try { r = await DB().authenticate(u, p); } catch (err) { r = { ok: false, reason: 'ERROR' }; }
  S.busy = false; $('loginBtn').disabled = false; $('loginBtn').classList.remove('busy');
  $('loginPass').value = '';                                                                          // пароль не остаётся в DOM ни при успехе, ни при ошибке
  if (r.ok) return grant(r, 'password');
  if (r.reason === 'LOCKED') { shake(); return showLock(r.retryMs); }
  if (r.reason === 'NO_USER' || r.reason === 'BAD_PASS') return fail(T('auth.err.cred'), $('loginPass'));   // одно нейтральное сообщение: логины не перебираются
  if (r.reason === 'ERROR') return fail(T('auth.err.fail'), null);
  fail(T('auth.err.empty'), u ? $('loginPass') : $('loginUser'));
});
['loginUser', 'loginPass'].forEach(id => $(id).addEventListener('input', () => { const m = $('authMsg'); if (!m.hidden && m.classList.contains('err') && !m.dataset.lock) authMsg(''); }));
$('loginPass').addEventListener('keyup', e => { const on = e.getModifierState && e.getModifierState('CapsLock'); const m = $('authMsg'); if (on) authMsg(T('auth.caps'), 'info'); else if (m.classList.contains('info')) authMsg(''); });
$('eyeBtn').addEventListener('click', () => { const i = $('loginPass'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('eyeBtn').setAttribute('aria-pressed', show); i.focus(); });

/* ---------- меню [?]: только DEMO_MODE; в боевом режиме элементов в DOM нет вообще ---------- */
let pop = null, hb = null;
function closePop(focus) { if (!pop || pop.hidden) return; pop.hidden = true; hb.setAttribute('aria-expanded', 'false'); if (focus) hb.focus(); }
function openPop() { pop.hidden = false; hb.setAttribute('aria-expanded', 'true'); const f = qa('.acct', pop)[0]; if (f && !coarse()) f.focus(); }
function buildDemo() {
  const A = g.ABAI_DEMO; if (!DEMO || !A || !A.accounts) return;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  hb = document.createElement('button'); hb.type = 'button'; hb.className = 'help'; hb.id = 'helpBtn'; hb.textContent = '?';
  hb.setAttribute('aria-haspopup', 'menu'); hb.setAttribute('aria-expanded', 'false'); hb.setAttribute('aria-controls', 'acctPop'); hb.setAttribute('data-i18n-title', 'auth.help'); hb.setAttribute('data-i18n-aria', 'auth.help');
  pop = document.createElement('div'); pop.className = 'pop'; pop.id = 'acctPop'; pop.setAttribute('role', 'menu'); pop.setAttribute('data-i18n-aria', 'auth.help'); pop.hidden = true;
  pop.innerHTML = '<div class="pop-h"><span data-i18n="auth.pop.h1">Тестовые аккаунты</span><span data-i18n="auth.pop.h2">клик = автоподстановка</span></div>' + A.accounts.map(a =>
    '<button type="button" class="acct" role="menuitem" data-u="' + esc(a.login) + '" data-p="' + esc(a.pass) + '"><b><span data-i18n="role.' + a.role + '"></span><small>' + esc(a.badge) + '</small></b><span>' + esc(a.login) + ' · ' + esc(a.id) + ' · ' +
    (a.role === 'jury' ? '<span data-i18n="name.jury"></span>' : esc(a.fio)) + '</span><i>' + esc(a.pass) + '</i></button>').join('');
  const card = $('card'); card.appendChild(hb); card.appendChild(pop);
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
  g.I18N.apply(card);
}
function initMode() {
  buildDemo();
  const qb = $('qrBtn'); if (qb) { const k = DEMO ? 'auth.qr' : 'auth.qr2', t = DEMO ? 'auth.qr.t' : 'auth.qr2.t'; qb.querySelector('span').setAttribute('data-i18n', k); qb.setAttribute('data-i18n-title', t); }
  B.dataset.mode = DEMO ? 'demo' : 'prod';
  g.I18N.apply($('card'));
}

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
  $('rcvLimit').hidden = true; rcvMsg(T('auth.err.nouser'), 'err'); const m = rcv.querySelector('.modal'); if (m.animate && !reduced()) m.animate(SHAKE, { duration: 620, easing: 'cubic-bezier(.36,.07,.19,.97)' });
});
$('sentCopy').addEventListener('click', () => {
  const txt = T('rcv.to') + ': ' + $('sentTo').textContent + '\n' + T('rcv.subj') + ': ' + $('sentSubj').textContent + '\n\n' + $('sentBody').textContent, b = $('sentCopy').querySelector('span');
  const done = ok => { const o = b.textContent; b.textContent = T(ok ? 'rcv.copied' : 'rcv.copyfail'); setTimeout(() => { b.textContent = o; }, 1400); };
  try { navigator.clipboard.writeText(txt).then(() => done(true), () => done(false)); } catch (e) { done(false); }
});
document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (!rcv.hidden) closeRcv(); else closePop(true); });

/* ---------- вход по QR / коду с телефона (qr-jury.js) и события сессии ---------- */
g.addEventListener('abai:session-ok', e => { const d = e.detail || {}; if (d.user && d.token) grant({ user: d.user, token: d.token }, (d.kind === 'jury' ? 'jury-' : 'session-') + (d.via || 'code')); });
g.addEventListener('abai:jury-fail', () => shake());
g.addEventListener('abai:session', e => { const d = e.detail || {}; if (d.state === 'end' && S.user && d.reason !== 'logout') logout(d.reason); });
g.addEventListener('abai:lang', () => {
  renderLang(); const m = $('authMsg'); if (m && !m.hidden && m.classList.contains('info') && !S.user) authMsg(T('auth.caps'), 'info');
  if (S.rcvTimer && !$('rcvLimit').hidden && S.rcvFio) $('rcvLimit').querySelector('span').textContent = T('rcv.limit', { fio: S.rcvFio });
});

/* ---------- публичное API ---------- */
g.AuthApp = Object.freeze({ user: () => S.user, isAuthed: () => !!S.user, since: () => S.t0, via: () => S.via, logout, login: grant, shake, profile, clock, demo: DEMO });

/* ---------- старт ---------- */
const LINK_ERR = { LEGACY: 'auth.link.legacy', EXPIRED: 'auth.link.expired', NOT_YET: 'auth.link.expired', USED: 'auth.link.used', DISABLED: 'auth.link.disabled' };
function start() {
  initMode(); initLang(); initPolar();
  const r = g.QRJury && g.QRJury.consumeUrlAuth();                                                    // токен из #-части читается и сразу стирается из адресной строки
  if (r && !r.bad) { H.classList.remove('restoring'); if (!coarse()) $('loginUser').focus(); grant(r, (r.kind === 'jury' ? 'jury-' : 'session-') + 'link'); return; }
  const v = !r && ST().session.restore();                                                             // F5: проверенный токен из sessionStorage → тихий вход
  if (v) { enter(v, VIA[v.via] || 'password', true); return; }
  H.classList.remove('restoring');
  if (!coarse()) $('loginUser').focus();
  const rej = !r && ST().session.rejected();                                                          // токен в sessionStorage был, но подделан / просрочен: объясняем, почему экран входа
  if (rej) authMsg(T(rej === 'expired' ? 'auth.sess.expired' : 'auth.sess.tamper'), rej === 'expired' ? 'info' : 'err');
  if (r && r.bad) { authMsg(T(LINK_ERR[r.reason] || 'auth.link.bad'), 'err'); if (g.QRJury) setTimeout(() => { g.QRJury.toggle(true); g.QRJury.setTab('phone'); }, 600); }
}
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})(window);
