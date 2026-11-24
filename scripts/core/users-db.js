/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/core/users-db.js  («мок-сервер» учётных записей и авторизации, БЕЗ UI)

   ЭТАП 3 — ZERO TRUST. Этот файл имитирует то, что в Phase 2 станет бэкендом FastAPI. Правило: UI ничему не доверяет,
   любое привилегированное действие предъявляет «серверу» подписанный токен сессии (Bearer), а «сервер» проверяет подпись и права.

   Что изменено по аудиту безопасности:
   1. RBAC больше НЕ читается из localStorage (раньше abai.perms_override: в консоли можно было дописать себе права).
      Матрица прав живёт в памяти замыкания этого файла, зеркалится в sessionStorage ТОЛЬКО с HMAC-печатью (подмена = сброс + событие abai:tamper).
      Права текущей сессии зашиты в подписанный токен и читаются через Store.session.has() — это иммутабельный объект в памяти.
   2. Открытых паролей нет: только хеши PBKDF2-HMAC-SHA256 в формате passlib «$pbkdf2-sha256$раунды$соль$хеш».
      Phase 2: на сервере те же пароли хранятся как bcrypt/argon2id, клиент хешей не видит. Демо-пароли для показа жюри — в demo-data.js (только DEMO_MODE).
   3. Временные пароли после одобрения заявки хранятся как ХЕШ в запечатанном sessionStorage (раньше abai.pass_override: открытый текст в localStorage).
   4. QR / ссылки: ?code=123456 в URL запрещён. Ссылка = <адрес>#abai-qr=<JWT-образный токен HS256>: подпись, срок жизни (QR_TTL_S),
      тип, одноразовый jti (личный QR гасится после входа). Токен в #-части не уходит на сервер, в логи и в Referer, и сразу стирается из адресной строки.
   5. 6-значные коды — TOTP на HMAC-SHA256 (RFC 6238, окно 30 с, допуск ±1), а не FNV-хеш. Универсальный PIN жюри существует только в DEMO_MODE.
   6. Подбор: 5 неудач подряд (пароль, PIN) → блокировка 30 с, дальше удвоение до 5 мин (счётчик запечатан в sessionStorage).
   7. Бэкап не содержит прав (perms) и паролей; при импорте права из файла игнорируются — иначе правка .json = повышение привилегий.

   ЧЕСТНО О ГРАНИЦАХ: ключ подписи ниже лежит в клиентском JS, поэтому это МОК: он защищает от подмены через консоль/хранилище и от случайных
   ошибок, но не от человека, который прочитал исходники и отлаживает страницу. Настоящая граница доверия — сервер (Phase 2).
   Формат токенов и точки вызова (issue / redeem / verify / reissue) уже совпадают с будущими REST-эндпоинтами:
       POST /api/v1/auth/login          → authenticate()      POST /api/v1/auth/qr          → qr.issue(bearer)
       POST /api/v1/auth/qr/redeem      → qr.redeem(token)    POST /api/v1/auth/refresh     → reissue(bearer)
       PUT  /api/v1/rbac/{uid}/{perm}   → setPerm(...,bearer) POST /api/v1/auth/pwd/resolve  → resolve(...,bearer)

   Публичный API: window.UsersDB. События (window): abai:pwdrequest, abai:pwdresolved, abai:tamper, abai:rbac {userId, perm, value}.
   Событие abai:auth шлёт scripts/auth/auth.js, abai:session — Store.session. */
(function (g) {
'use strict';
const C = g.CryptoLite;
const CFG = g.ABAI_CONFIG || { DEMO_MODE: false, QR_TTL_S: 90, SESSION_TTL_S: 28800, PUBLIC_URL: '' };
const DEMO = CFG.DEMO_MODE === true;

/* ---------- настройки предприятия ---------- */
const ENTERPRISE_ADMIN_EMAIL = 'security-rza@nornickel-arctic.ru';
const MAIL_TEMPLATE = { subject: 'ARCTIC BUSBAR AI: запрос на смену пароля', body: 'Здравствуйте, {who} забыл пароль, измените пароль.' };
const RESET_LIMIT_MS = 864e5;                                                    // 24 часа
const JURY_BASE_URL = 'http://192.168.4.1:8000/';                                // стенд (точка доступа Wi-Fi); при http(s) берётся адрес самой страницы
const STEP_MS = 3e4;                                                             // окно TOTP
const JURY_UNIVERSAL_PIN = DEMO ? '261126' : '';                                 // универсальный PIN — только для показа жюри
/* МОК серверного ключа подписи (см. «честно о границах»). Phase 2: ключ только в FastAPI, ротация по kid. */
const SIGN_KEY = 'abai.mock.hs256/2026-11/NOT-A-SECRET/real-key-lives-on-the-server-in-phase-2';
const K = { last: 'abai.pwd_last', req: 'abai.pwd_requests', dev: 'abai.jury_devices', jti: 'abai.used_jti' };       // localStorage: ничего, что давало бы права
const SK = { rbac: 'abai.s.rbac', tmp: 'abai.s.tmp', fail: 'abai.s.fail' };                                           // sessionStorage: только запечатанные блобы

const PERMS = Object.freeze(['CAN_SWITCH_RELAY', 'CAN_EDIT_PINN', 'CAN_ROLLBACK_LOGS', 'CAN_MANAGE_PLUGINS']);
const mk = (a, b, c, d) => Object.freeze({ CAN_SWITCH_RELAY: a, CAN_EDIT_PINN: b, CAN_ROLLBACK_LOGS: c, CAN_MANAGE_PLUGINS: d });
const NONE = mk(false, false, false, false);
/* хеши получены командой: python3 -c "import hashlib,os,base64;..." → pbkdf2_hmac('sha256', пароль, соль, 29000); пароли в этом файле отсутствуют */
const USERS = Object.freeze([
  { id: '1073819', login: 'eng.rza', code: '1073819', fio: 'Левицкий А.Р.', role: 'admin', roleLabel: 'Главный Инженер РЗА (Admin)', perms: mk(true, true, true, true),
    hash: '$pbkdf2-sha256$29000$gITUVIS3NzQLgop7yeRL8A$/h6h3u/JqQWmO9yTYlzVvUHoh.JUGEGhE3XIuCI2Tt4' },
  { id: '1073820', login: 'disp.smena', code: '1073820', fio: 'Соколов И.В.', role: 'operator', roleLabel: 'Диспетчер смены (Operator)', perms: NONE,
    hash: '$pbkdf2-sha256$29000$OWnsdDejBFiYSgRg0ugHbw$P4wizDsDp6bIgJ6a/SJsZVE/z02tLGJ3Wu2xQjvLtB0' },
  { id: '1073821', login: 'jury.qr', code: '1073821', fio: 'Эксперт Жюри', role: 'jury', roleLabel: 'Эксперт Жюри (Observer)', perms: NONE,
    hash: '$pbkdf2-sha256$29000$iE1TzOhPYWYWyhnCNwEsKA$lpBdN5m5cuH6mLsJMCWV2xVK5RBW0LHmcxTg.N1FwiQ' }
].map(Object.freeze));
/* хеш «несуществующего» пароля: неизвестный логин проверяется столько же времени, сколько неверный пароль (нет тайминговой утечки существования учётки) */
const DUMMY_HASH = '$pbkdf2-sha256$29000$EzrfWvACL.1knx1T5UpEyQ$yEsIphXHGjF4mtZF0zN2fhcwmn0eWMZRqyH.na.b.Zo';

/* ---------- localStorage: только непривилегированные данные (заявки, лимиты, счётчик устройств, погашенные jti) ---------- */
const mem = {};
const load = (k, d) => { try { const v = g.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return k in mem ? mem[k] : d; } };
const save = (k, v) => { mem[k] = v; try { g.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* остаётся в памяти вкладки */ } };

/* ---------- sessionStorage с печатью целостности (HMAC): живёт до закрытия вкладки, подмену видно ---------- */
const SS = (() => { try { const s = g.sessionStorage; s.setItem('abai.s.probe', '1'); s.removeItem('abai.s.probe'); return s; } catch (e) { return null; } })();
const sMem = {}, tampered = [];
const seal = (k, body) => C.b64u.enc(C.hmac(SIGN_KEY, 'seal|' + k + '|' + body));
function sPut(k, obj) { const b = JSON.stringify(obj), rec = JSON.stringify({ b, s: seal(k, b) }); sMem[k] = rec; if (SS) { try { SS.setItem(k, rec); } catch (e) { /* квота */ } } }
function sDel(k) { delete sMem[k]; if (SS) { try { SS.removeItem(k); } catch (e) { /* ok */ } } }
function sGet(k, d) {
  let raw = null; try { raw = SS ? SS.getItem(k) : null; } catch (e) { raw = null; }
  if (raw == null) raw = k in sMem ? sMem[k] : null;
  if (raw == null) return d;
  try { const r = JSON.parse(raw); if (r && typeof r.b === 'string' && C.timingSafeEqual(seal(k, r.b), String(r.s))) return JSON.parse(r.b); } catch (e) { /* ниже: подмена */ }
  tampered.push(k); sDel(k); try { g.dispatchEvent(new CustomEvent('abai:tamper', { detail: { key: k } })); } catch (e) { /* ok */ } return d;
}

/* ---------- RBAC-матрица («серверное» состояние): в памяти + печать в sessionStorage; localStorage НЕ читается ---------- */
let rbac = sGet(SK.rbac, {});
if (!rbac || typeof rbac !== 'object') rbac = {};
const permsOf = u => { const d = rbac[u.id] || {}, o = {}; PERMS.forEach(p => { o[p] = p in d ? d[p] === true : u.perms[p] === true; }); return Object.freeze(o); };
const pub = u => Object.freeze({ id: u.id, login: u.login, code: u.code, fio: u.fio, role: u.role, roleLabel: u.roleLabel, perms: permsOf(u) });
const byId = id => { const u = USERS.find(x => x.id === String(id)); return u ? pub(u) : null; };

/* ---------- временные пароли (после одобрения заявки): только хеш, только sessionStorage с печатью ---------- */
let tmpHash = sGet(SK.tmp, {});
if (!tmpHash || typeof tmpHash !== 'object') tmpHash = {};
const hashOf = u => (typeof tmpHash[u.id] === 'string' ? tmpHash[u.id] : u.hash);

/* ---------- защита от подбора ---------- */
const FAIL_MAX = 5, LOCK_BASE_S = 30, LOCK_CAP_S = 300;
const failState = () => { const f = sGet(SK.fail, { n: 0, until: 0 }); return { n: f.n | 0, until: +f.until || 0 }; };
const lockLeft = () => Math.max(0, failState().until - Date.now());
function noteFail() { const f = failState(); f.n++; if (f.n % FAIL_MAX === 0) f.until = Date.now() + Math.min(LOCK_CAP_S, LOCK_BASE_S * Math.pow(2, f.n / FAIL_MAX - 1)) * 1000; sPut(SK.fail, f); }
function noteOk() { sDel(SK.fail); }

/* ---------- поиск аккаунта: логин / табельный код / ФИО (регистр, точки, пробелы, ё/е не важны) ---------- */
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-z0-9а-я]/g, '');
function find(q) {
  const n = norm(q); if (!n) return null;
  return USERS.find(u => norm(u.login) === n || norm(u.code) === n || norm(u.fio) === n || (n.length >= 5 && /[а-я]/.test(n) && norm(u.fio).indexOf(n) === 0)) || null;
}

/* ======================= ТОКЕН СЕССИИ (JWT-образный, HS256) ======================= */
function issueSession(u, via, keep) {
  const now = Math.floor(Date.now() / 1000), pm = PERMS.filter(p => permsOf(u)[p]);
  return C.signToken({ typ: 'sess', sub: u.id, sid: keep ? keep.sid : C.randomId(9), role: u.role, pm, via: via || 'password', iat: keep ? keep.iat : now, exp: keep ? keep.exp : now + CFG.SESSION_TTL_S }, SIGN_KEY);
}
function verifySession(tok) {                                                    // {ok, payload, user} | {ok:false, reason}
  const r = C.verifyToken(tok, SIGN_KEY, { typ: 'sess' }); if (!r.ok) return r;
  const u = USERS.find(x => x.id === r.payload.sub); if (!u) return { ok: false, reason: 'NO_USER' };
  return { ok: true, payload: r.payload, user: pub(u) };
}
const reissue = bearer => { const r = verifySession(bearer); if (!r.ok) return null; const u = USERS.find(x => x.id === r.payload.sub); return issueSession(u, r.payload.via, r.payload); };
const actor = bearer => { const r = verifySession(bearer); return r.ok ? r : null; };
const denied = a => (a ? { ok: false, reason: 'FORBIDDEN' } : { ok: false, reason: 'UNAUTHENTICATED' });
const tick = () => new Promise(r => setTimeout(r, 0));                           // отдать кадр браузеру: кнопка успеет показать «проверяю» до тяжёлого PBKDF2

/* ======================= ВХОД ПО ПАРОЛЮ ======================= */
/* → Promise<{ok:true, user, token} | {ok:false, reason:'EMPTY'|'NO_USER'|'BAD_PASS'|'LOCKED', userId?, retryMs?}>
   Причины NO_USER / BAD_PASS различаются только для журнала и тестов; на экран выводится одно нейтральное сообщение (защита от перебора логинов). */
async function authenticate(query, password) {
  if (!String(query || '').trim() || !String(password || '')) return { ok: false, reason: 'EMPTY' };
  const lk = lockLeft(); if (lk > 0) return { ok: false, reason: 'LOCKED', retryMs: lk };
  await tick();
  const u = find(query), ok = C.verifyPassword(String(password), u ? hashOf(u) : DUMMY_HASH);
  if (!u) { noteFail(); return { ok: false, reason: 'NO_USER' }; }
  if (!ok) { noteFail(); return { ok: false, reason: 'BAD_PASS', userId: u.id }; }
  noteOk(); return { ok: true, user: pub(u), token: issueSession(u, 'password') };
}

/* ======================= RBAC (только с токеном администратора) ======================= */
function setPerm(userId, perm, value, bearer) {
  const a = actor(bearer); if (!a || a.payload.role !== 'admin') return denied(a);
  const u = USERS.find(x => x.id === String(userId));
  if (!u || PERMS.indexOf(perm) < 0 || u.role === 'jury') return { ok: false, reason: 'BAD_ARGS' };
  const old = permsOf(u)[perm]; rbac[u.id] = Object.assign({}, rbac[u.id], { [perm]: !!value }); sPut(SK.rbac, rbac);
  try { g.dispatchEvent(new CustomEvent('abai:rbac', { detail: { userId: u.id, perm, value: !!value, old } })); } catch (e) { /* ok */ }
  return { ok: true, userId: u.id, perm, old, value: !!value };
}

/* ======================= СБРОС ПАРОЛЯ: 1 запрос в 24 часа на аккаунт ======================= */
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
const TMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';                          // без похожих символов (0/o, 1/l/i)
function resolve(id, approve, by, bearer) {
  const a = actor(bearer); if (!a || a.payload.role !== 'admin') return denied(a);
  const list = allRequests(), r = list.find(x => x.id === id && x.status === 'PENDING');
  if (!r) return { ok: false, reason: 'NOT_FOUND' };
  r.status = approve ? 'APPROVED' : 'REJECTED'; r.by = by || ''; r.resolvedTs = Date.now();
  let tmp = null;
  if (approve) {
    tmp = 'Tmp-' + Array.prototype.map.call(C.randomBytes(6), b => TMP_ALPHABET[b % TMP_ALPHABET.length]).join('');
    tmpHash[r.userId] = C.hashPassword(tmp); sPut(SK.tmp, tmpHash);             // в хранилище — только хеш; открытый вид получает только одобривший администратор
  }
  save(K.req, list);
  g.dispatchEvent(new CustomEvent('abai:pwdresolved', { detail: { request: r, tempPassword: tmp } }));
  return { ok: true, request: r, tempPassword: tmp };
}
function resetLimit(userId, bearer) {                                            // служебное: снять лимит (админ; в DEMO_MODE и для тестов без токена)
  if (!DEMO) { const a = actor(bearer); if (!a || a.payload.role !== 'admin') return denied(a); }
  const l = load(K.last, {}); delete l[userId]; save(K.last, l); return { ok: true };
}

/* ======================= ОДНОРАЗОВЫЕ КОДЫ (TOTP HMAC-SHA256) ======================= */
const digits = c => String(c || '').replace(/\D/g, '');
const win = () => Math.floor(Date.now() / STEP_MS);
const secretOf = scope => C.hmac(SIGN_KEY, 'otp|' + scope);
const codeAt = (scope, w) => C.hotp(secretOf(scope), w, 6);
const near = (scope, c) => c.length === 6 && [win(), win() - 1, win() + 1].some(w => C.timingSafeEqual(c, codeAt(scope, w)));
/* личный PIN «Подключить телефон»: выдаётся код СЛЕДУЮЩЕГО окна, принимаются окна −2…+1 — код живёт не меньше QR_TTL_S (90 с) и не дольше ~2 минут */
const nearPin = (uid, c) => c.length === 6 && [win() - 2, win() - 1, win(), win() + 1].some(w => C.timingSafeEqual(c, codeAt('pin|' + uid, w)));
const leftFrac = () => 1 - (Date.now() % STEP_MS) / STEP_MS;

/* код и QR жюри (витрина стенда): существуют только в DEMO_MODE */
const juryAcc = () => USERS.find(u => u.role === 'jury');
const jury = {
  win, left: leftFrac, enabled: DEMO,
  code: () => (DEMO ? codeAt('jury', win()) : ''),
  verify: c => { c = digits(c); return DEMO && c.length === 6 && (C.timingSafeEqual(c, JURY_UNIVERSAL_PIN) || near('jury', c)); },
  token() { if (!DEMO) return ''; const now = Math.floor(Date.now() / 1000); return C.signToken({ typ: 'jury', sub: juryAcc().id, jti: C.randomId(7), exp: now + CFG.QR_TTL_S }, SIGN_KEY); },
  link: () => (DEMO ? linkOf(jury.token()) : ''),
  /* кнопка «Тестовый вход в режим Жюри» (только DEMO_MODE) */
  login() { if (!DEMO) return { ok: false, reason: 'DISABLED' }; const u = juryAcc(); return { ok: true, kind: 'jury', user: pub(u), token: issueSession(u, 'test-jury') }; }
};
/* ссылка входа: токен — в #-части; при http(s) берётся адрес этой страницы, при file:// — адрес стенда */
function publicBase() {
  const o = CFG.PUBLIC_URL; if (o) return String(o).split('#')[0].split('?')[0];
  return /^https?:$/.test(g.location.protocol) ? g.location.origin + g.location.pathname : JURY_BASE_URL;
}
const LINK_KEY = 'abai-qr';
const linkOf = token => publicBase() + '#' + LINK_KEY + '=' + token;
function parseLink(text) {                                                        // токен из ссылки, из «#abai-qr=…» или голый токен; иначе null
  text = String(text || '').trim(); if (!text) return null;
  let m = new RegExp('[#?&]' + LINK_KEY + '=([A-Za-z0-9_.-]{20,2048})').exec(text);
  if (m) return m[1];
  m = /^([A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,})$/.exec(text);
  return m ? m[1] : null;
}
const isLegacyLink = text => /[?&](qr_auth|code)=/.test(String(text || ''));       // старые ссылки с открытым кодом: отвергаются явно

/* погашение jti (одноразовость личного QR). Phase 2: Redis SETNX с TTL = exp */
function consumeJti(jti, exp) {
  const now = Math.floor(Date.now() / 1000), list = load(K.jti, []).filter(x => x && x[1] > now - 10);
  if (list.some(x => x[0] === jti)) { save(K.jti, list); return false; }
  list.push([jti, exp]); save(K.jti, list.slice(-200)); return true;
}
const devices = () => load(K.dev, 0) | 0;
const countDevice = () => save(K.dev, devices() + 1);

const qr = {
  /* «Подключить телефон»: токен выпускается ПО НАЖАТИЮ, только для аккаунта предъявленной сессии, живёт QR_TTL_S секунд */
  issue(bearer) {
    const a = actor(bearer); if (!a) return denied(null);
    const exp = Math.floor(Date.now() / 1000) + CFG.QR_TTL_S, uid = a.payload.sub;
    const token = C.signToken({ typ: 'qr', sub: uid, jti: C.randomId(7), exp }, SIGN_KEY);
    return { ok: true, token, url: linkOf(token), exp: exp * 1000, ttl: CFG.QR_TTL_S, pin: codeAt('pin|' + uid, win() + 1) };
  },
  /* вход по токену из ссылки/QR → {ok, kind:'personal'|'jury', user, token(сессии)} | {ok:false, reason} */
  redeem(tokenOrLink) {
    if (isLegacyLink(tokenOrLink) && !parseLink(tokenOrLink)) return { ok: false, reason: 'LEGACY' };
    const tok = parseLink(tokenOrLink); if (!tok) return { ok: false, reason: 'FORMAT' };
    const r = C.verifyToken(tok, SIGN_KEY); if (!r.ok) return { ok: false, reason: r.reason };
    const p = r.payload;
    if (p.typ === 'jury') {
      if (!DEMO) return { ok: false, reason: 'DISABLED' };
      const u = juryAcc(); countDevice(); return { ok: true, kind: 'jury', user: pub(u), token: issueSession(u, 'qr-jury') };
    }
    if (p.typ !== 'qr') return { ok: false, reason: 'TYPE' };
    const u = USERS.find(x => x.id === String(p.sub)); if (!u) return { ok: false, reason: 'NO_USER' };
    if (typeof p.jti !== 'string' || !consumeJti(p.jti, p.exp)) return { ok: false, reason: 'USED' };
    countDevice(); return { ok: true, kind: 'personal', user: pub(u), token: issueSession(u, 'qr') };
  },
  /* «Отозвать код»: гасим одноразовый jti — после этого redeem вернёт USED. Только для своего аккаунта и своего токена */
  revoke(bearer, tokenOrLink) {
    const a = actor(bearer); if (!a) return denied(null);
    const t = parseLink(tokenOrLink), r = t ? C.verifyToken(t, SIGN_KEY) : null;
    if (!r || !r.ok || r.payload.typ !== 'qr' || r.payload.sub !== a.payload.sub) return denied(a);
    consumeJti(r.payload.jti, r.payload.exp); return { ok: true };
  },
  /* токен уже погашен (вход состоялся или код отозван)? Phase 2: GET /api/v1/auth/qr/{jti}/status */
  used(tokenOrLink) { const t = parseLink(tokenOrLink), d = t && C.decodeToken(t); return !!(d && load(K.jti, []).some(x => x && x[0] === d.payload.jti)); },
  parse: parseLink, isLegacy: isLegacyLink, KEY: LINK_KEY,
  inspect(tokenOrLink) { const t = parseLink(tokenOrLink); const d = t && C.decodeToken(t); return d ? { typ: d.payload.typ, sub: d.payload.sub, exp: d.payload.exp * 1000 } : null; }
};
const pin = {
  win, left: leftFrac,
  /* PIN аккаунта выдаётся только его собственной сессии (Bearer.sub === uid); без токена — пустая строка: «оракула PIN» в консоли нет */
  code(uid, bearer) { const a = actor(bearer); return a && a.payload.sub === String(uid) ? codeAt('pin|' + String(uid), win() + 1) : ''; },
  /* ввод 6 цифр (экран входа): универсальный PIN / код жюри (DEMO) или персональный PIN аккаунта → {ok, kind, user, token} | {ok:false, reason:'BAD'|'LOCKED'} */
  redeem(code, uid) {
    const lk = lockLeft(); if (lk > 0) return { ok: false, reason: 'LOCKED', retryMs: lk };
    code = digits(code); if (code.length !== 6) { noteFail(); return { ok: false, reason: 'BAD' }; }
    if (!uid && jury.verify(code)) { noteOk(); countDevice(); const u = juryAcc(); return { ok: true, kind: 'jury', user: pub(u), token: issueSession(u, 'code-jury') }; }
    const hit = uid ? USERS.find(x => x.id === String(uid) && nearPin(x.id, code)) : USERS.find(x => nearPin(x.id, code));
    if (hit) { noteOk(); countDevice(); return { ok: true, kind: 'personal', user: pub(hit), token: issueSession(hit, 'code') }; }
    noteFail(); return { ok: false, reason: 'BAD' };
  }
};

/* ======================= БЭКАП: заявки и лимиты (права и пароли — НИКОГДА) ======================= */
const snapshot = () => ({ requests: load(K.req, []), last: load(K.last, {}) });
function restore(d) {
  if (!d || typeof d !== 'object') return false;
  if (Array.isArray(d.requests)) save(K.req, d.requests.filter(r => r && typeof r.id === 'string' && /^(PENDING|APPROVED|REJECTED)$/.test(r.status)));
  if (d.last && typeof d.last === 'object') save(K.last, d.last);
  return true;                                                                  // d.perms (старые бэкапы) сознательно игнорируется
}
function resetDemo() { save(K.req, []); save(K.last, {}); rbac = {}; sDel(SK.rbac); tmpHash = {}; sDel(SK.tmp); sDel(SK.fail); }
/* вызывается Store при выходе: стирает из sessionStorage ВСЕ ключи abai.s.* (токен сессии, печати RBAC / временных паролей / счётчика попыток).
   «Серверное» состояние (матрица прав, временные хеши) остаётся только в памяти страницы — до перезагрузки; после F5 мок-сервер стартует заново. */
function wipeSession() {
  if (!SS) return;
  try { const del = []; for (let i = 0; i < SS.length; i++) { const k = SS.key(i); if (k && k.indexOf('abai.s.') === 0) del.push(k); } del.forEach(k => SS.removeItem(k)); } catch (e) { /* ok */ }
}

/* ======================= публичный API ======================= */
g.UsersDB = Object.freeze({ ENTERPRISE_ADMIN_EMAIL, MAIL_TEMPLATE, RESET_LIMIT_MS, JURY_BASE_URL, PERMS, DEMO,
  jury: Object.freeze(jury), qr: Object.freeze(qr), pin: Object.freeze(pin), devices, countDevice, publicBase,           // вложенные API тоже заморожены: из консоли их методы не подменить
  list: () => USERS.map(pub), find: q => { const u = find(q); return u ? pub(u) : null; },
  juryUser: () => pub(juryAcc()), authenticate, byId, verifySession, reissue, snapshot, restore, resetDemo, wipeSession,
  permsOf: id => { const u = USERS.find(x => x.id === String(id)); return u ? permsOf(u) : null; }, setPerm,
  lockLeft, integrity: clear => { const t = tampered.slice(); if (clear) tampered.length = 0; return t; },
  remainingMs: leftMs, formatRemaining: fmtLeft, formatClock: fmtClock, requestReset, pending, allRequests, resolve, resetLimit,
  drawQR: (cv, text) => g.QRJury.drawQR(cv, g.QRJury.encodeBest(text)) });               // совместимость со старым API
})(window);
