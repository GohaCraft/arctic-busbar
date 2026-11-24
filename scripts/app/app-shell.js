/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/app/app-shell.js  (каркас #app)
   • Переключение видов (Ribbon / Bottom Dock / клавиши 1–4), заголовок раздела, старт и остановка графа только на виде «Граф».
   • Менеджер окон (профиль, настройки, калибровка, плагин, отчёт): плавное открытие, фокус-ловушка, Esc, клик по фону, возврат фокуса.
   • Тосты, живые часы (пояс из Store), меню «Испытания стенда» (ТОЛЬКО DEMO_MODE: иначе кнопки и меню удалены из DOM), отчёт для Claude со stack trace и 5 последними пакетами телеметрии.
   • ПРОФИЛЬ (#mProfile): карточка сотрудника, таймеры сессии (прошло / до автовыхода), «Подключить телефон»: личный QR + 6-значный PIN выпускаются ПО НАЖАТИЮ на 90 с
     (UsersDB.qr.issue с токеном сессии; токен в #-части ссылки, одноразовый, можно отозвать), матрица прав RBAC (переключатели → UsersDB.setPerm с Bearer + журнал),
     заявки на сброс пароля (одобрить → временный пароль / отклонить).
   • НАСТРОЙКИ (#mSettings, одно окно в стиле Obsidian Settings): тема, фон (волны / сияние / изолинии / градиент), «Полярная ночь 24/7», акцент, язык (6 языков без перезагрузки),
     часовой пояс, анимации, частота телеметрии, FPS графа, оборудование, экспорт / восстановление бэкапа .json, сброс демо-данных (только DEMO_MODE).
   ЭТАП 3: пользователь, роль и права — только Store.session (иммутабельный объект в памяти); все таймеры сессии регистрируются через Store.session.interval и гасятся при выходе.
   API: window.AppShell = { show, view, openWnd, closeWnd, closeAll, toast, inspect, open, openProfile, openSettings, refreshAccess, renderRequests, renderRbac, copy, state } */
(function (g) {
'use strict';
const D = document, B = D.body, $ = id => D.getElementById(id), qa = (s, r) => Array.prototype.slice.call((r || D).querySelectorAll(s));
const T = (k, p) => g.I18N.t(k, p), ST = () => g.Store, DB = () => g.UsersDB, PN = () => g.PINN, SU = () => g.ScadaUI;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (n, c) => '<svg class="ico' + (c ? ' ' + c : '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>';
const pad = n => String(n).padStart(2, '0');
const DEMO = !!(g.ABAI_CONFIG && g.ABAI_CONFIG.DEMO_MODE === true);
const me = () => ST().session.user;                                              // замороженный объект сессии: ни роль, ни права из localStorage не читаются
const isAdmin = () => ST().session.isAdmin();
const bearer = () => ST().session.bearer();
const fioOf = u => (u && u.role === 'jury' ? T('name.jury') : (u && u.fio) || '—');
/* инициалы аватара: в интерфейсе на латинице (EN/ZH) кириллические инициалы переводятся в латиницу по первой букве; само ФИО — данные учётной записи и не меняется */
const TR = { 'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'E', 'Ж': 'Z', 'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'K', 'Ц': 'T', 'Ч': 'C', 'Ш': 'S', 'Щ': 'S', 'Ы': 'Y', 'Э': 'E', 'Ю': 'Y', 'Я': 'Y' };
const latinUi = () => { const l = g.I18N.get(); return l === 'en' || l === 'zh'; };
const initials = u => fioOf(u).split(/[\s.]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase().replace(/[А-ЯЁ]/g, c => (latinUi() ? TR[c] : c) || c) || '—';
const VIEWS = ['grid', 'graph', 'audit', 'plugins'];
const S = { view: 'grid', via: '', stack: [], menu: false, tmp: {}, lastErr: null, ph: null, phT: 0, phKey: '' };

/* ======================= буфер обмена ======================= */
function copy(text, label) {
  const done = ok => toast(ok ? 'ok' : 'err', T(ok ? 'common.copied' : 'common.copyfail'), label || '');
  const fallback = () => { try { const ta = D.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0'; D.body.appendChild(ta); ta.select(); const ok = D.execCommand('copy'); ta.remove(); done(ok); } catch (e) { done(false); } };
  try { if (g.navigator.clipboard && g.isSecureContext) g.navigator.clipboard.writeText(text).then(() => done(true), fallback); else fallback(); } catch (e) { fallback(); }
}

/* ======================= тосты ======================= */
function toast(kind, title, msg) {
  const box = $('toasts'); if (!box) return null; kind = kind || 'info';
  const dup = qa('.toast', box).find(t => t.dataset.t === title + '|' + (msg || '')); if (dup) { clearTimeout(dup._t); dup._t = setTimeout(() => dismiss(dup), 4500); return dup; }
  const el = D.createElement('div'); el.className = 'toast float'; el.dataset.k = kind; el.dataset.t = title + '|' + (msg || ''); el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  el.innerHTML = ico(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'warn') + '<b>' + esc(title) + '</b><button type="button" class="x" aria-label="' + esc(T('common.close')) + '">' + ico('x') + '</button>' + (msg ? '<span>' + esc(msg) + '</span>' : '');
  box.appendChild(el); for (let live = qa('.toast', box).filter(t => !t._gone); live.length > 4; live.shift()) dismiss(live[0], true);   /* не больше 4 живых тостов; цикл конечен: каждый проход помечает один тост */
  el.querySelector('.x').addEventListener('click', () => dismiss(el)); el._t = setTimeout(() => dismiss(el), kind === 'err' ? 8000 : 4500); return el;
}
function dismiss(el, now) { if (!el || el._gone) return; el._gone = true; clearTimeout(el._t); el.dataset.out = '1'; if (now) el.remove(); else setTimeout(() => el.remove(), 240); }

/* ======================= окна ======================= */
const BASE = ['ribbon', 'top', 'main', 'mdock'];
function setInert(on) { BASE.forEach(id => { const el = $(id); if (el) { if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert'); } }); }
const focusable = root => qa('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])', root).filter(x => x.offsetParent !== null);
function openWnd(id, focusEl) {
  const w = $(id); if (!w) return; if (S.stack.indexOf(id) >= 0 && w.dataset.open === '1') return;
  closeMenu(); clearTimeout(w._c); w._ret = D.activeElement; w.hidden = false; S.stack = S.stack.filter(x => x !== id); S.stack.push(id); setInert(true);
  requestAnimationFrame(() => requestAnimationFrame(() => { w.dataset.open = '1'; }));
  setTimeout(() => { const f = focusEl || w.querySelector('.wnd-tab.on, .st-nav .on') || focusable(w)[0]; if (f && f.focus && !g.matchMedia('(pointer:coarse)').matches) f.focus({ preventScroll: true }); }, 60);
}
function closeWnd(id, instant) {
  const w = $(id); if (!w || w.hidden) return; S.stack = S.stack.filter(x => x !== id); delete w.dataset.open;
  const fin = () => { if (w.dataset.open !== '1') w.hidden = true; if (!S.stack.length) setInert(false); const r = w._ret; w._ret = null; if (!instant && r && r.focus && D.contains(r) && !B.classList.contains('locked')) { try { r.focus({ preventScroll: true }); } catch (e) { /* ok */ } } };
  if (instant) { fin(); return; } clearTimeout(w._c); w._c = setTimeout(fin, 230);
  if (id === 'mProfile') revokePhone(true);                                 // закрыли профиль — личный код отзывается и стирается с экрана
}
function closeAll(instant) { S.stack.slice().forEach(id => closeWnd(id, instant)); }
function topWnd() { return S.stack[S.stack.length - 1] || null; }
D.addEventListener('mousedown', e => { const w = e.target.classList && e.target.classList.contains('wnd-wrap') ? e.target : null; if (w) closeWnd(w.id); });
D.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) { const w = c.closest('.wnd-wrap'); if (w) closeWnd(w.id); } });
D.addEventListener('keydown', e => {
  if (e.key === 'Tab') { const id = topWnd(); const w = id && $(id); if (!w) return; const f = focusable(w); if (!f.length) return; if (e.shiftKey && D.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && D.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); } return; }
  if (B.classList.contains('locked')) return;
  if (e.key === 'Escape') { if (S.menu) return closeMenu(true); const id = topWnd(); if (id) return closeWnd(id); if (SU().inspectorTarget()) SU().closeInspector(); return; }
  const t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable); if (typing || e.ctrlKey || e.metaKey || e.altKey || S.stack.length) return;
  const n = '1234'.indexOf(e.key); if (n >= 0) { show(VIEWS[n]); return; }
  if (e.key === ',') openSettings(); else if (e.key === 'p' || e.key === 'P') openProfile('id');
});

/* ======================= виды ======================= */
function show(v) {
  if (v === 'rbac') return openProfile('req');
  if (VIEWS.indexOf(v) < 0) return;
  const was = S.view; S.view = v; const app = $('app'); app.dataset.view = v;
  VIEWS.forEach(n => { const el = $('view-' + n); if (el) { const on = n === v; el.classList.toggle('on', on); } });
  qa('#rbNav .rb-btn').forEach(b => { const on = b.dataset.view === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  qa('#mdock .md-btn[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  const t = $('secTitle'); t.setAttribute('data-i18n', 'nav.' + v); t.textContent = T('nav.' + v);
  if (was !== v && SU().inspectorTarget()) SU().closeInspector();
  SU().setView(v); $('main').scrollTop = 0;
  if (g.ObsidianGraph) { if (v === 'graph') requestAnimationFrame(() => requestAnimationFrame(() => { g.ObsidianGraph.start(); g.ObsidianGraph.resize(); })); else g.ObsidianGraph.stop(); }
  updateCfg();
}
D.addEventListener('click', e => {
  const nv = e.target.closest('#rbNav [data-view], #mdock [data-view]'); if (nv) return show(nv.dataset.view);
  const op = e.target.closest('button[data-open]'); if (op) { const k = op.dataset.open; if (k === 'profile') openProfile('id'); else if (k === 'settings') openSettings(); return; }
  if (e.target.closest('[data-act="crash"]')) openCrash();
});
/* клик вне инспектора закрывает его */
D.addEventListener('pointerdown', e => {
  if (!SU().inspectorTarget()) return; if (e.target.closest('#insp, .sc, #graphCanvas, .wnd-wrap, #demoMenu, .toast, #btnDemo, #btnDemoM')) return;
  if (e.target.closest('#app')) SU().closeInspector();
});

/* ======================= часы, сессия ======================= */
function paintClock() { const c = $('tClock'); if (c) { const s = ST().fmtClock(); if (c.textContent !== s) c.textContent = s; const z = $('tzLabel'); if (z) z.textContent = ST().tzLabel(); } }
const fmtHMS = ms => { const t = Math.max(0, Math.floor(ms / 1e3)); return pad(Math.floor(t / 3600)) + ':' + pad(Math.floor(t / 60) % 60) + ':' + pad(t % 60); };
function sessionTimes() {
  const e = $('empSess'), l = $('empLeft'), se = ST().session; if (!e || !se.active()) return;
  const a = fmtHMS(se.age()), b = fmtHMS(se.expiresIn()); if (e.textContent !== a) e.textContent = a; if (l && l.textContent !== b) l.textContent = b;
}
/* единственный таймер интерфейса: часы + таймеры сессии. Регистрируется в Store.session и гасится при выходе (ни один таймер не переживает сессию) */
function startClock() { paintClock(); sessionTimes(); ST().session.interval(() => { paintClock(); sessionTimes(); }, 250); }

/* ======================= меню «Испытания стенда» ======================= */
function openMenu(btn) { const m = $('demoMenu'); m.hidden = false; S.menu = true; qa('#btnDemo, #btnDemoM').forEach(b => b.setAttribute('aria-expanded', 'true')); syncDemo(); const f = m.querySelector('.dm-item'); if (f && !g.matchMedia('(pointer:coarse)').matches) f.focus({ preventScroll: true }); void btn; }
function closeMenu(focus) { const m = $('demoMenu'); if (!m || m.hidden) return; m.hidden = true; S.menu = false; qa('#btnDemo, #btnDemoM').forEach(b => b.setAttribute('aria-expanded', 'false')); if (focus) { const b = g.matchMedia('(max-width:820px)').matches ? $('btnDemoM') : $('btnDemo'); if (b) b.focus(); } }
function syncDemo() { if (!$('demoMenu')) return; const sc = PN().state().scenario; qa('#demoMenu .dm-item').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === sc ? 'true' : 'false')); }
function initMenu() {
  if (!DEMO) { ['btnDemo', 'btnDemoM', 'demoMenu'].forEach(id => { const el = $(id); if (el) el.remove(); }); return; }   // боевой режим: испытаний стенда нет вообще (не скрыты, а удалены)
  qa('#btnDemo, #btnDemoM').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); S.menu ? closeMenu() : openMenu(b); }));
  $('demoMenu').addEventListener('click', e => { const it = e.target.closest('.dm-item'); if (!it) return; closeMenu(); if (!PN().scenario(it.dataset.k)) toast('warn', T('act.fail'), T('act.state')); });
  $('demoMenu').addEventListener('keydown', e => { const items = qa('.dm-item', $('demoMenu')), i = items.indexOf(D.activeElement); if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); } });
  D.addEventListener('click', e => { if (S.menu && !e.target.closest('#demoMenu, #btnDemo, #btnDemoM')) closeMenu(); });
  g.addEventListener('abai:scenario', syncDemo);
}

/* ======================= ПРОФИЛЬ ======================= */
function setAva(el, text) { if (!el) return; if (el.firstChild && el.firstChild.nodeType === 3) el.firstChild.nodeValue = text; else el.insertBefore(D.createTextNode(text), el.firstChild); }
function fillProfile() {
  const u = me(); if (!u) return;
  setAva($('empAva'), initials(u)); $('rbAva').textContent = initials(u); $('mAva').textContent = initials(u);
  $('empName').textContent = fioOf(u); $('empRole').textContent = T('role.' + u.role); $('empBadge').textContent = T('badge.' + u.role);
  $('empId').textContent = u.id; $('empLogin').textContent = u.login; $('empVia').textContent = S.via ? T('via.' + S.via) : '—'; updateCfg(); renderMyPerms(u); sessionTimes();
}
/* «Мои права доступа»: берутся из иммутабельной сессии (подписанный токен), описание права — во всплывающей подсказке */
function renderMyPerms(u) {
  const box = $('pfPerms'); if (!box || !u) return; const mine = u.perms || {};
  box.innerHTML = DB().PERMS.map(p => '<li data-perm="' + p + '" data-on="' + (mine[p] ? 1 : 0) + '" title="' + esc(T('perm.' + p)) + '">' + ico(mine[p] ? 'check' : 'lock', 'pm') + '<b>' + p + '</b><em>' + esc(T(mine[p] ? 'pf.mine.on' : 'pf.mine.off')) + '</em></li>').join('');
}
function updateCfg() { const u = me(), el = $('cfgString'); if (el && u) { const s = g.AuthApp.profile(u); if (el.textContent !== s) el.textContent = s; } }
function openProfile(tab) { if (!me()) return; fillProfile(); renderRbac(); renderRequests(); setTab('mProfile', tab || 'id'); phoneShow('idle'); openWnd('mProfile'); }
function setTab(wid, tab) {
  const w = $(wid); qa('.wnd-tab', w).forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  qa('.wnd-pane', w).forEach(p => p.classList.toggle('on', p.dataset.pane === tab));
  if (wid === 'mProfile' && tab !== 'id') revokePhone(true);                 // ушли с вкладки — личный код отзывается
}
/* ---------- «Подключить телефон»: личный QR и PIN выпускаются ПО НАЖАТИЮ и живут 90 секунд ----------
   Токен выпускает «сервер» (UsersDB.qr.issue) только по Bearer-токену текущей сессии и только для этого аккаунта; в ссылке он лежит в #-части. */
function phoneShow(mode) {                                                       // 'idle' (только кнопка) | 'live' (QR + PIN) | 'done' (код использован / отозван)
  const b = $('pfPhone'); if (!b) return;
  $('pfQrWrap').hidden = mode !== 'live'; $('pfPhoneDone').hidden = mode !== 'done'; b.hidden = mode === 'live';
}
function phoneClear() {
  qa('#pfPin b').forEach(b => { b.textContent = ''; }); $('pfUrl').textContent = ''; $('pfLink').dataset.url = ''; $('pfPin').dataset.code = ''; S.phKey = '';
  const cv = $('pfQr'); if (cv) { const x = cv.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height); }
}
function issuePhone() {
  if (!me()) return; revokePhone(true);
  const r = DB().qr.issue(bearer());
  if (!r.ok) return toast('err', T('perm.t'), T('pf.ph.fail'));
  S.ph = r; S.phKey = '';
  ST().log({ cat: 'AUTH', k: 'ev.qr.issue', node: 'QR', old: '', nw: r.ttl + ' s' });
  phoneShow('live'); paintPhone(true); S.phT = ST().session.interval(tickPhone, 200);
}
function tickPhone() {
  const r = S.ph; if (!r) return;
  if (Date.now() >= r.exp) return endPhone('expired');
  if (DB().qr.used(r.token)) return endPhone('used');
  paintPhone(false);
}
function paintPhone(force) {
  const r = S.ph, cv = $('pfQr'); if (!r || !cv) return; const left = Math.max(0, r.exp - Date.now());
  $('pfTimerBar').style.transform = 'scaleX(' + (left / (r.ttl * 1000)).toFixed(4) + ')';
  const sec = Math.ceil(left / 1000) + ' ' + T('u.s'); if ($('pfSec').textContent !== sec) $('pfSec').textContent = sec;
  const key = r.url + '|' + (cv.clientWidth || 0) + '|' + (g.devicePixelRatio || 1) + '|' + ST().get('theme');
  if (S.phKey === key && !force) return; S.phKey = key;
  qa('#pfPin b').forEach((b, i) => { const d = r.pin[i]; if (b.textContent !== d) b.textContent = d; });
  $('pfUrl').textContent = r.url.replace(/^https?:\/\//, '').slice(0, 40) + '…'; $('pfLink').dataset.url = r.url; $('pfPin').dataset.code = r.pin;
  try { if (g.QRJury && cv.clientWidth) g.QRJury.drawQR(cv, g.QRJury.encodeBest(r.url)); } catch (e) { /* ссылка не поместилась — PIN остаётся */ }
}
function endPhone(why) {                                                          // 'expired' | 'used'
  if (S.phT) { ST().session.clear(S.phT); S.phT = 0; } S.ph = null; phoneClear(); phoneShow('done');
  if (why === 'used') toast('ok', T('pf.ph.ok'), T('pf.ph.ok.d'));
}
function revokePhone(silent) {
  const r = S.ph; if (S.phT) { ST().session.clear(S.phT); S.phT = 0; }
  if (r) { try { DB().qr.revoke(bearer(), r.token); } catch (e) { /* сессия уже закрыта: токен и так умрёт по сроку */ } S.ph = null; phoneClear(); }
  if (!silent) phoneShow('done'); else if ($('pfPhone')) phoneShow('idle');
}

/* ======================= RBAC ======================= */
function renderRbac() {
  const box = $('rbMatrix'); if (!box) return; const users = DB().list(), admin = isAdmin();
  /* каждая строка — обёртка .rr: на десктопе display:contents (общая сетка), на телефоне — отдельная карточка со строками «роль → переключатель» */
  let h = '<div class="rr rh"><div class="h f">' + esc(T('rb.perm')) + '</div>' + users.map(u => '<div class="h"><span class="mini">' + esc(initials(u)) + '</span><span>' + esc(T('badge.' + u.role)) + '</span></div>').join('') + '</div>';
  DB().PERMS.forEach(p => {
    h += '<div class="rr"><div class="p"><b>' + p + '</b><span>' + esc(T('perm.' + p)) + '</span></div>' + users.map(u => {
      const who = '<span class="who"><span class="mini">' + esc(initials(u)) + '</span><span>' + esc(fioOf(u)) + ' · ' + esc(T('badge.' + u.role)) + '</span></span>';
      if (u.role === 'jury') return '<div class="c" title="' + esc(T('rb.fixed')) + '">' + who + ico('lock', 'lock') + '</div>';
      return '<div class="c">' + who + '<label class="sw"><input type="checkbox" data-rbac="' + p + '" data-uid="' + u.id + '"' + (u.perms[p] ? ' checked' : '') + (admin ? '' : ' disabled') + ' aria-label="' + p + ' · ' + esc(fioOf(u)) + '"><i></i></label></div>';
    }).join('') + '</div>';
  });
  box.innerHTML = h; $('rbNoteT').textContent = T(admin ? 'rb.note.admin' : 'rb.note.ro');
}
function toggleRbac(input) {
  if (!isAdmin()) { input.checked = !input.checked; return toast('err', T('perm.t'), T('rb.note.ro')); }
  const uid = input.dataset.uid, perm = input.dataset.rbac, val = input.checked, u = DB().byId(uid), old = !!(DB().permsOf(uid) || {})[perm], r = DB().setPerm(uid, perm, val, bearer());
  if (!r.ok) { input.checked = old; return toast('err', T('perm.t'), T('rb.note.ro')); }
  ST().log({ cat: 'RBAC', k: val ? 'ev.rbac.on' : 'ev.rbac.off', p: { perm, who: u ? fioOf(u) : uid }, node: perm + ' · ' + uid, old: old ? 'ON' : 'OFF', nw: val ? 'ON' : 'OFF', undo: { kind: 'rbac', data: { userId: uid, perm, value: old } } });
  toast('ok', T(val ? 'rb.on' : 'rb.off', { perm }), fioOf(u)); ST().session.refresh(); refreshAccess();     // «сервер» перевыпускает токен с актуальной матрицей прав
}

/* ======================= Заявки на сброс пароля ======================= */
function renderRequests() {
  const body = $('pwdBody'); if (!body) return; const admin = isAdmin();
  $('rqLock').hidden = admin; $('pwdTable').hidden = !admin;
  const L = admin ? DB().allRequests().slice().sort((a, b) => (a.status === 'PENDING' ? 0 : 1) - (b.status === 'PENDING' ? 0 : 1) || b.ts - a.ts) : [];
  $('rqEmpty').hidden = !admin || L.length > 0;
  body.innerHTML = L.map(r => {
    const tmp = S.tmp[r.id], pill = r.status === 'APPROVED' ? 'pill-ok' : r.status === 'REJECTED' ? 'pill-err' : 'pill-warn';
    return '<tr data-id="' + esc(r.id) + '"><td class="rq-info"><b>' + esc(r.fio) + ' <span class="mono">ID ' + esc(r.code) + '</span></b><span>' + esc(r.text) + '</span><span class="mono">' + esc(r.id) + ' · ' + ST().fmtDT(r.ts) + '</span></td>' +
      '<td class="rq-acts">' + (r.status === 'PENDING' ? '<button type="button" class="btn btn-pri btn-sm" data-res="1" data-id="' + esc(r.id) + '">' + esc(T('rq.approve')) + '</button><button type="button" class="btn btn-sm" data-res="0" data-id="' + esc(r.id) + '">' + esc(T('rq.reject')) + '</button>' : '<span class="pill ' + pill + '">' + esc(T('st.' + r.status)) + '</span>') + '</td>' +
      (tmp ? '<td class="rq-tmp"><span>' + esc(T('rq.tmp')) + '</span><b>' + esc(tmp) + '</b><button type="button" class="btn btn-sm" data-copy="' + esc(tmp) + '">' + ico('copy') + '<span>' + esc(T('common.copy')) + '</span></button></td>' : '') + '</tr>';
  }).join('');
  refreshBadges();
}
function resolveReq(id, approve) {
  const u = me(); if (!isAdmin()) return toast('err', T('perm.t'), T('rq.lock'));
  const r = DB().resolve(id, approve, u && u.fio, bearer()); if (!r.ok) return;
  if (r.tempPassword) S.tmp[id] = r.tempPassword; renderRequests();
  toast(approve ? 'ok' : 'info', T(approve ? 'rq.approved' : 'rq.rejected'), r.request.fio);
}
function refreshBadges() {
  const n = isAdmin() ? DB().pending().length : 0, b = $('cPwd'), p = $('pfReqCount');
  if (b) { b.hidden = !n; b.textContent = String(n); } if (p) { p.hidden = !n; p.textContent = String(n); }
}
function refreshAccess() { fillProfile(); renderRbac(); renderRequests(); if (SU().inspectorTarget()) SU().inspect(SU().inspectorTarget()); SU().renderAudit(); SU().renderPlugins(); }

/* ======================= НАСТРОЙКИ ======================= */
function syncSettings() {
  const s = ST().get();
  qa('#themeGrid .theme-card').forEach(b => b.setAttribute('aria-pressed', b.dataset.theme === s.theme ? 'true' : 'false'));
  qa('#langGrid .lang-btn').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === s.lang ? 'true' : 'false'));
  qa('#accRow .acc-sw').forEach(b => b.setAttribute('aria-pressed', s.accent && b.dataset.acc.toLowerCase() === s.accent ? 'true' : 'false'));
  const ia = $('inpAccent'); if (ia) ia.value = s.accent || ST().palette().acc.toLowerCase().slice(0, 7) || '#7dd3fc';
  $('accAuto').setAttribute('aria-pressed', s.accent ? 'false' : 'true');
  qa('#bgGrid .bg-card').forEach(b => b.setAttribute('aria-pressed', b.dataset.bg === s.bg ? 'true' : 'false'));
  $('chkFx').checked = !!s.fx; $('chkAnim').checked = !!s.anim; const cp = $('chkPolar'); if (cp) cp.checked = !!s.polar;
  [['segTz', s.tz], ['segTele', String(s.tele)], ['segFps', String(s.fps)]].forEach(a => qa('#' + a[0] + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === a[1])));
  dbStat();
}
function dbStat() {
  const el = $('dbStat'); if (!el) return; const kb = Math.max(1, Math.round(ST().backup.size() / 1024));
  el.innerHTML = '<span>' + esc(T('set.stat.audit')) + ' <b>' + ST().audit.count() + '</b></span><span>' + esc(T('set.stat.plug')) + ' <b>' + ST().plugins.list().length + '</b></span><span>' + esc(T('set.stat.req')) + ' <b>' + DB().allRequests().length + '</b></span><span>' + esc(T('set.stat.size')) + ' <b>' + kb + ' ' + esc(T('u.kb')) + '</b></span><span>v <b>' + ST().VERSION + '</b></span>';
}
function openSettings(cat) { syncSettings(); setCat(cat || 'ui'); openWnd('mSettings'); }
function setCat(c) { const w = $('mSettings'); qa('.st-nav button', w).forEach(b => { const on = b.dataset.cat === c; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }); qa('.st-pane', w).forEach(p => p.classList.toggle('on', p.dataset.pane === c)); }
let rstTimer = 0;
function initSettings() {
  const on = (sel, ev, f) => qa(sel).forEach(el => el.addEventListener(ev, f));
  on('.st-nav button', 'click', e => setCat(e.currentTarget.dataset.cat));
  on('#themeGrid .theme-card', 'click', e => ST().set('theme', e.currentTarget.dataset.theme));
  on('#langGrid .lang-btn', 'click', e => ST().set('lang', e.currentTarget.dataset.lang));
  on('#accRow .acc-sw', 'click', e => ST().set('accent', e.currentTarget.dataset.acc));
  on('#inpAccent', 'input', e => ST().set('accent', e.target.value));
  on('#accAuto', 'click', () => ST().set('accent', null));
  on('#chkFx', 'change', e => ST().set('fx', e.target.checked));
  on('#chkAnim', 'change', e => ST().set('anim', e.target.checked));
  on('#bgGrid .bg-card', 'click', e => ST().set('bg', e.currentTarget.dataset.bg));
  on('#chkPolar', 'change', e => ST().set('polar', e.target.checked));
  if (!DEMO) { const r = $('rowReset'); if (r) r.remove(); }                // сброс демо-данных существует только в DEMO_MODE
  [['segTz', 'tz', false], ['segTele', 'tele', true], ['segFps', 'fps', true]].forEach(a => on('#' + a[0] + ' button', 'click', e => ST().set(a[1], a[2] ? +e.currentTarget.dataset.v : e.currentTarget.dataset.v)));
  on('#btnBackup', 'click', () => { const d = ST().backup.export(); ST().log({ cat: 'CONFIG', k: 'ev.cfg.backup', node: 'backup.json', old: '', nw: 'OK' }); toast('ok', T('set.exp.done'), T('set.exp.info', { n: d.audit.length })); dbStat(); });
  on('#btnRestore', 'click', () => { const f = $('fileRestore'); f.value = ''; f.click(); });
  on('#fileRestore', 'change', e => {
    const f = e.target.files && e.target.files[0]; if (!f) return; const rd = new FileReader();
    rd.onload = () => { const r = ST().backup.import(String(rd.result || '')); if (r.ok) toast('ok', T('set.imp.ok'), T('set.imp.info', { n: r.audit })); else toast('err', T('set.imp.fail'), T(r.reason === 'JSON' ? 'set.imp.json' : 'set.imp.fmt')); };
    rd.onerror = () => toast('err', T('set.imp.fail'), T('set.imp.json')); rd.readAsText(f);
  });
  on('#btnResetDemo', 'click', e => {
    if (!DEMO) return;
    const b = e.currentTarget, sp = b.querySelector('span');
    if (b.dataset.arm === '1') { clearTimeout(rstTimer); b.dataset.arm = '0'; sp.textContent = T('set.rst.b'); ST().backup.resetDemo(); S.tmp = {}; toast('ok', T('set.rst.done'), ''); return; }
    b.dataset.arm = '1'; sp.textContent = T('set.rst.sure'); rstTimer = setTimeout(() => { b.dataset.arm = '0'; sp.textContent = T('set.rst.b'); }, 3500);
  });
}

/* ======================= Отчёт для Claude ======================= */
function crashText() {
  const u = me(), ua = g.navigator.userAgent, e = S.lastErr;
  const pk = PN().packets().map(p => JSON.stringify(p)).join('\n') || '—';
  return ['ARCTIC BUSBAR AI v' + ST().VERSION + ' — ' + T('cr.prompt.h'), '', T('cr.cfg') + ': ' + (u ? g.AuthApp.profile(u) : '—'), T('cr.env') + ': ' + ua + '; ' + g.innerWidth + '×' + g.innerHeight + '@' + (g.devicePixelRatio || 1),
    'Stack trace:', e ? e.stack : T('cr.nostack'), '', T('cr.pk') + ':', pk, '', T('cr.prompt.t')].join('\n');
}
function openCrash() {
  const u = me(), e = S.lastErr;
  $('crashCfg').textContent = (u ? g.AuthApp.profile(u) : '—') + '\nv' + ST().VERSION + ' · ' + g.navigator.userAgent.slice(0, 90);
  $('crashStack').textContent = e ? e.stack : T('cr.nostack'); $('crashPackets').textContent = PN().packets().map(p => JSON.stringify(p)).join('\n') || '—';
  openWnd('mCrash');
}
g.addEventListener('error', e => { S.lastErr = { stack: (e.error && e.error.stack) || (e.message + ' @ ' + e.filename + ':' + e.lineno + ':' + e.colno) }; });
g.addEventListener('unhandledrejection', e => { const r = e.reason; S.lastErr = { stack: (r && r.stack) || String(r) }; });

/* ======================= события ======================= */
function onLogin(d) {
  S.via = d.via || 'password'; S.tmp = {}; closeAll(true); closeMenu(); show('grid'); fillProfile(); refreshAccess(); startClock();
  const n = isAdmin() ? DB().pending().length : 0; if (n) setTimeout(() => toast('warn', T('rq.new', { n }), T('rq.new.d')), 900);
}
function onLogout() { closeAll(true); closeMenu(); S.ph = null; S.phT = 0; phoneClear(); phoneShow('idle'); if (g.ObsidianGraph) g.ObsidianGraph.stop(); S.view = 'grid'; S.via = ''; S.tmp = {}; qa('#toasts .toast').forEach(t => dismiss(t, true)); }
function init() {
  show('grid'); initMenu(); initSettings();
  /* профиль */
  ['mProfile', 'mHardware', 'mPlugin'].forEach(id => qa('#' + id + ' .wnd-tab').forEach(b => b.addEventListener('click', () => setTab(id, b.dataset.tab))));
  $('pfPhone').addEventListener('click', issuePhone); $('pfPhoneOff').addEventListener('click', () => revokePhone(false));
  $('btnLogout').addEventListener('click', () => { closeWnd('mProfile'); setTimeout(() => g.AuthApp.logout(), 240); });
  $('cfgCopy').addEventListener('click', () => copy($('cfgString').textContent, T('pf.cfg')));
  $('pfLink').addEventListener('click', () => copy($('pfLink').dataset.url || '', T('qr.url')));
  $('rbMatrix').addEventListener('change', e => { const i = e.target.closest('[data-rbac]'); if (i) toggleRbac(i); });
  $('pwdBody').addEventListener('click', e => { const c = e.target.closest('[data-copy]'); if (c) return copy(c.dataset.copy, T('rq.tmp')); const a = e.target.closest('[data-res]'); if (a) resolveReq(a.dataset.id, a.dataset.res === '1'); });
  $('crashCopy').addEventListener('click', () => copy(crashText(), T('cr.title')));
  /* состояние / язык */
  g.addEventListener('abai:auth', e => { const d = e.detail || {}; if (d.type === 'login') onLogin(d); else if (d.type === 'logout') onLogout(); });
  g.addEventListener('abai:lang', () => { const t = $('secTitle'); t.textContent = T('nav.' + S.view); if (me()) { fillProfile(); renderRbac(); renderRequests(); } syncSettings(); const b = $('btnResetDemo'); if (b) { b.dataset.arm = '0'; b.querySelector('span').textContent = T('set.rst.b'); } if (!$('mCrash').hidden) openCrash(); syncDemo(); S.phKey = ''; });
  g.addEventListener('abai:settings', e => {
    const k = e.detail && e.detail.key; syncSettings(); updateCfg();
    if (k === 'fx') { const c = $('gShowF'); if (c) { c.checked = !!e.detail.value; c.dispatchEvent(new Event('input')); } }
    if (k === 'theme' || k === 'accent') S.phKey = '';
    if (k === 'tz') paintClock();                                         // смена часового пояса видна сразу, не ждёт следующей секунды
  });
  g.addEventListener('abai:restored', () => { S.tmp = {}; syncSettings(); if (me()) { fillProfile(); renderRbac(); renderRequests(); } });
  g.addEventListener('abai:pwdrequest', () => { renderRequests(); if (isAdmin()) toast('warn', T('rq.new', { n: DB().pending().length }), T('rq.new.d')); });
  g.addEventListener('abai:pwdresolved', () => renderRequests());
  g.addEventListener('abai:audit', () => dbStat());
  g.addEventListener('storage', e => { if (e.key === 'abai.pwd_requests' && me()) renderRequests(); });
  const fxOn = ST().get('fx'); const gf = $('gShowF'); if (gf) gf.checked = !!fxOn;
  syncSettings();
}

g.AppShell = { show, view: () => S.view, openWnd, closeWnd, closeAll, toast, inspect: t => SU().inspect(t), open: k => (k === 'settings' ? openSettings() : k === 'crash' ? openCrash() : openProfile('id')), openProfile, openSettings, refreshAccess, renderRequests, renderRbac, copy,
  state: () => ({ view: S.view, windows: S.stack.slice(), menu: S.menu, via: S.via }) };
init();
})(window);
