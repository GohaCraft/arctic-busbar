/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/users-db.js  (слой данных, БЕЗ UI)
   Аккаунты + RBAC + сброс пароля (1 запрос / 24 ч на аккаунт) + код и ссылка жюри.
   Подключается ПЕРВЫМ. Демо-данные; в Phase 2 пароли заменяются bcrypt-хешами FastAPI.
   Публичный API: window.UsersDB. События (window): abai:pwdrequest, abai:pwdresolved. Событие abai:auth шлёт scripts/auth/auth.js.
   ЭТАП 2: UsersDB.session — персональный одноразовый PIN / QR-токен ЛЮБОГО аккаунта (вход с телефона ровно в этот профиль),
   UsersDB.byId, snapshot()/restore()/resetDemo() для бэкапа. Временные пароли (abai.pass_override) в бэкап НЕ попадают. */
(function (g) {
'use strict';

/* ---------- настройки предприятия ---------- */
const ENTERPRISE_ADMIN_EMAIL = 'security-rza@nornickel-arctic.ru';
const MAIL_TEMPLATE = { subject: 'ARCTIC BUSBAR AI: запрос на смену пароля', body: 'Здравствуйте, {who} забыл пароль, измените пароль.' };
const RESET_LIMIT_MS = 864e5;                                                    // 24 часа
const JURY_BASE_URL = 'http://192.168.4.1:8000/';                                // стенд (точка доступа Wi-Fi); при http(s) берётся адрес страницы
const JURY_QR_URL = JURY_BASE_URL + '?qr_auth=jury_session';
const JURY_SECRET = 'ARCTIC-JURY-2026', JURY_UNIVERSAL_PIN = '261126', CODE_WINDOW_MS = 3e4;
const K = { last: 'abai.pwd_last', req: 'abai.pwd_requests', pass: 'abai.pass_override', perms: 'abai.perms_override', dev: 'abai.jury_devices', url: 'abai.jury_url' };
const PERMS = ['CAN_SWITCH_RELAY', 'CAN_EDIT_PINN', 'CAN_ROLLBACK_LOGS', 'CAN_MANAGE_PLUGINS'];
const NONE = { CAN_SWITCH_RELAY: false, CAN_EDIT_PINN: false, CAN_ROLLBACK_LOGS: false, CAN_MANAGE_PLUGINS: false };
const USERS = [
  { id: '1073819', login: 'eng.rza', code: '1073819', fio: 'Левицкий А.Р.', pass: 'admin123', role: 'admin', roleLabel: 'Главный Инженер РЗА (Admin)',
    perms: { CAN_SWITCH_RELAY: true, CAN_EDIT_PINN: true, CAN_ROLLBACK_LOGS: true, CAN_MANAGE_PLUGINS: true } },
  { id: '1073820', login: 'disp.smena', code: '1073820', fio: 'Соколов И.В.', pass: 'operator123', role: 'operator', roleLabel: 'Диспетчер смены (Operator)', perms: NONE },
  { id: '1073821', login: 'jury.qr', code: '1073821', fio: 'Эксперт Жюри', pass: 'jury123', role: 'jury', roleLabel: 'Эксперт Жюри (Observer)', perms: NONE }
];

/* ---------- хранилище (localStorage может быть недоступен: приватный режим, file://) ---------- */
const mem = {};
const load = (k, d) => { try { const v = g.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return k in mem ? mem[k] : d; } };
const save = (k, v) => { mem[k] = v; try { g.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* остаётся в памяти вкладки */ } };

/* ---------- поиск аккаунта: логин / табельный код / ФИО (регистр, точки, пробелы, ё/е не важны) ---------- */
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-z0-9а-я]/g, '');
function find(q) {
  const n = norm(q); if (!n) return null;
  return USERS.find(u => norm(u.login) === n || norm(u.code) === n || norm(u.fio) === n || (n.length >= 5 && /[а-я]/.test(n) && norm(u.fio).indexOf(n) === 0)) || null;
}
const passOf = u => load(K.pass, {})[u.id] || u.pass;
const permsOf = u => Object.assign({}, u.perms, load(K.perms, {})[u.id] || {});
const pub = u => ({ id: u.id, login: u.login, code: u.code, fio: u.fio, role: u.role, roleLabel: u.roleLabel, perms: permsOf(u) });
const byId = id => { const u = USERS.find(x => x.id === String(id)); return u ? pub(u) : null; };

/* result: {ok, user} | {ok:false, reason: 'EMPTY'|'NO_USER'|'BAD_PASS', userId?} */
function authenticate(query, password) {
  if (!String(query || '').trim() || !String(password || '')) return { ok: false, reason: 'EMPTY' };
  const u = find(query);
  if (!u) return { ok: false, reason: 'NO_USER' };
  if (String(password) !== passOf(u)) return { ok: false, reason: 'BAD_PASS', userId: u.id };
  return { ok: true, user: pub(u) };
}
function setPerm(userId, perm, value) {
  const u = USERS.find(x => x.id === userId);
  if (!u || PERMS.indexOf(perm) < 0 || u.role === 'jury') return { ok: false };
  const all = load(K.perms, {}), old = permsOf(u)[perm];
  all[userId] = Object.assign(all[userId] || {}, { [perm]: !!value }); save(K.perms, all);
  return { ok: true, userId, perm, old, value: !!value };
}

/* ---------- сброс пароля: 1 запрос в 24 часа на аккаунт ---------- */
const pad2 = n => String(n).padStart(2, '0');
const fmtLeft = ms => { const m = Math.max(1, Math.ceil(ms / 6e4)); return Math.floor(m / 60) + ' ч. ' + (m % 60) + ' мин.'; };   // «23 ч. 41 мин.»
const fmtClock = ms => { const s = Math.max(0, Math.ceil(ms / 1e3)); return pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60); };   // «23:41:07»
const leftMs = id => { const l = load(K.last, {})[id] || 0; return l ? Math.max(0, RESET_LIMIT_MS - (Date.now() - l)) : 0; };
function requestReset(query) {
  const u = find(query);
  if (!u) return { ok: false, reason: 'NO_USER', text: 'Сотрудник не найден. Проверьте логин, табельный код или ФИО.' };
  const left = leftMs(u.id);
  if (left > 0) return { ok: false, reason: 'LIMIT', userId: u.id, fio: u.fio, remainingMs: left, nextAt: Date.now() + left,
    text: 'Запрос на смену пароля для этого аккаунта уже отправлялся. Повторный запрос возможен через ' + fmtClock(left) + '.' };
  const ts = Date.now(), who = u.fio + ' (ID ' + u.code + ')', body = MAIL_TEMPLATE.body.replace('{who}', who);
  const mailto = 'mailto:' + ENTERPRISE_ADMIN_EMAIL + '?subject=' + encodeURIComponent(MAIL_TEMPLATE.subject) + '&body=' + encodeURIComponent(body);
  const req = { id: 'PW-' + ts.toString(36).toUpperCase(), ts, userId: u.id, login: u.login, code: u.code, fio: u.fio, text: body, to: ENTERPRISE_ADMIN_EMAIL, status: 'PENDING' };
  const last = load(K.last, {}); last[u.id] = ts; save(K.last, last);
  const list = load(K.req, []); list.push(req); save(K.req, list);
  g.dispatchEvent(new CustomEvent('abai:pwdrequest', { detail: req }));        // store.js пишет PWD_RESET в журнал аудита
  return { ok: true, request: req, to: ENTERPRISE_ADMIN_EMAIL, subject: MAIL_TEMPLATE.subject, body, mailto, nextAt: ts + RESET_LIMIT_MS };
}
const allRequests = () => load(K.req, []);
const pending = () => allRequests().filter(r => r.status === 'PENDING');
function resolve(id, approve, by) {
  const list = allRequests(), r = list.find(x => x.id === id && x.status === 'PENDING');
  if (!r) return { ok: false };
  r.status = approve ? 'APPROVED' : 'REJECTED'; r.by = by || ''; r.resolvedTs = Date.now();
  let tmp = null;
  if (approve) { tmp = 'Tmp-' + Math.random().toString(36).slice(2, 8); const o = load(K.pass, {}); o[r.userId] = tmp; save(K.pass, o); }
  save(K.req, list);
  g.dispatchEvent(new CustomEvent('abai:pwdresolved', { detail: { request: r, tempPassword: tmp } }));
  return { ok: true, request: r, tempPassword: tmp };
}
function resetLimit(userId) { const l = load(K.last, {}); delete l[userId]; save(K.last, l); }    // служебное: снять лимит (тесты / админ)

/* ---------- код жюри: 6 цифр, окно 30 с (допуск ±1 окно на расхождение часов) + универсальный PIN ---------- */
const h32 = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 13; h = Math.imul(h, 1540483477); h ^= h >>> 15; return h >>> 0; };
const win = () => Math.floor(Date.now() / CODE_WINDOW_MS);
const codeAt = w => String(h32(JURY_SECRET + ':' + w) % 1e6).padStart(6, '0');
const jury = { win, code: () => codeAt(win()), left: () => 1 - (Date.now() % CODE_WINDOW_MS) / CODE_WINDOW_MS,
  verify: c => { c = String(c || '').replace(/\D/g, ''); return c.length === 6 && (c === JURY_UNIVERSAL_PIN || c === codeAt(win()) || c === codeAt(win() - 1) || c === codeAt(win() + 1)); } };
const devices = () => load(K.dev, 0) | 0;
const countDevice = () => save(K.dev, devices() + 1);
/* ссылка для QR: при http(s) — адрес этой страницы, иначе (file://) адрес стенда; можно переопределить window.ABAI_JURY_URL / localStorage abai.jury_url */
function juryBase() {
  const o = g.ABAI_JURY_URL || load(K.url, ''); if (o) return String(o).split('?')[0];
  return /^https?:$/.test(g.location.protocol) ? g.location.origin + g.location.pathname : JURY_BASE_URL;
}
const juryLink = code => juryBase() + '?qr_auth=jury_session&code=' + (code || jury.code());

/* ---------- персональный вход с телефона: PIN / QR привязаны к КОНКРЕТНОМУ аккаунту (этап 2) ----------
   Ссылка: <база>?qr_auth=session&uid=<ID>&code=<PIN>. Код = h32(секрет:uid:окно) — окно 30 с, допуск ±1 окно, как у кода жюри.
   Демо: в Phase 2 заменяется подписанным одноразовым токеном сервера. */
const sCodeAt = (uid, w) => String(h32(JURY_SECRET + ':' + uid + ':' + w) % 1e6).padStart(6, '0');
const session = {
  code: uid => sCodeAt(String(uid), win()),
  left: jury.left,
  verify: (uid, c) => { c = String(c || '').replace(/\D/g, ''); const u = String(uid); return c.length === 6 && USERS.some(x => x.id === u) && [win(), win() - 1, win() + 1].some(w => c === sCodeAt(u, w)); },
  match: c => { c = String(c || '').replace(/\D/g, ''); if (c.length !== 6) return null; const u = USERS.find(x => session.verify(x.id, c)); return u ? pub(u) : null; },
  link: (uid, code) => juryBase() + '?qr_auth=session&uid=' + encodeURIComponent(uid) + '&code=' + (code || session.code(uid))
};

/* ---------- бэкап: заявки, лимиты, переопределённые права (пароли не экспортируются) ---------- */
const snapshot = () => ({ requests: load(K.req, []), last: load(K.last, {}), perms: load(K.perms, {}) });
function restore(d) {
  if (!d || typeof d !== 'object') return false;
  if (Array.isArray(d.requests)) save(K.req, d.requests);
  if (d.last && typeof d.last === 'object') save(K.last, d.last);
  if (d.perms && typeof d.perms === 'object') save(K.perms, d.perms);
  return true;
}
function resetDemo() { save(K.req, []); save(K.last, {}); save(K.perms, {}); save(K.pass, {}); }

/* ---------- публичный API ---------- */
g.UsersDB = { ENTERPRISE_ADMIN_EMAIL, MAIL_TEMPLATE, RESET_LIMIT_MS, JURY_QR_URL, JURY_BASE_URL, PERMS, jury, juryLink, devices, countDevice,
  list: () => USERS.map(pub), find: q => { const u = find(q); return u ? pub(u) : null; },
  juryUser: () => pub(USERS.find(u => u.role === 'jury')), authenticate, byId, session, snapshot, restore, resetDemo,
  permsOf: id => { const u = USERS.find(x => x.id === id); return u ? permsOf(u) : null; }, setPerm,
  remainingMs: leftMs, formatRemaining: fmtLeft, formatClock: fmtClock, requestReset, pending, allRequests, resolve, resetLimit,
  drawQR: (cv, text) => g.QRJury.drawQR(cv, g.QRJury.encodeBest(text)) };               // совместимость со старым API
})(window);
