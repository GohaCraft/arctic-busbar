/* ARCTIC BUSBAR AI v2.4.0-prod: tests/unit-core.js
   Модульные проверки ЭТАПА 3 БЕЗ браузера (Node ≥ 18): криптография, токены, «серверная» логика учётных записей (Zero Trust),
   разбор строк железа, пакет плагина, ядро PINN в режимах DEMO и боевом, словарь перевода.
   Запуск (из корня проекта):   node tests/unit-core.js
   Каждая группа выполняется в отдельном процессе (разные DEMO_MODE, чистое состояние); код выхода 0 = всё зелёное. */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const PHASE = (process.argv.find(a => a.indexOf('--phase=') === 0) || '').slice(8);

let pass = 0, fail = 0; const fails = [];
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗ ' + name + (extra ? '  →  ' + extra : '')); } };
const head = t => console.log('\n' + t);

/* ---------- окружение «как в браузере» ---------- */
function env(demo) {
  const et = new EventTarget();
  if (typeof global.CustomEvent === 'undefined') global.CustomEvent = class extends Event { constructor(t, o) { super(t); this.detail = o && o.detail; } };
  if (!global.crypto || !global.crypto.getRandomValues) Object.defineProperty(global, 'crypto', { value: require('crypto').webcrypto, configurable: true });
  Object.assign(global, {
    window: global, addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a), dispatchEvent: e => et.dispatchEvent(e),
    location: { protocol: 'http:', origin: 'http://127.0.0.1:8765', pathname: '/index.html' }, ABAI_CONFIG: { DEMO_MODE: demo }
  });
}
const load = f => require(path.join(ROOT, f));
const hex = b => Buffer.from(b).toString('hex');
const b64u = s => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const flip = (tok, part, fn) => { const a = tok.split('.'); a[part] = fn(a[part]); return a.join('.'); };

/* ======================= ГРУППА 1: криптография и токены ======================= */
function groupCrypto() {
  env(true); load('scripts/core/config.js'); load('scripts/core/crypto-lite.js'); const C = window.CryptoLite;
  head('[1] Криптография: контрольные векторы (SHA-256, HMAC, PBKDF2, TOTP) и JWT-образные токены');
  ok(hex(C.sha256('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256("abc") — вектор FIPS 180-4');
  ok(hex(C.sha256('')) === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'SHA-256("") — пустая строка');
  ok(hex(C.sha256('a'.repeat(1000))) === hex(require('crypto').createHash('sha256').update('a'.repeat(1000)).digest()), 'SHA-256 длинной строки совпадает с node:crypto');
  ok(hex(C.sha256('Привет, Арктика ❄')) === hex(require('crypto').createHash('sha256').update('Привет, Арктика ❄', 'utf8').digest()), 'SHA-256 для UTF-8 (кириллица и символы вне BMP)');
  ok(hex(C.hmac('Jefe', 'what do ya want for nothing?')) === '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843', 'HMAC-SHA256 — RFC 4231, тест 2');
  const salt = Buffer.from('salt');
  ok(hex(C.pbkdf2('password', salt, 1, 32)) === '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b', 'PBKDF2-HMAC-SHA256, 1 раунд — вектор');
  ok(hex(C.pbkdf2('password', salt, 2, 32)) === 'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43', 'PBKDF2-HMAC-SHA256, 2 раунда — вектор');
  ok(hex(C.pbkdf2('password', salt, 4096, 32)) === 'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a', 'PBKDF2-HMAC-SHA256, 4096 раундов — вектор');
  /* RFC 6238, приложение B: SHA-256, секрет 32 байта, T=59 → 46119246 (8 цифр); T=1111111109 → 68084774 */
  const sec = '12345678901234567890123456789012';
  ok(C.totp(sec, 30000, 59000, 8) === '46119246', 'TOTP-SHA256, T=59 → 46119246 (RFC 6238)');
  ok(C.totp(sec, 30000, 1111111109000, 8) === '68084774', 'TOTP-SHA256, T=1111111109 → 68084774 (RFC 6238)');
  ok(/^\d{6}$/.test(C.hotp(sec, 7)) && C.hotp(sec, 7) !== C.hotp(sec, 8), 'HOTP: 6 цифр по умолчанию, разные счётчики → разные коды');
  const h = C.hashPassword('Секрет-123', Buffer.from('0123456789abcdef'), 1000);
  ok(/^\$pbkdf2-sha256\$1000\$[A-Za-z0-9./]+\$[A-Za-z0-9./]+$/.test(h), 'hashPassword → формат passlib «$pbkdf2-sha256$раунды$соль$хеш»', h.slice(0, 40));
  ok(C.verifyPassword('Секрет-123', h) && !C.verifyPassword('секрет-123', h) && !C.verifyPassword('', h) && !C.verifyPassword('Секрет-123', 'plain-text') && !C.verifyPassword('x', ''), 'verifyPassword: верный пароль да, регистр/пусто/не-хеш — нет');
  ok(C.timingSafeEqual('abc', 'abc') && !C.timingSafeEqual('abc', 'abd') && !C.timingSafeEqual('abc', 'abcd') && !C.timingSafeEqual('', 'a'), 'timingSafeEqual: равные и разные строки, разная длина');
  const id1 = C.randomId(9), id2 = C.randomId(9); ok(id1 !== id2 && /^[A-Za-z0-9_-]{12}$/.test(id1), 'randomId: 9 байт → 12 символов base64url, не повторяется', id1);

  const KEY = 'unit-test-key', now = Math.floor(Date.now() / 1000);
  const tok = C.signToken({ typ: 'sess', sub: '1', exp: now + 60 }, KEY);
  ok(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(tok), 'токен = три части base64url');
  ok(C.verifyToken(tok, KEY).ok && C.verifyToken(tok, KEY, { typ: 'sess' }).ok, 'верная подпись и тип → ok');
  ok(C.verifyToken(tok, 'other-key').reason === 'SIGNATURE', 'другой ключ → SIGNATURE');
  ok(C.verifyToken(flip(tok, 1, p => b64u(JSON.stringify(Object.assign(JSON.parse(unb64u(p)), { sub: '2', role: 'admin' })))), KEY).reason === 'SIGNATURE', 'подмена payload без пересчёта подписи → SIGNATURE');
  ok(C.verifyToken(flip(tok, 2, s => (s[0] === 'A' ? 'B' : 'A') + s.slice(1)), KEY).reason === 'SIGNATURE', 'испорченная подпись → SIGNATURE');
  ok(C.verifyToken(b64u('{"alg":"none","typ":"ABAI"}') + '.' + tok.split('.')[1] + '.', KEY).ok === false, 'alg=none с пустой подписью → отказ');
  ok(C.verifyToken(b64u('{"alg":"none","typ":"ABAI"}') + '.' + tok.split('.')[1] + '.' + tok.split('.')[2], KEY).reason === 'ALG', 'alg=none при любой подписи → ALG');
  ok(C.verifyToken(b64u('{"alg":"HS512","typ":"ABAI"}') + '.' + tok.split('.')[1] + '.' + tok.split('.')[2], KEY).reason === 'ALG', 'подмена алгоритма (HS512) → ALG');
  ok(C.verifyToken(tok, KEY, { now: (now + 65) * 1000 }).ok && C.verifyToken(tok, KEY, { now: (now + 66) * 1000 }).reason === 'EXPIRED', 'срок: допуск 5 с, дальше EXPIRED');
  ok(C.verifyToken(C.signToken({ typ: 'sess', sub: '1' }, KEY), KEY).reason === 'EXPIRED', 'токен без exp не принимается (EXPIRED)');
  ok(C.verifyToken(C.signToken({ typ: 'sess', exp: now + 60, nbf: now + 600 }, KEY), KEY).reason === 'NOT_YET', 'nbf в будущем → NOT_YET');
  ok(C.verifyToken(tok, KEY, { typ: 'qr' }).reason === 'TYPE', 'тип токена «sess» не подходит там, где нужен «qr» → TYPE');
  ok(C.verifyToken('', KEY).reason === 'FORMAT' && C.verifyToken('a.b', KEY).reason === 'FORMAT' && C.verifyToken('a.b.c.d', KEY).reason === 'FORMAT' && C.verifyToken(null, KEY).reason === 'FORMAT' && C.verifyToken('x'.repeat(5000), KEY).reason === 'FORMAT', 'мусор, не-строка, слишком длинный → FORMAT');
  ok(C.decodeToken(tok).payload.sub === '1' && C.decodeToken('xx') === null, 'decodeToken читает payload без проверки подписи и не падает на мусоре');
}

/* ======================= ГРУППА 2: «сервер» учётных записей (users-db) ======================= */
async function groupUsers(demo) {
  env(demo); load('scripts/core/config.js'); load('scripts/core/crypto-lite.js'); load('scripts/core/users-db.js'); load('scripts/core/demo-data.js');
  const U = window.UsersDB, C = window.CryptoLite; const ADM = '1073819', OPR = '1073820', JUR = '1073821', PERMS = ['CAN_SWITCH_RELAY', 'CAN_EDIT_PINN', 'CAN_ROLLBACK_LOGS', 'CAN_MANAGE_PLUGINS'];
  head('[' + (demo ? '2' : '3') + '] «Сервер» учётных записей, режим ' + (demo ? 'DEMO_MODE=true' : 'DEMO_MODE=false (боевой)') + ': вход, RBAC по Bearer, QR/PIN, блокировка, бэкап');
  const src = fs.readFileSync(path.join(ROOT, 'scripts/core/users-db.js'), 'utf8');
  ok(!/admin123|operator123|jury123/.test(src) && (src.match(/\$pbkdf2-sha256\$29000\$/g) || []).length === 4, 'в users-db.js нет открытых паролей: только 3 PBKDF2-хеша + заглушка для неизвестных логинов');
  ok(Object.isFrozen(U) && Object.isFrozen(window.ABAI_CONFIG) && U.PERMS.length === 4 && Object.isFrozen(U.PERMS), 'UsersDB, ABAI_CONFIG и список прав заморожены');

  const a = await U.authenticate('eng.rza', 'admin123'), o = await U.authenticate('disp.smena', 'operator123');
  ok(a.ok && o.ok && typeof a.token === 'string', 'вход по паролю (PBKDF2) → токен сессии');
  const va = U.verifySession(a.token), vo = U.verifySession(o.token);
  ok(va.ok && va.payload.role === 'admin' && va.payload.pm.length === 4 && vo.ok && vo.payload.role === 'operator' && vo.payload.pm.length === 0, 'права зашиты в подписанный токен: у админа 4, у диспетчера 0');
  ok((await U.authenticate('eng.rza', 'wrong')).reason === 'BAD_PASS' && (await U.authenticate('nobody', 'x')).reason === 'NO_USER' && (await U.authenticate('', '')).reason === 'EMPTY', 'неверный пароль / неизвестный логин / пустая форма различаются только внутри «сервера»');
  ok((await U.authenticate('ENG.RZA', 'admin123')).ok && (await U.authenticate('1073819', 'admin123')).ok && (await U.authenticate('Левицкий А.Р.', 'admin123')).ok, 'логин, табельный код и ФИО находят один аккаунт (регистр не важен)');
  ok(!(await U.authenticate('eng.rza', 'Admin123')).ok && !(await U.authenticate('eng.rza', 'operator123')).ok, 'пароль регистрозависим и не подходит от чужого аккаунта');

  /* подделка и устаревание токена сессии */
  const t = vo.payload, forgedPm = flip(o.token, 1, p => b64u(JSON.stringify(Object.assign(JSON.parse(unb64u(p)), { pm: PERMS, role: 'admin', sub: ADM }))));
  ok(U.verifySession(forgedPm).reason === 'SIGNATURE', 'токен диспетчера с дописанными правами и ролью admin → SIGNATURE');
  ok(U.verifySession(b64u('{"alg":"none","typ":"ABAI"}') + '.' + o.token.split('.')[1] + '.').ok === false, 'токен alg=none → отказ');
  ok(U.verifySession(C.signToken({ typ: 'qr', sub: ADM, jti: 'x', exp: t.exp }, 'x')).ok === false, 'токен чужого типа / чужого ключа → отказ');
  const realNow = Date.now; Date.now = () => realNow() + 9 * 3600e3; const exp = U.verifySession(a.token); Date.now = realNow;
  ok(exp.reason === 'EXPIRED' && t.exp - t.iat === 8 * 3600, 'сессия живёт 8 часов, через 9 часов → EXPIRED', JSON.stringify([exp.reason, t.exp - t.iat]));

  /* RBAC: только администратор и только по Bearer */
  ok(U.setPerm(OPR, 'CAN_EDIT_PINN', true, o.token).reason === 'FORBIDDEN', 'диспетчер не может выдать права (FORBIDDEN)');
  ok(U.setPerm(OPR, 'CAN_EDIT_PINN', true, '').reason === 'UNAUTHENTICATED' && U.setPerm(OPR, 'CAN_EDIT_PINN', true).reason === 'UNAUTHENTICATED' && U.setPerm(OPR, 'CAN_EDIT_PINN', true, forgedPm).reason === 'UNAUTHENTICATED', 'без токена и с поддельным токеном → UNAUTHENTICATED');
  ok(U.setPerm(JUR, 'CAN_EDIT_PINN', true, a.token).reason === 'BAD_ARGS' && U.setPerm(OPR, 'CAN_ROOT', true, a.token).reason === 'BAD_ARGS', 'жюри — наблюдатель (права не выдаются); неизвестное право отвергается');
  ok(Object.values(U.permsOf(OPR)).every(v => v === false), 'после неудачных попыток у диспетчера по-прежнему 0 прав');
  const r1 = U.setPerm(OPR, 'CAN_EDIT_PINN', true, a.token); ok(r1.ok && r1.old === false && U.permsOf(OPR).CAN_EDIT_PINN === true, 'админ выдаёт право диспетчеру');
  ok(U.verifySession(o.token).payload.pm.length === 0, 'уже выданный токен диспетчера НЕ меняется сам (права обновляются только перевыпуском)');
  const o2 = U.reissue(o.token), v2 = U.verifySession(o2); ok(v2.ok && v2.payload.pm.join() === 'CAN_EDIT_PINN' && v2.payload.sid === vo.payload.sid && v2.payload.exp === vo.payload.exp && v2.payload.iat === vo.payload.iat, 'reissue: новая матрица прав, тот же sid, срок жизни не продлевается');
  ok(U.reissue('garbage') === null && U.reissue(forgedPm) === null, 'reissue поддельного токена невозможен');
  U.setPerm(OPR, 'CAN_EDIT_PINN', false, a.token); ok(Object.isFrozen(U.permsOf(OPR)) && Object.isFrozen(U.list()[0]) && Object.isFrozen(U.list()[0].perms), 'матрица прав и записи пользователей — замороженные объекты');
  ok(Object.isFrozen(U) && Object.isFrozen(U.qr) && Object.isFrozen(U.pin) && Object.isFrozen(U.jury) && (() => { 'use strict'; try { U.qr.issue = () => 1; return false; } catch (e) { return true; } })(), 'UsersDB и вложенные API (qr, pin, jury) заморожены: из консоли методы не подменить');
  ok(U.resolve('PW-X', true, 'x', o.token).reason === 'FORBIDDEN' && U.resolve('PW-X', true, 'x', '').reason === 'UNAUTHENTICATED', 'одобрять заявки на смену пароля может только админ по Bearer');
  if (!demo) ok(U.resetLimit(OPR, o.token).reason === 'FORBIDDEN' && U.resetLimit(OPR, '').reason === 'UNAUTHENTICATED', 'в боевом режиме снять лимит запросов может только админ');

  /* QR: личный токен */
  const q = U.qr.issue(o2); ok(q.ok && /#abai-qr=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(q.url) && q.ttl === 90 && q.exp - Date.now() <= 90500 && /^\d{6}$/.test(q.pin), 'qr.issue(Bearer) → подписанная ссылка в #-части, 90 с, PIN из 6 цифр');
  ok(U.qr.issue('').reason === 'UNAUTHENTICATED' && U.qr.issue(forgedPm).reason === 'UNAUTHENTICATED', 'qr.issue без Bearer / с подделкой отвергается');
  const insp = U.qr.inspect(q.url); ok(insp.typ === 'qr' && insp.sub === OPR, 'токен привязан к аккаунту предъявленной сессии (sub=диспетчер), выпустить код за другого нельзя');
  ok(U.qr.revoke(a.token, q.url).reason === 'FORBIDDEN' && !U.qr.used(q.url), 'чужой код отозвать нельзя (админ не гасит QR диспетчера)');
  const rd = U.qr.redeem(q.url); ok(rd.ok && rd.kind === 'personal' && rd.user.id === OPR && U.verifySession(rd.token).payload.via === 'qr', 'redeem: вход под аккаунтом владельца, способ входа «qr»');
  ok(U.qr.redeem(q.url).reason === 'USED' && U.qr.used(q.url), 'повторное использование того же токена → USED');
  const q2 = U.qr.issue(o2); ok(U.qr.revoke(o2, q2.url).ok && U.qr.redeem(q2.url).reason === 'USED', '«Отозвать код» гасит токен: redeem → USED');
  ok(U.qr.redeem(o.token).reason === 'FORMAT' || U.qr.redeem(o.token).reason === 'TYPE', 'токен СЕССИИ как QR-токен не принимается');
  ok(U.qr.redeem('http://x/?qr_auth=jury_session&code=261126').reason === 'LEGACY' && U.qr.redeem('/?code=123456').reason === 'LEGACY' && U.qr.isLegacy('?uid=1&code=2') === true && U.qr.redeem('').reason === 'FORMAT', 'старые ссылки ?qr_auth=…&code=… → LEGACY; пустое → FORMAT');
  ok(U.qr.redeem(flip(q.token, 2, s => 'A' + s.slice(1))).reason === 'SIGNATURE', 'испорченная подпись в токене из ссылки → SIGNATURE');
  const realNow2 = Date.now; Date.now = () => realNow2() + 100000; const q3e = U.qr.redeem(U.qr.issue(o2).url); Date.now = realNow2;
  ok(q3e.ok === true, 'токен, выпущенный «в будущем», внутри окна принимается (проверка модели времени)');
  const q4 = U.qr.issue(o2).url; Date.now = () => realNow2() + 100000; const e4 = U.qr.redeem(q4); Date.now = realNow2; ok(e4.reason === 'EXPIRED', 'QR старше 90 с (+5 с допуск) → EXPIRED');

  /* PIN */
  ok(U.pin.code(OPR, '') === '' && U.pin.code(OPR) === '' && U.pin.code(ADM, o2) === '' && U.pin.code(OPR, forgedPm) === '', 'PIN-оракула нет: чужой PIN без токена этого же аккаунта получить нельзя');
  const myPin = U.pin.code(OPR, o2); ok(/^\d{6}$/.test(myPin) && myPin === q.pin, 'свой PIN выдаётся только владельцу и совпадает с PIN из qr.issue');
  const pr = U.pin.redeem(myPin); ok(pr.ok && pr.kind === 'personal' && pr.user.id === OPR, 'PIN на экране входа находит именно владельца');
  ok(!U.pin.redeem('12345').ok && U.pin.redeem('12345').reason === 'BAD' && !U.pin.redeem('abcdef').ok, 'PIN не из 6 цифр отвергается');

  /* бэкап не несёт прав и паролей */
  ok(Object.keys(U.snapshot()).sort().join() === 'last,requests', 'snapshot(): только заявки и лимиты — ни прав, ни паролей, ни хешей');
  ok(U.restore({ perms: { [OPR]: { CAN_EDIT_PINN: true, CAN_MANAGE_PLUGINS: true } }, hash: 'x', requests: [], last: {} }) === true && Object.values(U.permsOf(OPR)).every(v => v === false), 'restore(): поле perms из старого/чужого бэкапа игнорируется — права не повышаются');
  ok(U.restore({ requests: [{ id: 'PW-1', status: 'PENDING', userId: OPR, fio: 'x', ts: 1 }, { id: 5, status: 'ROOT' }, null, { id: 'PW-2', status: 'EVIL' }] }) && U.allRequests().length === 1, 'restore(): в заявки попадают только записи нужной формы и статуса');
  ok(U.restore(null) === false && U.restore('x') === false, 'restore(не объект) → false');

  if (demo) {
    ok(U.jury.enabled && /^\d{6}$/.test(U.jury.code()) && U.jury.verify(U.jury.code()) && U.jury.verify('261126') && !U.jury.verify('000000'), 'DEMO: код жюри (TOTP) и универсальный PIN принимаются, чужой — нет');
    const jl = U.jury.link(), jr = U.qr.redeem(jl); ok(/#abai-qr=/.test(jl) && jr.ok && jr.kind === 'jury' && jr.user.id === JUR && U.verifySession(jr.token).payload.pm.length === 0, 'DEMO: ссылка жюри → вход «Эксперт Жюри» без прав');
    ok(U.pin.redeem('261126').ok && U.pin.redeem('261126').kind === 'jury', 'DEMO: универсальный PIN → вход жюри');
    ok(U.jury.login().ok && window.ABAI_DEMO && window.ABAI_DEMO.accounts.length === 3, 'DEMO: тестовый вход жюри и демо-аккаунты для меню [?] доступны');
  } else {
    ok(!U.jury.enabled && U.jury.code() === '' && U.jury.link() === '' && U.jury.token() === '' && U.jury.login().reason === 'DISABLED', 'PROD: витрина жюри отсутствует (код, ссылка, токен, тестовый вход пусты)');
    ok(!U.jury.verify('261126') && U.pin.redeem('261126').reason === 'BAD' && U.pin.redeem('000000').reason === 'BAD', 'PROD: универсальный PIN жюри не принимается');
    ok(typeof window.ABAI_DEMO === 'undefined', 'PROD: demo-data.js ничего не определяет (window.ABAI_DEMO отсутствует)');
  }

  /* блокировка подбора: 5 неудач подряд → пауза 30 с; верный пароль во время паузы тоже отвергается */
  for (let i = 0; i < 5; i++) await U.authenticate('eng.rza', 'bad' + i);
  const lk = await U.authenticate('eng.rza', 'admin123'); ok(lk.reason === 'LOCKED' && lk.retryMs > 20000 && lk.retryMs <= 30000 && U.lockLeft() > 20000, 'после 5 неудач вход заблокирован на ~30 с, верный пароль не проходит', JSON.stringify([lk.reason, lk.retryMs]));
  ok(U.pin.redeem('261126').reason === 'LOCKED' && U.pin.redeem(myPin).reason === 'LOCKED', 'блокировка общая для пароля и PIN (подбор PIN не обходит её)');
  const realNow3 = Date.now; Date.now = () => realNow3() + 31000; const after = await U.authenticate('eng.rza', 'admin123'); Date.now = realNow3;
  ok(after.ok, 'через 30 с блокировка снимается, верный пароль пускает и сбрасывает счётчик');
  for (let i = 0; i < 5; i++) await U.authenticate('eng.rza', 'bad' + i); for (let i = 0; i < 5; i++) { Date.now = () => realNow3() + 40000 + i * 1000; await U.authenticate('eng.rza', 'bad'); } Date.now = realNow3;
  ok(U.lockLeft() > 40000, 'вторая серия неудач удваивает паузу (≈60 с)', String(U.lockLeft()));
}

/* ======================= ГРУППА 3: разбор строк железа ======================= */
function groupHw(demo) {
  env(demo); load('scripts/core/config.js'); load('scripts/app/hardware-link.js'); const H = window.HardwareLink;
  head('[' + (demo ? '4' : '5') + '] Железо, режим ' + (demo ? 'DEMO_MODE=true' : 'DEMO_MODE=false (боевой)') + ': разбор строк UART/WebSocket (parseLine / normalize)');
  let r = H.parseLine('{"t":55.2,"ta":-21,"i":780,"u":110.4,"acc":0.15,"vdc":220,"soc":95}');
  ok(r.kind === 'sample' && r.sample.T === 55.2 && r.sample.Ta === -21 && r.sample.I === 780 && r.sample.U === 110.4 && r.sample.acc === 0.15 && r.sample.vdc === 220 && r.sample.soc === 95, 'JSON-пакет ESP32 → нормализованный образец (T, Ta, I, U, acc, vdc, soc)');
  r = H.parseLine('{"temp":40,"cur":10,"kv":110}'); ok(r.kind === 'sample' && r.sample.T === 40 && r.sample.I === 10 && r.sample.U === 110, 'синонимы полей (temp / cur / kv) понимаются');
  r = H.parseLine('{"t":55,"u":99999,"i":-5,"acc":"x","vdc":null}'); ok(r.kind === 'sample' && r.sample.T === 55 && !('U' in r.sample) && !('I' in r.sample) && !('acc' in r.sample) && !('vdc' in r.sample), 'значения вне диапазона, отрицательный ток, строки и null отбрасываются по одному');
  r = H.parseLine('{"t":1e9}'); ok(r.kind === 'bad' && r.reason === 'EMPTY', 'пакет без валидных полей → bad/EMPTY');
  r = H.parseLine('{"__proto__":{"polluted":1},"constructor":{"x":1},"prototype":2,"t":50}'); ok(r.kind === 'sample' && ({}).polluted === undefined && r.sample.T === 50 && !Object.prototype.hasOwnProperty.call(r.raw, '__proto__') && !Object.prototype.hasOwnProperty.call(r.raw, 'constructor'), 'ключи __proto__ / constructor / prototype вырезаются: загрязнения прототипа нет', JSON.stringify(r.raw));
  const tgt = Object.assign({}, r.raw); ok(Object.getPrototypeOf(tgt) === Object.prototype, 'Object.assign({}, raw) не подменяет прототип получателя');
  ok(H.parseLine('{bad json').reason === 'JSON' && H.parseLine('[1,2]').kind === 'log' && H.parseLine('{"foo":1}').reason === 'EMPTY' && H.parseLine(null).reason === 'TYPE' && H.parseLine(42).reason === 'TYPE' && H.parseLine('   ').kind === 'empty', 'битый JSON / массив / чужие поля / не-строка / пусто');
  ok(H.parseLine('boot: ESP32 ready').kind === 'log' && H.parseLine('x'.repeat(5000)).reason === 'LONG' && H.parseLine('{' + '"t":1,'.repeat(900) + '"i":1}').reason === 'LONG', 'не-JSON строки уходят в лог, слишком длинные (> 4 КБ) отвергаются');
  r = H.parseLine('{"i2c":[90,64,104,0,200,"x",64]}'); ok(r.kind === 'i2c' && r.addrs.join() === '90,64,104,64', 'сканирование I²C: только целые адреса 1–127');
  r = H.parseLine('{"hello":"fw 2.4.1"}'); ok(r.kind === 'hello' && r.fw === 'fw 2.4.1', 'приветствие прошивки');
  r = H.normalize({ t: 20, in1: 1, in2: false, dgu: 0, ats: 2 }); ok(r.T === 20 && r.in1 === true && r.in2 === false && r.dgu === false && r.ats === 2, 'положения ввода / АВР / ДГУ нормализуются в boolean и 1|2');
  ok(H.normalize(null) === null && H.normalize('x') === null && H.normalize({ foo: 1 }) === null && H.normalize({ ats: 3 }) === null, 'normalize(не объект / нет полей / ats вне 1..2) → null');
  ok(Object.isFrozen(H) && H.STALE_MS === 5000, 'HardwareLink заморожен; связь считается потерянной через 5 с тишины');
  if (demo) ok(typeof H._test === 'object' && typeof H._test.feed === 'function', 'DEMO: доступен тестовый вход строки без транспорта (_test.feed)');
  else ok(H._test === undefined, 'PROD: HardwareLink._test отсутствует — подсунуть данные из консоли в обход транспорта нельзя');
}

/* ======================= ГРУППА 3б: пакет плагина ======================= */
async function groupPack() {
  env(true); head('[6] Плагины: проверка папки (PluginPack.validate / fromFileList)');
  window.Store = { plugins: { LIMITS: { files: 24, file: 131072, total: 524288 } } }; load('scripts/app/plugin-pack.js'); const P = window.PluginPack; let r;
  const mf = o => ({ path: 'manifest.json', text: JSON.stringify(o) }), base = { name: 'ab', version: '1.0.0', runtime: 'js' };
  for (const k of ['js', 'py']) { const t = P.template(k), v = P.validate(t, []); ok(v.ok && v.runtime === k && v.entry === (k === 'js' ? 'worker.js' : 'worker.py'), 'встроенный шаблон «' + k + '» проходит проверку', JSON.stringify(v.errors)); }
  r = P.validate([{ path: 'worker.js', text: 'return {alarm:false}' }]); ok(!r.ok && r.errors[0].code === 'MANIFEST_MISSING', 'нет manifest.json → MANIFEST_MISSING');
  r = P.validate([{ path: 'manifest.json', text: '{bad' }]); ok(r.errors[0].code === 'MANIFEST_JSON', 'битый manifest → MANIFEST_JSON');
  r = P.validate([mf({ name: 'a', version: 'x', runtime: 'c' })]); ok(r.errors.filter(e => e.code === 'MANIFEST_FIELD').map(e => e.params.field).join() === 'name,version,runtime', 'поля name / version / runtime проверяются по формату');
  r = P.validate([mf(base)]); ok(r.errors[0].code === 'ENTRY_MISSING', 'нет точки входа → ENTRY_MISSING');
  r = P.validate([mf(base), { path: 'worker.js', text: 'const x = await import("a");\nreturn 1' }]); ok(r.errors.length > 0, 'динамический import в JS-плагине запрещён', JSON.stringify(r.errors.map(e => e.code)));
  r = P.validate([mf(base), { path: 'worker.js', text: 'fetch("x");\nlet a = window.x;\nreturn {alarm:false}' }]); ok(r.ok && r.warnings.filter(w => w.code === 'FORBIDDEN_API').length >= 1, 'fetch / window — предупреждение (песочница всё равно их не даст), плагин не отвергается');
  r = P.validate([{ path: '../evil.js', text: '' }, { path: 'кириллица.js', text: '' }]); ok(r.errors.filter(e => e.code === 'PATH').length === 2, 'пути с «..» и не-ASCII отвергаются (PATH)');
  r = P.validate([mf({ name: 'ab', version: '1.0.0', runtime: 'py', entry: 'worker.js' }), { path: 'worker.js', text: 'x' }]); ok(r.errors.some(e => e.code === 'ENTRY_RUNTIME'), 'entry не соответствует runtime → ENTRY_RUNTIME');
  r = P.validate([mf({ name: 'ab', version: '1.0.0', runtime: 'py' }), { path: 'worker.py', text: 'import os\nx = open("a")\n' }]); ok(r.ok && r.warnings.filter(w => w.code === 'FORBIDDEN_API').length >= 1, 'Python: os / open — предупреждения (исполнение только на сервере, Phase 2)');
  r = P.validate([mf(base), { path: 'worker.js', text: 'x'.repeat(131073) }]); ok(r.errors.some(e => e.code === 'FILE_BIG'), 'файл больше 128 КБ → FILE_BIG');
  r = P.validate([mf(Object.assign({}, base, { name: '__proto__' })), { path: 'worker.js', text: 'return {alarm:false}' }]); ok(r.ok === false || r.errors.length > 0 || r.warnings.length >= 0, 'имя «__proto__» не ломает проверку (проверка завершается, без исключения)');
  const mk = (p, t) => ({ webkitRelativePath: p, name: p.split('/').pop(), size: t.length, text: async () => t });
  const res = await P.fromFileList([mk('plug/manifest.json', '﻿{"name":"ab"}'), mk('plug/worker.js', 'return 1'), mk('plug/node_modules/x.js', '1'), mk('plug/img.png', 'bin'), mk('plug/.git/config', 'x')]);
  ok(res.root === 'plug' && res.files.length === 2 && !res.files[0].text.startsWith('﻿') && res.skipped.length === 3, 'fromFileList: корень папки, BOM снят, node_modules / .git / картинки пропущены', JSON.stringify(res.skipped));
}

/* ======================= ГРУППА 4: ядро PINN ======================= */
function groupPinn(demo) {
  env(demo); head('[' + (demo ? '7' : '8') + '] Ядро PINN, режим ' + (demo ? 'DEMO_MODE=true' : 'DEMO_MODE=false (боевой)') + ': источники данных, фильтр спуфинга, ложная тревога, АВР, потеря связи');
  const plug = { 'PINN-KIRCHHOFF-GUARD': { params: { hold_s: 6 } }, 'ATS-AUTO-TRANSFER': { params: { rul_min: 15 } }, 'IEC61850-RX-TAP': { params: {} }, 'LWIR-BLIZZARD-FILTER': { params: {} }, 'LTO-DGU-STARTER': { params: { start_delay_s: 3 } } };
  global.Store = { plugins: { enabled: id => !!plug[id], get: id => plug[id] || null, list: () => [] }, thr: { all: () => ({ T_max: 85, I_max: 1250, A_max: 0.8, U_min: 198 }) }, get: k => (k === 'tele' ? 4 : null) };
  const sent = []; global.HardwareLink = { isFresh: () => false, send: async x => { sent.push(x); return true; } };
  global.PluginHost = { sync() {}, tick() {}, stop() {}, onResult() {} };
  load('scripts/core/config.js'); load('scripts/app/pinn-simulator.js');
  const P = window.PINN, S = P.state(); window.dispatchEvent(new CustomEvent('abai:auth', { detail: { type: 'login' } }));
  if (demo) {
    ok(S.source === 'sim' && S.have.T === true && P.series('temp').t.length > 200, 'DEMO: без железа работает симулятор, история графиков предзаполнена', S.source + ' / ' + P.series('temp').t.length);
    ok(P.scenario('heat') === true, 'DEMO: сценарий «Нагрев» разрешён'); P.scenario('reset');
  } else {
    ok(S.source === 'none' && S.have.T === false && P.series('temp').t.length === 0, 'PROD: после входа источник «none», датчиков и истории нет (OFFLINE)', S.source);
    ok(P.scenario('heat') === false && P.scenario('spoof') === false && P.scenario('blackout') === false, 'PROD: сценарии испытаний отвергаются');
    ok(P.act('transfer').reason === 'OFFLINE', 'PROD: переключение АВР без оборудования отказывает (OFFLINE)');
    ok(!P.isLive() && !S.alarm.active, 'PROD: без данных нет ни «живого» состояния, ни тревоги');
  }
  const t0 = Date.now(), feed = (i, T, ts) => window.dispatchEvent(new CustomEvent('abai:hw', { detail: { type: 'sample', sample: { T, Ta: -20, I: i, U: 110, acc: 0.15, ts } } }));
  for (let k = 0; k < 20; k++) feed(780, 42.4 + (k % 3) * 0.1, t0 + k * 250);
  ok(S.source === 'hw' && S.have.T && S.have.I && S.have.U && S.have.acc && !S.have.vdc && !S.have.freq, 'пакеты железа переключают источник на «hw»; есть только полученные величины', JSON.stringify(S.have));
  ok(S.have.Rk && S.Rk > 12 && S.Rk < 17, 'R_k считается по измерениям (T, I, U), а не берётся из симулятора', S.Rk.toFixed(2));
  ok(S.status['MLX90614-IR-01'] === 'ok' && S.status['LTO-BAT-BUF'] === 'off', 'статусы датчиков: есть сигнал → ok, нет сигнала → off', JSON.stringify(S.status));
  ok(P.series('temp').t.length >= 3 && P.series('volt').t.length >= 3 && P.series('vdc').t.length === 0, 'ряды графиков только для реально полученных величин');
  feed(780, 78, t0 + 5100); feed(780, 78.5, t0 + 5350);
  ok(S.guard.active && S.T < 50 && S.Traw > 70, 'скачок T до 78 °C при токе 780 А — спуфинг: оценка удержана', 'T=' + S.T.toFixed(1) + ' raw=' + S.Traw);
  ok(!S.alarm.active, 'ложный скачок не поднимает тревогу');
  let T = 45, ts = t0 + 6000; for (let k = 0; k < 120; k++) { T += 0.9; ts += 250; feed(780, T, ts); }
  ok(S.alarm.active && S.alarm.kind === 'heat', 'устойчивый рост температуры поднимает тревогу «heat»', S.alarm.kind + ' T=' + S.T.toFixed(1));
  ok(S.ats === 'closed' && sent.some(x => x.cmd === 'ats' && x.to === 2), 'АВР: команда переключения на ввод 2 отправлена в железо', JSON.stringify(sent.slice(0, 2)));
  window.dispatchEvent(new CustomEvent('abai:hw', { detail: { type: 'sample', sample: { T: 40, I: 0, U: 0, ts: ts + 600 } } }));
  ok(S.alarm.active, 'пропажа напряжения и тока — тревога не гаснет', S.alarm.kind);
  window.dispatchEvent(new CustomEvent('abai:hw', { detail: { type: 'stale' } }));
  if (demo) ok(S.source === 'sim' && S.have.T === true, 'DEMO: связь с железом потеряна → возврат к симулятору'); else ok(S.source === 'none' && S.have.T === false, 'PROD: связь потеряна → снова OFFLINE, цифры не выдумываются');
  window.dispatchEvent(new CustomEvent('abai:auth', { detail: { type: 'logout' } }));
  ok(!S.running && S.source === 'none' && !P.isRunning(), 'выход из системы останавливает ядро и сбрасывает источник');
}

/* ======================= ГРУППА 5: словарь перевода ======================= */
function groupI18n() {
  head('[9] Словарь перевода: колонки, плейсхолдеры, алфавиты, покрытие ключей');
  const rows = fs.readFileSync(path.join(ROOT, 'tools/i18n/dict.psv'), 'utf8').split('\n').filter(l => l.trim() && l[0] !== '#').map(l => l.split('|'));
  const L = ['ru', 'en', 'zh', 'kk', 'be', 'uk']; const cyr = /[А-Яа-яЁёІіЇїЄєҐґҚқҒғҢңӨөҰұҮүҺһӘәЎў]/;
  ok(rows.length > 600 && rows.every(r => r.length === 7), 'в словаре ' + rows.length + ' ключей, в каждой строке ровно 7 колонок (ключ + 6 языков)', rows.filter(r => r.length !== 7).slice(0, 3).map(r => r[0]).join(','));
  ok(new Set(rows.map(r => r[0])).size === rows.length, 'ключи уникальны', '');
  ok(rows.every(r => r.slice(1).every(v => v.trim().length > 0)), 'нет пустых переводов');
  const ph = v => (v.match(/\{(\w+)\}/g) || []).sort().join(), tag = v => (v.match(/<\/?b>/g) || []).length;
  const badPh = rows.filter(r => new Set(r.slice(1).map(ph)).size > 1 || new Set(r.slice(1).map(tag)).size > 1).map(r => r[0]);
  ok(badPh.length === 0, 'плейсхолдеры {…} и теги <b> одинаковы во всех 6 языках', badPh.slice(0, 5).join(','));
  const cyrEnZh = rows.filter(r => cyr.test(r[2]) || cyr.test(r[3])).map(r => r[0]);
  ok(cyrEnZh.length === 0, 'в английской и китайской колонках нет кириллицы', cyrEnZh.slice(0, 6).join(','));
  const noCyr = rows.filter(r => [1, 4, 5, 6].some(i => /[A-Za-zА-Яа-я]/.test(r[i]) && !cyr.test(r[i]) && /^[^A-Za-z]*$/.test(r[i]))).map(r => r[0]);
  ok(noCyr.length === 0, 'в RU / KK / BE / UK нет значений, где слова написаны латиницей вместо кириллицы целиком', noCyr.slice(0, 6).join(','));
  const same = rows.filter(r => r[1] === r[2] && /[А-Яа-я]/.test(r[1])).map(r => r[0]);
  ok(same.length === 0, 'английская колонка не скопирована с русской');
  const letters = v => (v.match(/[A-Za-zА-Яа-яЁёІіЇїЄєҐґҚқҒғҢңӨөҰұҮүҺһӘәЎў]/g) || []).length;
  /* Строки, которые намеренно совпадают с русской: названия тем и фильтра (бренд), термины и слова, одинаково пишущиеся на RU / BE / UK / KK
     («шлюз», «сервер», «симуляция», «недоступна»). Список проверен вручную; новая непереведённая строка в него не попадёт и провалит проверку. */
  const SAME_OK = {
    kk: ['th.amber', 'th.light', 'kv.guard', 'core.sim'],
    be: ['th.amber', 'th.light', 'kv.guard', 'p.lang.py', 'hw.ws.h', 'hw.g5.h'],
    uk: ['th.amber', 'th.light', 'kv.guard', 'p.lang.py', 'hw.ws.h', 'hw.g5.h', 'cam.fail']
  };
  const copied = lang => rows.filter(r => letters(r[1]) >= 14 && r[lang] === r[1]).map(r => r[0]);
  ['kk', 'be', 'uk'].forEach(l => { const c = copied(L.indexOf(l) + 1).filter(k => SAME_OK[l].indexOf(k) < 0); ok(c.length === 0, 'колонка ' + l.toUpperCase() + ': нет длинных строк, скопированных с русской без перевода', c.slice(0, 6).join(',')); });
  const be = rows.filter(r => /[иИщЩъЪ]/.test(r[5])).map(r => r[0]);
  ok(be.length === 0, 'в белорусской колонке нет букв «и», «щ», «ъ» (в белорусском их нет: «і», «шч», апостроф)', be.slice(0, 8).join(','));
  const uk = rows.filter(r => /[ыЫэЭъЪёЁ]/.test(r[6])).map(r => r[0]);
  ok(uk.length === 0, 'в украинской колонке нет русских «ы э ъ ё»', uk.slice(0, 8).join(','));
  const KZ = /[әіңғүұқөһӘІҢҒҮҰҚӨҺ]/, kzRu = rows.filter(r => letters(r[4]) >= 45 && !KZ.test(r[4])).map(r => r[0]);
  ok(kzRu.length === 0, 'казахская колонка: в длинных строках есть казахские буквы (ә і ң ғ ү ұ қ ө һ), то есть это не русский текст', kzRu.slice(0, 8).join(','));
  /* Белорусская фонетика: слово на «у» после согласной и после паузы пишется «у», после гласной — «ў» (чередование у/ў) */
  const VW = 'аеёіоуыэюяАЕЁІОУЫЭЮЯ', CN = 'бвгдджзйклмнпрстфхцчшьБВГДЖЗЙКЛМНПРСТФХЦЧШ', euph = [];
  rows.forEach(r => { const s = r[5], re = /(?<![А-Яа-яЁёІіЎў'ʼ])([уўУЎ])(?=[А-Яа-яЁёІіЎў'ʼ]|\s)/g; let m; while ((m = re.exec(s))) { let j = m.index - 1; while (j >= 0 && s[j] === ' ') j--; let exp; if (j < 0) exp = 'у'; else { const p = s[j]; if (',;:.—-(«"!?'.indexOf(p) >= 0) exp = 'у'; else if (VW.indexOf(p) >= 0) exp = 'ў'; else if (CN.indexOf(p) >= 0) exp = 'у'; else continue; } if (m[1].toLowerCase() !== exp) euph.push(r[0] + ':«' + s.slice(Math.max(0, m.index - 10), m.index + 8) + '»'); } });
  ok(euph.length === 0, 'белорусская орфография: «у» после согласной и паузы, «ў» после гласной (чередование у/ў)', euph.slice(0, 5).join(' | '));
  const ukFF = rows.filter(r => /(^|[^А-Яа-яІіЇїЄєҐґ])[Пп]оказ($|[^А-Яа-яІіЇїЄєҐґ])/.test(r[6])).map(r => r[0]);
  ok(ukFF.length === 0, 'украинская колонка: «показ» (демонстрация) не используется вместо «показання» (показание прибора)', ukFF.join(','));
  const zhParen = rows.filter(r => /\([^)]*[一-鿿][^)]*\)/.test(r[3])).map(r => r[0]);
  ok(zhParen.length === 0, 'китайская колонка: скобки вокруг китайского текста — полноширинные （ ）', zhParen.join(','));
  const mixed = []; rows.forEach(r => r.slice(1).forEach((v, i) => { (v.match(/[A-Za-zА-Яа-яЁёІіЇїЄєҐґҚқҒғҢңӨөҰұҮүҺһӘәЎў]+/g) || []).forEach(w => { if (/[A-Za-z]/.test(w) && /[А-Яа-яЁёІіЇїЄєҐґҚқҒғҢңӨөҰұҮүҺһӘәЎў]/.test(w) && !/^(кВ|кВт|мкОм|мОм|мкс|мс|кА|мА|Гц|кГц|МГц|Вт|кВА|°C)$/.test(w)) mixed.push(r[0] + '/' + L[i] + ':' + w); }); }));
  ok(mixed.length === 0, 'нет слов-«химер» с латинскими и кириллическими буквами вперемешку (омоглифы в переводах)', mixed.slice(0, 8).join(' '));
  const bd = cp.spawnSync('python3', [path.join(ROOT, 'tools/i18n/build.py'), '--check'], { encoding: 'utf8' });
  ok(bd.status === 0, 'python3 tools/i18n/build.py --check: все ключи из HTML и скриптов есть в словаре', (bd.stdout + bd.stderr).split('\n').filter(l => /ОШИБК|ERROR|нет в словаре/i.test(l)).slice(0, 3).join(' | '));
  const built = fs.readFileSync(path.join(ROOT, 'scripts/core/i18n.js'), 'utf8');
  ok(rows.every(r => built.indexOf('"' + r[0] + '"') >= 0) && L.length === 6, 'scripts/core/i18n.js собран из актуального словаря (каждый ключ на месте)');
}

/* ======================= запуск ======================= */
(async () => {
  if (PHASE) {                                                                    // дочерний процесс: одна группа
    if (PHASE === 'crypto') groupCrypto(); else if (PHASE === 'users-demo') await groupUsers(true); else if (PHASE === 'users-prod') await groupUsers(false);
    else if (PHASE === 'hw-demo') groupHw(true); else if (PHASE === 'hw-prod') groupHw(false); else if (PHASE === 'pack') await groupPack(); else if (PHASE === 'pinn-demo') groupPinn(true); else if (PHASE === 'pinn-prod') groupPinn(false); else if (PHASE === 'i18n') groupI18n();
    console.log('##RESULT ' + pass + ' ' + fail); if (fail) console.log('##FAILS ' + JSON.stringify(fails)); process.exit(fail ? 1 : 0);
  }
  let P = 0, F = 0; const all = [];
  for (const ph of ['crypto', 'users-demo', 'users-prod', 'hw-demo', 'hw-prod', 'pack', 'pinn-demo', 'pinn-prod', 'i18n']) {
    const r = cp.spawnSync(process.execPath, [__filename, '--phase=' + ph], { encoding: 'utf8', timeout: 240000 });
    process.stdout.write(r.stdout.replace(/##RESULT.*\n/g, '').replace(/##FAILS.*\n/g, '')); if (r.stderr) process.stdout.write(r.stderr);
    const m = /##RESULT (\d+) (\d+)/.exec(r.stdout); if (m) { P += +m[1]; F += +m[2]; } else { F++; all.push('группа ' + ph + ' аварийно завершена (код ' + r.status + ')'); }
    const f = /##FAILS (.*)/.exec(r.stdout); if (f) all.push(...JSON.parse(f[1]));
  }
  console.log('\n==== ИТОГ (юнит-проверки этапа 3): ' + P + ' ✓ / ' + F + ' ✗ ====');
  if (all.length) { console.log('ПРОВАЛЫ:'); all.forEach(x => console.log(' - ' + x)); }
  process.exit(F ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
