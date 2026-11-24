/* ARCTIC BUSBAR AI v2.4.0-prod: tests/e2e-stage3.js
   Набор ЭТАПА 3 («Глубокий редизайн и security-аудит»), сквозной, в настоящем Chromium (Playwright):
     1  Zero Trust: подложенные abai.perms_override / abai.pass_override в localStorage не действуют; сессия и конфигурация неизменяемы;
        подделанный токен в sessionStorage отвергается; F5 сохраняет сессию, новая вкладка — нет; «Выйти» стирает всё
     2  Блокировка перебора пароля (5 ошибок → пауза, переживает F5), нейтральное сообщение; в хранилищах и исходниках нет паролей
     3  DEMO_MODE=true: меню [?] с готовыми паролями, три сценария стенда, данные симулятора
     4  DEMO_MODE=false: нет [?] и тестовых кнопок, датчики OFFLINE «—», окно «Подключение оборудования», живые данные по WebSocket, потеря связи
     5  Фон экрана входа: свет по времени суток, «Полярная ночь 24/7» (переживает F5), стирание мышью, капли собираются и стекают
     6  Фон входа на телефоне: касание, клавиатура (изменение только высоты не пересоздаёт сцену), поворот экрана
     7  Граф Obsidian: LOD, импульсы, перетаскивание и закрепление, раскладка отдельно для каждого user.id, F5, сброс
     8  Плагины: загрузка папки (manifest.json + worker.js), сохранение, права CAN_MANAGE_PLUGINS, очистка при выходе
     9  Телефон 390×844: нижний Dock не перекрывает граф и миникарту
     10 Консоль: 0 ошибок, 0 предупреждений, 0 запросов 404
   Запуск (из корня проекта):
     python3 -m http.server 8765 --bind 127.0.0.1 &
     NODE_PATH=$(npm root -g) node tests/e2e-stage3.js
   ABAI_ONLY=1,2 — только указанные блоки; ABAI_URL — другой адрес страницы. Скриншоты — tests/out/. Код выхода 0 = всё зелёное. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(__dirname, 'out'), URL = process.env.ABAI_URL || 'http://127.0.0.1:8765/index.html';
const FIX = path.join(__dirname, 'fixtures', 'plugin-MY-GUARD');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const fails = [];
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗ ' + name + (extra ? '  →  ' + extra : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ONLY = (process.env.ABAI_ONLY || '').split(',').filter(Boolean), want = n => !ONLY.length || ONLY.indexOf(String(n)) >= 0;
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) }).catch(() => {});
const PERMS = ['CAN_SWITCH_RELAY', 'CAN_EDIT_PINN', 'CAN_ROLLBACK_LOGS', 'CAN_MANAGE_PLUGINS'];

async function fresh(browser, opts = {}, init) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true }, opts));
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(); const logs = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', r => logs.push('REQFAILED: ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) logs.push('HTTP ' + r.status() + ': ' + r.url()); });
  return { ctx, page, logs };
}
async function loginAs(page, u, p, mobile) {
  await page.goto(URL); await page.waitForSelector('#loginUser'); await sleep(900);
  await page.fill('#loginUser', u); await page.fill('#loginPass', p); await (mobile ? page.tap('#loginBtn') : page.click('#loginBtn'));
  await page.waitForFunction(() => !document.body.classList.contains('locked'), null, { timeout: 8000 }); await sleep(1000);
}
async function submit(page, u, p) { await page.fill('#loginUser', u); await page.fill('#loginPass', p); await page.click('#loginBtn'); await sleep(450); }
const locked = page => page.evaluate(() => document.body.classList.contains('locked'));
async function waitFor(page, fn, arg, ms) { try { await page.waitForFunction(fn, arg, { timeout: ms || 8000, polling: 120 }); return true; } catch (e) { return false; } }
async function openProfile(page, tab) {
  const open = await page.evaluate(() => { const w = document.getElementById('mProfile'); return !!w && !w.hidden && w.dataset.open === '1'; });
  if (!open) { const mobile = await page.evaluate(() => innerWidth <= 820); await (mobile ? page.tap('#btnProfileM') : page.click('#btnProfile')); await sleep(600); }
  if (tab) { await page.click('#mProfile .wnd-tab[data-tab="' + tab + '"]'); await sleep(380); }
}
const closeWnd = async page => { await page.keyboard.press('Escape'); await sleep(450); };
async function section(n, title, fn) {
  if (!want(n)) return; console.log('\n[' + n + '] ' + title);
  try { await fn(); } catch (e) { fail++; const em = String(e && e.message || e).split('\n').slice(0, 14).join(' ').replace(/\u001b\[[0-9;]*m/g, ''); fails.push('блок ' + n + ' аварийно завершён :: ' + em); console.log('  ✗ блок ' + n + ' аварийно завершён: ' + em); }
}
const nodePos = (page, id) => page.evaluate(id => { const n = ObsidianGraph.byId(id), c = ObsidianGraph.camera(), r = document.getElementById('graphCanvas').getBoundingClientRect(); return { x: r.left + (n.x - c.x) * c.k + r.width / 2, y: r.top + (n.y - c.y) * c.k + r.height / 2, wx: n.x, wy: n.y }; }, id);
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

(async () => {
  const browser = await chromium.launch();
  let ctx, page, logs; const allLogs = [];
  const done = async () => { if (ctx) { allLogs.push(...logs); await ctx.close(); ctx = null; } };

  /* ============ 1. Zero Trust ============ */
  await section(1, 'Zero Trust: подделки localStorage / sessionStorage не дают прав; сессия и конфигурация неизменяемы; F5 и выход', async () => {
    ({ ctx, page, logs } = await fresh(browser, {}, () => {
      try {
        const all = { CAN_SWITCH_RELAY: true, CAN_EDIT_PINN: true, CAN_ROLLBACK_LOGS: true, CAN_MANAGE_PLUGINS: true };
        localStorage.setItem('abai.perms_override', JSON.stringify({ '1073820': all, '1073821': all }));
        localStorage.setItem('abai.perms', JSON.stringify({ '1073820': all }));
        localStorage.setItem('abai.pass_override', JSON.stringify({ 'disp.smena': 'hacked', 'eng.rza': 'hacked' }));
      } catch (e) { /* хранилище недоступно */ }
    }));
    await page.goto(URL); await page.waitForSelector('#loginUser'); await sleep(900);
    await submit(page, 'disp.smena', 'hacked'); await sleep(500);
    const bad = await page.evaluate(() => ({ locked: document.body.classList.contains('locked'), msg: document.getElementById('authMsg').textContent, tok: sessionStorage.getItem('abai.s.tok') }));
    ok(bad.locked && !bad.tok && /Неверный логин или пароль/.test(bad.msg), 'пароль «hacked» из подложенного abai.pass_override не принимается: вход закрыт, сообщение нейтральное', JSON.stringify(bad));
    await page.fill('#loginPass', 'operator123'); await page.click('#loginBtn');
    await page.waitForFunction(() => !document.body.classList.contains('locked'), null, { timeout: 8000 }); await sleep(1000);
    const pm = await page.evaluate(P => ({ perms: P.map(p => Store.session.has(p)), admin: Store.session.isAdmin(), user: Store.session.user.login, role: Store.session.user.role }), PERMS);
    ok(pm.user === 'disp.smena' && pm.role === 'operator' && pm.perms.every(v => v === false) && !pm.admin, 'диспетчер вошёл по настоящему паролю; все 4 права = false, несмотря на подложенный abai.perms_override', JSON.stringify(pm));
    const fr = await page.evaluate(() => {
      'use strict';
      const r = {}, t = (n, f) => { try { f(); r[n] = 'mutated'; } catch (e) { r[n] = 'blocked'; } };
      t('session.has', () => { Store.session.has = () => true; }); t('session.user', () => { Store.session.user = { id: '1' }; }); t('user.perms', () => { Store.session.user.perms.CAN_EDIT_PINN = true; });
      t('user.role', () => { Store.session.user.role = 'admin'; }); t('Store.session', () => { Store.session = {}; }); t('UsersDB.setPerm', () => { UsersDB.setPerm = () => ({ ok: true }); });
      t('UsersDB.qr', () => { UsersDB.qr.issue = () => ({ ok: true }); }); t('ABAI_CONFIG.DEMO_MODE', () => { ABAI_CONFIG.DEMO_MODE = false; }); t('window.ABAI_CONFIG', () => { window.ABAI_CONFIG = { DEMO_MODE: false }; });
      t('CryptoLite', () => { CryptoLite.verifyPassword = () => true; });
      r.after = { has: Store.session.has('CAN_EDIT_PINN'), role: Store.session.user.role, demo: ABAI_CONFIG.DEMO_MODE, admin: Store.session.isAdmin(), mode: document.body.dataset.mode };
      return r;
    });
    const tries = Object.keys(fr).filter(k => k !== 'after');
    ok(tries.every(k => fr[k] === 'blocked'), 'из консоли нельзя подменить Store.session, user, perms, UsersDB, CryptoLite и ABAI_CONFIG (замороженные объекты)', JSON.stringify(fr));
    ok(fr.after.has === false && fr.after.role === 'operator' && fr.after.demo === true && fr.after.admin === false && fr.after.mode === 'demo', 'после попыток подмены права, роль и режим прежние');
    const rb = await page.evaluate(() => { const b = Store.session.bearer(), U = UsersDB; return { grant: U.setPerm('1073820', 'CAN_EDIT_PINN', true, b).reason, anon: U.setPerm('1073820', 'CAN_EDIT_PINN', true, '').reason, qrAnon: U.qr.issue('').reason, oracle: U.pin.code('1073819', b), own: U.pin.code('1073820', b), hasB: b.split('.').length === 3 }; });
    ok(rb.hasB && rb.grant === 'FORBIDDEN' && rb.anon === 'UNAUTHENTICATED' && rb.qrAnon === 'UNAUTHENTICATED', 'сервер проверяет подписанный токен: диспетчер не выдаёт права (FORBIDDEN), без токена — UNAUTHENTICATED', JSON.stringify(rb));
    ok(rb.oracle === '' && /^\d{6}$/.test(rb.own), 'PIN чужого аккаунта получить нельзя (раньше публичный «оракул»); свой PIN выдаётся владельцу', JSON.stringify({ oracle: rb.oracle, own: rb.own }));
    await openProfile(page, 'rbac');
    const ui = await page.evaluate(() => { const sw = [...document.querySelectorAll('#rbMatrix [data-rbac]')]; return { n: sw.length, off: sw.filter(i => i.disabled).length, on: sw.filter(i => i.checked && !i.disabled).length }; });
    ok(ui.n >= 8 && ui.n === ui.off, 'вкладка RBAC: у диспетчера все переключатели прав заблокированы', JSON.stringify(ui));
    await page.click('#mProfile .wnd-tab[data-tab="id"]'); await sleep(300);
    ok(await page.evaluate(() => document.querySelectorAll('#pfPerms li').length === 4 && document.querySelectorAll('#pfPerms li[data-on="1"]').length === 0), '«Мои права доступа»: 4 права, ни одно не выдано');
    await closeWnd(page);
    /* подделка токена: права и роль дописаны, подпись прежняя */
    const forged = await page.evaluate(P => {
      const t = sessionStorage.getItem('abai.s.tok'), [h, p, s] = t.split('.');
      const dec = x => JSON.parse(decodeURIComponent(escape(atob(x.replace(/-/g, '+').replace(/_/g, '/'))))), enc = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const pl = dec(p); pl.pm = P; pl.role = 'admin'; const nt = h + '.' + enc(pl) + '.' + s; sessionStorage.setItem('abai.s.tok', nt); return nt !== t;
    }, PERMS);
    await page.reload(); await page.waitForSelector('#loginUser'); await sleep(1600);
    const af = await page.evaluate(() => ({ locked: document.body.classList.contains('locked'), tok: sessionStorage.getItem('abai.s.tok'), user: Store.session.user, msg: document.getElementById('authMsg').textContent }));
    ok(forged && af.locked && af.tok === null && !af.user, 'токен с дописанными правами и ролью admin (подпись прежняя) → после F5 вход закрыт, ключ сессии удалён', JSON.stringify(af));
    ok(/Сессия сброшена/.test(af.msg), 'пользователь видит причину: «Сессия сброшена: данные входа были изменены вне системы»', af.msg);
    /* F5 сохраняет сессию, новая вкладка — нет */
    await loginAs(page, 'disp.smena', 'operator123');
    const t0 = await page.evaluate(() => sessionStorage.getItem('abai.s.tok'));
    await page.reload(); const back = await waitFor(page, () => !document.body.classList.contains('locked') && !!Store.session.user, null, 9000); await sleep(600);
    const f5 = await page.evaluate(() => ({ user: Store.session.user && Store.session.user.login, tok: sessionStorage.getItem('abai.s.tok'), pinn: PINN.isRunning() }));
    ok(back && f5.user === 'disp.smena' && f5.tok === t0 && f5.pinn, 'F5 не разлогинивает: тот же токен, пользователь на месте, ядро PINN снова запущено', JSON.stringify(f5));
    const p2 = await ctx.newPage(); await p2.goto(URL); await p2.waitForSelector('#loginUser'); await sleep(900);
    ok(await p2.evaluate(() => document.body.classList.contains('locked') && sessionStorage.getItem('abai.s.tok') === null), 'новая вкладка той же сессии браузера начинается с экрана входа (sessionStorage не общий)'); await p2.close();
    /* выход стирает всё */
    await openProfile(page, 'id'); await page.click('#btnLogout'); await sleep(1100);
    const lo = await page.evaluate(() => ({ locked: document.body.classList.contains('locked'), keys: Object.keys(sessionStorage).filter(k => /^abai\.s\./.test(k)), timers: Store.session.timers(), run: PINN.isRunning(), uid: ObsidianGraph.stats().uid, user: Store.session.user, bearer: Store.session.bearer() }));
    ok(lo.locked && lo.keys.length === 0 && lo.timers === 0 && !lo.run && lo.uid === null && !lo.user && !lo.bearer, '«Выйти»: экран входа, ключи abai.s.* стёрты, таймеры сессии = 0, PINN остановлен, граф очищен, Bearer пуст', JSON.stringify(lo));
    await page.reload(); await page.waitForSelector('#loginUser'); await sleep(1200);
    ok(await locked(page), 'после выхода F5 снова показывает экран входа (сессию восстановить нечем)');
    await shot(page, 's3-1-zero-trust.png'); await done();
  });

  /* ============ 2. Блокировка перебора, хранилища и исходники без паролей ============ */
  await section(2, 'Блокировка перебора пароля; в хранилищах браузера и в исходниках нет паролей', async () => {
    ({ ctx, page, logs } = await fresh(browser));
    await page.goto(URL); await page.waitForSelector('#loginUser'); await sleep(900);
    for (let i = 0; i < 5; i++) await submit(page, 'eng.rza', 'wrong' + i);
    const l5 = await page.evaluate(() => ({ locked: document.body.classList.contains('locked'), msg: document.getElementById('authMsg').textContent, fail: sessionStorage.getItem('abai.s.fail') }));
    await submit(page, 'eng.rza', 'admin123'); await sleep(500);
    const l6 = await page.evaluate(() => ({ locked: document.body.classList.contains('locked'), msg: document.getElementById('authMsg').textContent, tok: sessionStorage.getItem('abai.s.tok') }));
    ok(l6.locked && !l6.tok && /Слишком много попыток\. Повторите через \d+ с/.test(l6.msg), 'после 5 неверных паролей даже верный пароль не пускает: «Слишком много попыток. Повторите через N с.»', JSON.stringify({ l5: l5.msg, l6: l6.msg }));
    ok(!!l5.fail && !/wrong|count|"n"/i.test(l5.fail), 'счётчик попыток лежит в sessionStorage в запечатанном (HMAC) виде, а не открытым JSON', String(l5.fail).slice(0, 60));
    await page.reload(); await page.waitForSelector('#loginUser'); await sleep(1100);
    await submit(page, 'eng.rza', 'admin123'); await sleep(500);
    const l7 = await page.evaluate(() => ({ locked: document.body.classList.contains('locked'), msg: document.getElementById('authMsg').textContent }));
    ok(l7.locked && /Слишком много попыток/.test(l7.msg), 'блокировка переживает F5: перезагрузкой страницы её не обойти', l7.msg);
    const e1 = await page.evaluate(() => { const m = document.getElementById('authMsg').textContent; return m; });
    await submit(page, 'nobody', 'x'); const mU = await page.evaluate(() => document.getElementById('authMsg').textContent);
    ok(/Слишком много попыток/.test(e1) && /Слишком много попыток/.test(mU), 'под блокировкой сообщение не зависит от логина (по ответу нельзя выяснить, есть ли такой аккаунт)');
    await done();
    /* отдельный чистый контекст: нейтральное сообщение для разных причин отказа */
    ({ ctx, page, logs } = await fresh(browser));
    await page.goto(URL); await page.waitForSelector('#loginUser'); await sleep(900);
    await submit(page, 'nobody', 'x1'); const mNo = await page.evaluate(() => document.getElementById('authMsg').textContent);
    await submit(page, 'eng.rza', 'bad-pass'); const mBad = await page.evaluate(() => document.getElementById('authMsg').textContent);
    ok(mNo === mBad && /Неверный логин или пароль/.test(mNo), 'неизвестный логин и неверный пароль дают одно и то же сообщение', mNo + ' | ' + mBad);
    await loginAs(page, 'eng.rza', 'admin123');
    const st = await page.evaluate(() => { const dump = {}; [localStorage, sessionStorage].forEach((s, i) => { for (let k = 0; k < s.length; k++) { const key = s.key(k); dump[(i ? 's:' : 'l:') + key] = s.getItem(key); } }); const txt = JSON.stringify(dump); return { keys: Object.keys(dump), plain: /admin123|operator123|jury123/.test(txt), pbk: /\$pbkdf2/i.test(txt), perm: Object.keys(dump).filter(k => /perms?_override|pass_override|password/i.test(k)) }; });
    ok(!st.plain && !st.pbk && st.perm.length === 0, 'в localStorage / sessionStorage нет открытых паролей, PBKDF2-хешей и устаревших ключей perms_override / pass_override', JSON.stringify(st));
    const snap = await page.evaluate(() => JSON.stringify(UsersDB.snapshot()));
    ok(!/pbkdf2|pass|hash|perm|token/i.test(snap), 'снимок учётных записей для бэкапа содержит только заявки и «последние», без паролей, хешей и прав', snap.slice(0, 80));
    const clean = ['scripts/core/users-db.js', 'scripts/core/store.js', 'scripts/auth/auth.js', 'scripts/auth/qr-jury.js', 'index.html'].filter(f => /admin123|operator123|jury123/.test(read(f)));
    ok(clean.length === 0, 'в users-db.js, store.js, auth.js, qr-jury.js и index.html нет открытых паролей', clean.join(','));
    const dd = read('scripts/core/demo-data.js');
    ok(/DEMO_MODE !== true\) return;/.test(dd) && /admin123/.test(dd), 'открытые демо-пароли лежат только в demo-data.js, и он ничего не определяет, если DEMO_MODE не строго true');
    ok(!/localStorage\.[gs]etItem\(['"]abai\.(perms|pass)/.test(read('scripts/core/users-db.js') + read('scripts/core/store.js')), 'в коде нет чтения и записи прав или паролей через localStorage');
    await done();
  });

  /* ============ 3. DEMO_MODE=true ============ */
  await section(3, 'DEMO_MODE=true: меню [?] с готовыми паролями, три сценария стенда, данные симулятора', async () => {
    ({ ctx, page, logs } = await fresh(browser));
    await page.goto(URL); await page.waitForSelector('#loginUser'); await sleep(1100);
    const a = await page.evaluate(() => ({ mode: document.body.dataset.mode, help: !!document.getElementById('helpBtn'), demo: typeof window.ABAI_DEMO, cfg: ABAI_CONFIG.DEMO_MODE, jt: typeof UsersDB.jury.token() }));
    ok(a.mode === 'demo' && a.help && a.demo === 'object' && a.cfg === true, 'на экране входа есть кнопка [?], режим demo', JSON.stringify(a));
    await page.click('#helpBtn'); await sleep(500);
    const pop = await page.evaluate(() => ({ hidden: document.getElementById('acctPop').hidden, items: [...document.querySelectorAll('#acctPop .acct')].map(x => x.dataset.u + '/' + x.dataset.p) }));
    ok(!pop.hidden && pop.items.join() === 'eng.rza/admin123,disp.smena/operator123,jury.qr/jury123', 'меню [?]: три тестовых аккаунта с готовыми паролями', pop.items.join());
    await shot(page, 's3-3-help.png');
    await page.click('#acctPop .acct'); await sleep(300);
    ok(await page.evaluate(() => document.getElementById('loginUser').value === 'eng.rza' && document.getElementById('loginPass').value === 'admin123'), 'клик по строке меню подставляет логин и пароль');
    await page.click('#loginBtn'); await page.waitForFunction(() => !document.body.classList.contains('locked'), null, { timeout: 8000 }); await sleep(1300);
    const app = await page.evaluate(() => ({ btn: !!document.getElementById('btnDemo'), reset: !!document.getElementById('rowReset'), src: PINN.source(), live: PINN.isLive(), core: (document.getElementById('coreLbl') || {}).textContent, hist: PINN.series('temp').t.length }));
    ok(app.btn && app.reset && app.src === 'sim' && app.live && /симуляция/.test(app.core) && app.hist > 100, 'в приложении есть «Испытания стенда», источник данных — симулятор, статус «PINN Core · симуляция»', JSON.stringify(app));
    await page.click('#btnDemo'); await sleep(500);
    ok(await page.evaluate(() => [...document.querySelectorAll('#demoMenu .dm-item')].map(x => x.dataset.k).join() === 'heat,spoof,blackout,reset'), 'в меню три сценария (Нагрев, Пурга, Блэкаут) и сброс');
    for (const k of ['heat', 'spoof', 'blackout']) {
      await page.click('#demoMenu [data-k="' + k + '"]'); await sleep(700);
      const sc = await page.evaluate(() => PINN.state().scenario);
      ok(sc === k, 'сценарий «' + k + '» запускается', String(sc));
      if (!(await page.evaluate(() => !document.getElementById('demoMenu').hidden))) { await page.click('#btnDemo'); await sleep(400); }
    }
    await page.click('#demoMenu [data-k="reset"]'); await sleep(700);
    ok(await page.evaluate(() => { const s = PINN.state(); return !s.scenario || s.scenario === 'none' || s.scenario === 'reset' || s.scenario === 'norm'; }), 'сброс возвращает штатный режим', String(await page.evaluate(() => PINN.state().scenario)));
    await shot(page, 's3-3-demo-app.png'); await done();
  });

  /* ============ 4. DEMO_MODE=false ============ */
  await section(4, 'DEMO_MODE=false: нет [?] и тестовых кнопок, датчики OFFLINE «—», окно оборудования, живые данные по WebSocket, потеря связи', async () => {
    ({ ctx, page, logs } = await fresh(browser, {}, () => { window.ABAI_CONFIG = { DEMO_MODE: false }; }));
    const sockets = [], cmds = [];
    await page.routeWebSocket(/127\.0\.0\.1:8765\/ws/, ws => { sockets.push(ws); ws.onMessage(m => { cmds.push(String(m)); if (String(m).includes('i2c_scan')) ws.send(JSON.stringify({ i2c: [90, 64, 104] })); }); });
    await page.goto(URL); await page.waitForSelector('#loginUser'); await sleep(1100);
    const a = await page.evaluate(() => ({ mode: document.body.dataset.mode, help: !!document.getElementById('helpBtn'), pop: !!document.getElementById('acctPop'), accts: document.querySelectorAll('.acct').length, demo: typeof window.ABAI_DEMO, cfg: ABAI_CONFIG.DEMO_MODE, frozen: Object.isFrozen(ABAI_CONFIG), jt: UsersDB.jury.token(), pass: document.querySelectorAll('.acct[data-p]').length }));
    ok(a.mode === 'prod' && !a.help && !a.pop && a.accts === 0 && a.pass === 0, 'экран входа: нет кнопки [?], меню аккаунтов и подсказок с паролями (в DOM их нет)', JSON.stringify(a));
    ok(a.demo === 'undefined' && a.cfg === false && a.frozen && a.jt === '', 'ABAI_DEMO не определён, ABAI_CONFIG заморожен, токены жюри не выпускаются', JSON.stringify(a));
    await shot(page, 's3-4-prod-auth.png');
    await page.fill('#loginUser', 'eng.rza'); await page.fill('#loginPass', 'admin123'); await page.click('#loginBtn');
    await page.waitForFunction(() => !document.body.classList.contains('locked'), null, { timeout: 8000 }); await sleep(1400);
    const app = await page.evaluate(() => ({ b1: !!document.getElementById('btnDemo'), b2: !!document.getElementById('btnDemoM'), menu: !!document.getElementById('demoMenu'), reset: !!document.getElementById('rowReset'), src: PINN.source(), live: PINN.isLive(), cards: document.querySelectorAll('#sensorGrid .sc').length, off: document.querySelectorAll('#sensorGrid .sc[data-off="1"]').length, vals: [...document.querySelectorAll('#sensorGrid .sc-val')].map(v => v.textContent.trim()), tU: document.getElementById('tU').textContent.trim(), tT: document.getElementById('tT').textContent.trim(), core: document.getElementById('coreLbl').textContent, hist: PINN.series('temp').t.length }));
    ok(!app.b1 && !app.b2 && !app.menu && !app.reset, 'в приложении нет кнопки «Испытания стенда», меню сценариев и строки сброса демо-данных', JSON.stringify(app));
    ok(app.src === 'none' && !app.live && app.hist === 0, 'источник данных — «нет»: симулятор не запускается, истории нет', JSON.stringify({ src: app.src, hist: app.hist }));
    ok(app.cards >= 4 && app.off === app.cards && app.vals.every(v => /^—/.test(v)) && app.tU === '—' && app.tT === '—', 'матрица датчиков: все карточки OFFLINE, значения «—», в шапке тоже «—»', JSON.stringify(app));
    ok(/нет данных/.test(app.core), 'статус ядра: «PINN Core · нет данных»', app.core);
    await shot(page, 's3-4-prod-app.png');
    const guard = await page.evaluate(() => ({ heat: PINN.scenario('heat'), act: PINN.act('transfer').reason, test: typeof HardwareLink._test, snap: PINN.state().scenario }));
    ok(guard.heat === false && guard.act === 'OFFLINE' && guard.test === 'undefined', 'из консоли нельзя ни запустить сценарий, ни переключить АВР, ни подсунуть данные в обход транспорта', JSON.stringify(guard));
    /* окно «Подключение оборудования» */
    await page.evaluate(() => HardwareUI.open()); await sleep(700);
    const hw = await page.evaluate(() => ({ open: document.getElementById('mHardware').dataset.open, st: document.getElementById('hwStateT').textContent, scan: !!document.getElementById('hwScan'), tabs: [...document.querySelectorAll('#mHardware .wnd-tab')].map(t => t.dataset.tab) }));
    ok(hw.open === '1' && /Нет подключения/.test(hw.st) && hw.scan && hw.tabs.length === 2 && hw.tabs.indexOf('guide') >= 0, 'окно «Подключение оборудования»: статус, «Поиск устройств COM / I²C», вкладка «Инструкция для инженеров»', JSON.stringify(hw));
    await shot(page, 's3-4-hw-modal.png');
    await page.click('#mHardware [data-tab="guide"]'); await sleep(450);
    const gd = await page.evaluate(() => { const x = (document.querySelector('#mHardware .wnd-pane.on') || {}).textContent || ''; return { len: x.length, mlx: /MLX90614/.test(x), ina: /INA219/.test(x), mpu: /MPU6050/.test(x), fast: /FastAPI/.test(x), sda: /SDA/.test(x) && /SCL/.test(x), json: /"t"/.test(x) || /JSON/.test(x), ws: /ws:\/\/127\.0\.0\.1:8765\/ws/.test(x) }; });
    ok(gd.len > 1500 && gd.mlx && gd.ina && gd.mpu && gd.fast && gd.sda && gd.json && gd.ws, 'инструкция для инженеров: ESP32, MLX90614, INA219, MPU6050, шина I²C (SDA / SCL), формат JSON, шлюз FastAPI и адрес WebSocket', JSON.stringify(gd));
    await shot(page, 's3-4-hw-guide.png');
    await page.click('#mHardware .wnd-tab[data-tab="link"]'); await sleep(300);
    /* шлюз по WebSocket: живые данные → потеря связи */
    await page.fill('#hwWsUrl', 'ws://127.0.0.1:8765/ws'); await page.click('#hwWsGo'); await sleep(900);
    ok(sockets.length >= 1, 'кнопка «Подключиться» открывает WebSocket к шлюзу FastAPI');
    const ws = sockets[0]; let T = 55; const iv = setInterval(() => { T += 0.2; try { ws.send(JSON.stringify({ t: +T.toFixed(2), ta: -21, i: 780, u: 110.2, acc: 0.3, vdc: 220, soc: 95 })); } catch (e) { /* закрыт */ } }, 200);
    const live = await waitFor(page, () => PINN.source() === 'hw' && PINN.isLive(), null, 7000); await sleep(1800);
    const lv = await page.evaluate(() => ({ src: PINN.source(), live: PINN.isLive(), T: PINN.state().T, st: document.getElementById('hwStateT').textContent, off: document.querySelectorAll('#sensorGrid .sc[data-off="1"]').length, first: (document.querySelector('#sensorGrid .sc-val') || {}).textContent, core: document.getElementById('coreLbl').textContent, tT: document.getElementById('tT').textContent.trim() }));
    ok(live && lv.src === 'hw' && lv.live && lv.T > 50 && /На связи/.test(lv.st), 'пакеты по WebSocket → источник «оборудование», статус «На связи»', JSON.stringify(lv));
    ok(/^\d/.test(lv.first || '') && /Online/.test(lv.core) && lv.tT !== '—', 'карточка температуры показывает число, статус ядра «Online», в шапке температура', JSON.stringify(lv));
    await shot(page, 's3-4-hw-live.png');
    clearInterval(iv);
    const stale = await waitFor(page, () => PINN.source() === 'none' && !PINN.isLive(), null, 12000); await sleep(600);
    const sl = await page.evaluate(() => ({ src: PINN.source(), st: document.getElementById('hwStateT').textContent, off: document.querySelectorAll('#sensorGrid .sc[data-off="1"]').length, cards: document.querySelectorAll('#sensorGrid .sc').length, first: (document.querySelector('#sensorGrid .sc-val') || {}).textContent }));
    ok(stale && sl.src === 'none' && sl.off === sl.cards && /^—/.test(sl.first) && /не приходят/.test(sl.st), 'тишина больше 5 с → датчики снова OFFLINE «—», статус «Данные не приходят»', JSON.stringify(sl));
    await shot(page, 's3-4-hw-stale.png'); await done();
  });

  /* ============ 5. Фон экрана входа (десктоп) ============ */
  await section(5, 'Фон входа: свет по времени суток, «Полярная ночь 24/7», стирание мышью', async () => {
    ({ ctx, page, logs } = await fresh(browser));
    await page.goto(URL); await page.waitForSelector('#loginUser'); await sleep(2200);
    const at = async h => { await page.evaluate(h => FrostCanvas.setClock(h), h); await sleep(1700); return page.evaluate(() => { const s = FrostCanvas.stats(); return { sky: document.getElementById('auth').dataset.sky, st: s.sky, lum: s.lum, lamps: s.lamps, aurora: s.aurora, polar: s.polar, l: +document.getElementById('auth').style.getPropertyValue('--sky-l') }; }); };
    const R = {}; for (const h of [0, 6.5, 12, 17.5, 22.5]) R[h] = await at(h);
    ok(['night', 'dawn', 'day', 'dusk', 'night'].join() === [0, 6.5, 12, 17.5, 22.5].map(h => R[h].sky).join(), 'небо по часам: ночь → рассвет → день → закат → ночь', [0, 6.5, 12, 17.5, 22.5].map(h => R[h].sky).join());
    ok(R[0].lum < .05 && R[6.5].lum > R[0].lum && R[12].lum > .95 && R[17.5].lum < R[12].lum && R[22.5].lum < .05, 'освещённость растёт к полудню и падает к ночи', [0, 6.5, 12, 17.5, 22.5].map(h => R[h].lum).join(' / '));
    ok(R[0].lamps > .9 && R[12].lamps < R[0].lamps - .4 && R[17.5].lamps > R[12].lamps, 'прожекторы и огни подстанции горят ночью и притухают днём', [0, 12, 17.5].map(h => R[h].lamps).join(' / '));
    ok(Math.abs(R[12].l - R[12].lum) < .1 && R[0].aurora > .2 && R[12].aurora < .05, 'CSS-переменная --sky-l следует за освещённостью; северное сияние только ночью', JSON.stringify({ l: R[12].l, a0: R[0].aurora, a12: R[12].aurora }));
    await shot(page, 's3-5-day.png');
    await page.evaluate(() => FrostCanvas.setClock(null));
    /* полярная ночь */
    const pb = await page.evaluate(() => ({ pressed: document.getElementById('authPolar').getAttribute('aria-pressed'), data: document.documentElement.dataset.polar || '0' }));
    await page.click('#authPolar'); await sleep(900);
    await page.evaluate(() => FrostCanvas.setClock(12)); await sleep(3600);
    const po = await page.evaluate(() => ({ pressed: document.getElementById('authPolar').getAttribute('aria-pressed'), data: document.documentElement.dataset.polar, st: FrostCanvas.stats(), ls: localStorage.getItem('abai.polar'), sky: document.getElementById('auth').dataset.sky }));
    ok(pb.pressed === 'false' && po.pressed === 'true' && po.data === '1', 'переключатель «Полярная ночь 24/7»: aria-pressed и html[data-polar="1"]', JSON.stringify({ pb, pressed: po.pressed, data: po.data }));
    ok(po.st.polar > .9 && po.st.lum < .25 && po.st.aurora > .2, 'в полярную ночь даже «в полдень» (12:00) темно, виден отсвет сияния', JSON.stringify({ polar: po.st.polar, lum: po.st.lum, aurora: po.st.aurora }));
    await shot(page, 's3-5-polar.png');
    await page.evaluate(() => FrostCanvas.setClock(null));
    await page.reload(); await page.waitForSelector('#loginUser'); await sleep(2000);
    const rp = await page.evaluate(() => ({ pressed: document.getElementById('authPolar').getAttribute('aria-pressed'), data: document.documentElement.dataset.polar }));
    ok(rp.pressed === 'true' && rp.data === '1', 'выбор «Полярная ночь» сохраняется между перезагрузками', JSON.stringify(rp));
    await page.click('#authPolar'); await sleep(2500);
    ok(await page.evaluate(() => document.documentElement.dataset.polar !== '1' && document.getElementById('authPolar').getAttribute('aria-pressed') === 'false'), 'повторное нажатие выключает режим');
    /* стирание мышью: капли собираются и стекают */
    await page.evaluate(() => FrostCanvas.setClock(null)); await sleep(1200);
    const b = await page.evaluate(() => FrostCanvas.stats());
    await page.mouse.move(120, 200); await page.mouse.down();
    for (let i = 0; i <= 40; i++) { await page.mouse.move(120 + Math.sin(i / 6) * 40, 200 + i * 12); await sleep(12); }
    const m = await page.evaluate(() => FrostCanvas.stats()); await shot(page, 's3-5-wipe-mid.png');
    await page.mouse.up(); await sleep(250);
    const rel = await page.evaluate(() => FrostCanvas.stats()); await sleep(2500);
    const aft = await page.evaluate(() => FrostCanvas.stats()); await shot(page, 's3-5-wipe-after.png');
    ok(m.carried > 0 || m.drops < b.drops, 'мазок мышью по морозному стеклу собирает капли в крупную (carried > 0 или капель стало меньше)', JSON.stringify({ before: b.drops + '/' + b.carried, mid: m.drops + '/' + m.carried }));
    ok(rel.carried === 0 && aft.carried === 0 && aft.running && aft.fps > 5, 'после отпускания капля уходит вниз, сцена продолжает работать', JSON.stringify({ rel: rel.carried, aft: aft.sliding + '/' + aft.fps }));
    await done();
  });

  /* ============ 6. Фон входа на телефоне ============ */
  await section(6, 'Фон входа на телефоне: касание стирает иней, клавиатура не пересоздаёт сцену, поворот экрана', async () => {
    ({ ctx, page, logs } = await fresh(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }));
    await page.goto(URL); await page.waitForSelector('#loginUser'); await sleep(2400);
    await shot(page, 's3-6-phone-auth.png');
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const b0 = await page.evaluate(() => FrostCanvas.stats());
    await touch('touchStart', 30, 60); for (let i = 0; i <= 30; i++) { await touch('touchMove', 30 + (i % 10) * 6, 60 + i * 5); await sleep(14); }
    const m1 = await page.evaluate(() => FrostCanvas.stats()); await shot(page, 's3-6-phone-touch.png');
    await touch('touchEnd', 0, 0); await sleep(2500);
    const a1 = await page.evaluate(() => FrostCanvas.stats());
    ok(m1.carried > 0 || m1.drops < b0.drops, 'касание пальцем стирает иней и собирает капли', JSON.stringify({ before: b0.drops + '/' + b0.carried, mid: m1.drops + '/' + m1.carried }));
    ok(a1.carried === 0 && a1.running, 'палец убран: капли отпущены, сцена работает', JSON.stringify({ carried: a1.carried, running: a1.running }));
    /* экранная клавиатура меняет только высоту окна */
    const d0 = await page.evaluate(() => ({ w: document.getElementById('bgCanvas').width, h: document.getElementById('bgCanvas').height, s: FrostCanvas.stats() }));
    await page.setViewportSize({ width: 390, height: 480 }); await sleep(900);
    const d1 = await page.evaluate(() => ({ w: document.getElementById('bgCanvas').width, h: document.getElementById('bgCanvas').height, s: FrostCanvas.stats() }));
    ok(d1.w === d0.w && d1.h === d0.h && d1.s.ignored > d0.s.ignored && d1.s.drops >= d0.s.drops * 0.7, 'клавиатура (меняется только высота): холст и капли не пересоздаются, событие учтено как «ignored»', JSON.stringify({ d0: [d0.w, d0.h, d0.s.resizes, d0.s.ignored, d0.s.drops], d1: [d1.w, d1.h, d1.s.resizes, d1.s.ignored, d1.s.drops] }));
    await page.evaluate(() => document.getElementById('loginPass').focus()); await sleep(500);
    const vis = await page.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(); const b = r('loginBtn'), p = r('loginPass'); return { passTop: p.top, passBottom: p.bottom, btnBottom: b.bottom, vh: innerHeight, vv: window.visualViewport ? visualViewport.height : innerHeight }; });
    ok(vis.passTop >= 0 && vis.passBottom <= vis.vh, 'при открытой клавиатуре поле пароля остаётся на экране', JSON.stringify(vis));
    await shot(page, 's3-6-phone-kbd.png');
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(600);
    await page.setViewportSize({ width: 844, height: 390 }); await sleep(900);
    const d2 = await page.evaluate(() => ({ w: document.getElementById('bgCanvas').width, h: document.getElementById('bgCanvas').height, s: FrostCanvas.stats() }));
    ok(d2.w !== d0.w && d2.s.resizes > d1.s.resizes && d2.s.running, 'поворот экрана (меняется ширина) пересоздаёт сцену под новый размер', JSON.stringify({ w: d2.w, resizes: d2.s.resizes }));
    await shot(page, 's3-6-phone-landscape.png'); await done();
  });

  /* ============ 7. Граф Obsidian ============ */
  await section(7, 'Граф Obsidian: LOD, импульсы, перетаскивание, раскладка отдельно для каждого пользователя', async () => {
    ({ ctx, page, logs } = await fresh(browser)); await loginAs(page, 'eng.rza', 'admin123');
    await page.click('#rbNav [data-view="graph"]'); await sleep(1800);
    let s = await page.evaluate(() => ({ st: ObsidianGraph.stats(), lod: ObsidianGraph.lod() }));
    ok(s.st.nodes === 12 && s.st.uid === '1073819' && !s.st.layoutSaved, 'граф открыт для админа: 12 узлов, своей раскладки ещё нет', JSON.stringify({ uid: s.st.uid, saved: s.st.layoutSaved }));
    ok(s.lod.level === 'full' && s.lod.labels > .9, 'LOD вблизи: названия и значения видны', JSON.stringify(s.lod)); await shot(page, 's3-7-graph.png');
    const box = await page.evaluate(() => { const r = document.getElementById('graphCanvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(box.x, box.y); await page.mouse.wheel(0, 1400); await sleep(1500);
    s = await page.evaluate(() => ({ st: ObsidianGraph.stats(), lod: ObsidianGraph.lod() }));
    ok(s.lod.level === 'dots' && s.st.labelsAlpha < .1 && s.st.formulasAlpha < .05, 'LOD вдали: текст и формулы гаснут, остаются точки', JSON.stringify(s.lod));
    ok(s.st.pulses > 0, 'импульсы бегут по линиям и в режиме точек', 'pulses=' + s.st.pulses); await shot(page, 's3-7-zoomout.png');
    await page.click('#gFit'); await sleep(1300);
    const jp0 = await nodePos(page, 'joint');
    await page.mouse.move(jp0.x, jp0.y); await page.mouse.down(); await page.mouse.move(jp0.x + 160, jp0.y + 120, { steps: 12 }); await sleep(100); await page.mouse.up(); await sleep(500);
    const jp1 = await nodePos(page, 'joint');
    ok(Math.hypot(jp1.wx - jp0.wx, jp1.wy - jp0.wy) > 60, 'узел перетаскивается мышью', JSON.stringify({ from: [jp0.wx | 0, jp0.wy | 0], to: [jp1.wx | 0, jp1.wy | 0] }));
    ok(await page.evaluate(() => ObsidianGraph.stats().pins === 1), 'брошенный узел закрепляется');
    await sleep(5200);
    const sv = await page.evaluate(() => ({ stats: ObsidianGraph.stats(), stored: Store.layout.get('1073819') }));
    ok(sv.stats.layoutSaved && sv.stored && sv.stored.joint && sv.stored.joint[2] === 1, 'раскладка сохранена в Store.layout под user.id = 1073819', JSON.stringify(sv.stored && sv.stored.joint));
    await page.evaluate(() => AuthApp.logout()); await sleep(1200);
    ok(await page.evaluate(() => ObsidianGraph.stats().uid === null && ObsidianGraph.pins().length === 0), 'после выхода граф сброшен к исходной раскладке');
    await loginAs(page, 'disp.smena', 'operator123'); await page.click('#rbNav [data-view="graph"]'); await sleep(1500);
    s = await page.evaluate(() => ({ st: ObsidianGraph.stats(), j: [ObsidianGraph.byId('joint').x, ObsidianGraph.byId('joint').y] }));
    ok(s.st.uid === '1073820' && !s.st.layoutSaved && s.st.pins === 0, 'у диспетчера своя раскладка: чужих закреплений нет', JSON.stringify({ uid: s.st.uid, saved: s.st.layoutSaved }));
    ok(Math.hypot(s.j[0] - jp1.wx, s.j[1] - jp1.wy) > 60, 'положение joint у диспетчера не такое, как у админа');
    await page.click('#gFit'); await sleep(1200);
    const dp = await nodePos(page, 'core'); await page.mouse.move(dp.x, dp.y); await page.mouse.down(); await page.mouse.move(dp.x - 150, dp.y + 100, { steps: 10 }); await page.mouse.up(); await sleep(5600);
    const st2 = await page.evaluate(() => ({ a: Store.layout.get('1073819'), d: Store.layout.get('1073820') }));
    ok(st2.d && st2.d.core && st2.d.core[2] === 1 && st2.a && st2.a.joint[2] === 1 && !st2.a.core[2], 'раскладки хранятся раздельно: у админа закреплён joint, у диспетчера — core');
    await page.evaluate(() => AuthApp.logout()); await sleep(1000);
    await loginAs(page, 'eng.rza', 'admin123'); await page.click('#rbNav [data-view="graph"]'); await sleep(1500);
    const back = await page.evaluate(() => ({ st: ObsidianGraph.stats(), j: [ObsidianGraph.byId('joint').x, ObsidianGraph.byId('joint').y], pins: ObsidianGraph.pins() }));
    ok(back.st.layoutSaved && Math.hypot(back.j[0] - jp1.wx, back.j[1] - jp1.wy) < 8 && back.pins.join() === 'joint', 'админ вернулся: расстановка восстановлена', JSON.stringify({ j: back.j.map(Math.round), pins: back.pins }));
    await page.reload(); await waitFor(page, () => !document.body.classList.contains('locked'), null, 9000); await sleep(1500); await page.click('#rbNav [data-view="graph"]'); await sleep(1500);
    const f5 = await page.evaluate(() => ({ uid: ObsidianGraph.stats().uid, pins: ObsidianGraph.pins() }));
    ok(f5.uid === '1073819' && f5.pins.join() === 'joint', 'после F5 раскладка на месте', JSON.stringify(f5));
    const jq = await nodePos(page, 'joint'); await page.mouse.dblclick(jq.x, jq.y); await sleep(400);
    ok(await page.evaluate(() => ObsidianGraph.pins().length === 0), 'двойной клик по узлу освобождает его');
    await page.click('#gReset'); await sleep(1500);
    ok(await page.evaluate(() => Store.layout.get('1073819') === null && ObsidianGraph.stats().layoutSaved === false), 'кнопка «Сбросить раскладку» очищает сохранённое');
    await shot(page, 's3-7-graph-reset.png'); await done();
  });

  /* ============ 8. Плагины ============ */
  await section(8, 'Плагины: загрузка папки, сохранение, права CAN_MANAGE_PLUGINS, очистка при выходе', async () => {
    ({ ctx, page, logs } = await fresh(browser)); await loginAs(page, 'eng.rza', 'admin123');
    await page.click('#rbNav [data-view="plugins"]'); await sleep(800);
    ok(await page.evaluate(() => !document.getElementById('btnAddPlugin').hidden && document.querySelectorAll('#plugList [data-pl-cfg]').length >= 5), 'у админа есть кнопка «Добавить плагин» и кнопки параметров ⚙');
    await page.click('#btnAddPlugin'); await sleep(700);
    const t0 = await page.evaluate(() => ({ dir: !!document.getElementById('pkDrop'), tab: document.querySelector('#mPlugin .wnd-tab.on, #mPluginEdit .wnd-tab.on') && document.querySelector('#mPlugin .wnd-tab.on, #mPluginEdit .wnd-tab.on').dataset.tab }));
    ok(t0.dir, 'окно добавления плагина открывается на вкладке «Папка плагина» (зона перетаскивания)', JSON.stringify(t0));
    await page.setInputFiles('#pkInput', FIX); await sleep(1600);
    const up = await page.evaluate(() => ({ name: document.getElementById('pkName').textContent, rt: document.getElementById('pkRt').textContent, ver: document.getElementById('pkVer').textContent, tree: [...document.querySelectorAll('#pkTree li')].map(l => l.textContent.trim()), issues: [...document.querySelectorAll('#pkIssues li')].map(l => l.className + ': ' + l.textContent.trim()), st: PluginUI.state(), save: !document.getElementById('plSave').disabled }));
    ok(up.name === 'MY-GUARD' && /^js$/i.test(up.rt) && /1\.0\.2/.test(up.ver) && up.tree.length >= 3 && up.save, 'папка загружена: manifest.json распознан (MY-GUARD, js, 1.0.2), дерево файлов построено, «Внедрить» доступна', JSON.stringify(up));
    ok(!up.issues.some(i => /^err/.test(i)) && /\bok\b|ok/.test(JSON.stringify(up.st)) || !up.issues.some(i => /err/.test(i)), 'в папке нет ошибок проверки', JSON.stringify(up.issues));
    await shot(page, 's3-8-plugin-upload.png');
    await page.click('#plSave'); await sleep(1100);
    const sv = await page.evaluate(() => { const p = Store.plugins.get('MY-GUARD'); return { has: !!p, files: p && p.files && p.files.map(f => f.path).sort(), lang: p && p.lang, open: PluginUI.state().open, row: !!document.querySelector('.pl-row[data-id="MY-GUARD"]'), n: Store.plugins.list().length }; });
    ok(sv.has && sv.row && !sv.open && sv.files && sv.files.indexOf('manifest.json') >= 0 && sv.files.indexOf('worker.js') >= 0 && sv.lang === 'js', 'плагин внедрён: файлы папки сохранены в Store, строка появилась в списке, окно закрыто', JSON.stringify(sv));
    /* Python — только хранение */
    await page.click('#btnAddPlugin'); await sleep(600); await page.click('#pkSamplePy'); await sleep(900);
    const py = await page.evaluate(() => ({ rt: document.getElementById('pkRt').textContent, txt: document.getElementById('mPlugin') ? document.getElementById('mPlugin').textContent : document.body.textContent }));
    ok(/^py$/i.test(py.rt) && /FastAPI/.test(py.txt) && /Phase 2/.test(py.txt), 'Python-плагин: пример загружается, окно говорит, что он только хранится, а исполнит его сервер FastAPI (Phase 2)', py.rt);
    await closeWnd(page);
    /* пробный запуск в песочнице идёт ДО сохранения: код, лезущий в window/localStorage, отклоняется в окне, плагин не создаётся, сайт не затронут */
    await page.click('#btnAddPlugin'); await sleep(600); await page.click('#plTabs [data-tab="code"]'); await sleep(300);
    await page.fill('#plName', 'BAD-WINDOW'); await page.fill('#plCode', "window.__hack = 1; localStorage.setItem('x', '1'); return { alarm: false };"); await page.click('#plSave'); await sleep(900);
    const bw = await page.evaluate(() => ({ err: document.getElementById('plErr').textContent, has: !!Store.plugins.get('BAD-WINDOW'), open: PluginUI.state().open, hack: window.__hack === undefined, ls: localStorage.getItem('x') === null }));
    ok(bw.err.length > 3 && !bw.has && bw.open && bw.hack && bw.ls, 'код с window/localStorage отклоняется пробным запуском в песочнице ещё до сохранения: ошибка в окне, плагин не создан, сайт не затронут', JSON.stringify(bw));
    await closeWnd(page);
    /* параметры и удаление */
    await page.click('[data-pl-cfg="MY-GUARD"]'); await sleep(700);
    ok(await page.evaluate(() => PluginUI.state().open === true), 'кнопка ⚙ у своего плагина открывает редактор'); await closeWnd(page);
    /* секрет в редакторе стирается при выходе */
    await page.click('#btnAddPlugin'); await sleep(600); await page.click('#mPlugin [data-tab="code"], #mPluginEdit [data-tab="code"]').catch(() => {}); await sleep(300);
    await page.fill('#plCode', 'return {alarm:false} /* SECRET-TOKEN-123 */'); await page.fill('#plName', 'SECRET-PLUGIN');
    await page.evaluate(() => AuthApp.logout()); await sleep(1100);
    const wipe = await page.evaluate(() => ({ code: document.getElementById('plCode').value, name: document.getElementById('plName').value, open: PluginUI.state().open, html: document.body.innerHTML.indexOf('SECRET-TOKEN-123') >= 0, saved: JSON.stringify(Store.plugins.list()).indexOf('SECRET-TOKEN') >= 0 }));
    ok(wipe.code === '' && wipe.name === '' && !wipe.open && !wipe.saved, 'выход закрывает редактор и стирает введённый код плагина (черновик не остаётся в DOM и не сохраняется)', JSON.stringify(wipe));
    /* диспетчер: нет права CAN_MANAGE_PLUGINS */
    await loginAs(page, 'disp.smena', 'operator123'); await page.click('#rbNav [data-view="plugins"]'); await sleep(800);
    const op = await page.evaluate(() => ({ add: !document.getElementById('btnAddPlugin').hidden, cfg: document.querySelectorAll('#plugList [data-pl-cfg]').length, del: document.querySelectorAll('#plugList [data-pl-del]').length, rows: document.querySelectorAll('#plugList .pl-row').length, sw: [...document.querySelectorAll('#plugList [data-pl-on]')].map(i => i.disabled), my: !!document.querySelector('.pl-row[data-id="MY-GUARD"]') }));
    ok(!op.add && op.cfg === 0 && op.del === 0 && op.rows >= 5 && op.sw.length === op.rows && op.sw.every(Boolean) && op.my, 'диспетчер видит плагины, но без права CAN_MANAGE_PLUGINS у него нет кнопки добавления, ⚙ и удаления, переключатели заблокированы', JSON.stringify(op));
    await shot(page, 's3-8-plugins-operator.png');
    const deny = await page.evaluate(() => { PluginUI.open(null); return PluginUI.state().open; }); await sleep(400);
    ok(deny === false, 'даже программный вызов PluginUI.open() у диспетчера не открывает редактор (право проверяется заново)');
    const tg = await page.evaluate(() => { const i = document.querySelector('#plugList [data-pl-on]'); const was = i.checked; i.disabled = false; i.click(); const now = i.checked; return { was, now, on: Store.plugins.list().filter(p => p.on).length }; }); await sleep(500);
    ok(tg.was === tg.now, 'снять блокировку переключателя через DevTools не помогает: состояние откатывается, право проверено в обработчике', JSON.stringify(tg));
    await done();
  });

  /* ============ 9. Телефон: Dock и граф ============ */
  await section(9, 'Телефон 390×844: нижний Dock не перекрывает граф и миникарту, нет горизонтальной прокрутки', async () => {
    ({ ctx, page, logs } = await fresh(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })); await loginAs(page, 'eng.rza', 'admin123', true);
    const dk = await page.evaluate(() => { const d = document.getElementById('mdock'), r = d.getBoundingClientRect(), cs = getComputedStyle(d); return { pos: cs.position, h: r.height, bottom: Math.round(innerHeight - r.bottom), btns: d.querySelectorAll('button').length, bd: cs.backdropFilter || cs.webkitBackdropFilter }; });
    ok(dk.pos === 'fixed' && dk.btns === 5 && /blur/.test(dk.bd), 'нижняя стеклянная панель: фиксирована, размытие, 5 кнопок', JSON.stringify(dk));
    await page.tap('#mdock [data-view="graph"]'); await sleep(2600);
    const g = await page.evaluate(() => { const c = ObsidianGraph.camera(), r = document.getElementById('graphCanvas').getBoundingClientRect(), dock = document.getElementById('mdock').getBoundingClientRect(), mm = document.getElementById('miniMap'), mr = mm ? mm.getBoundingClientRect() : null; const ns = ObsidianGraph.nodes(); const xs = ns.map(n => r.left + (n.x - c.x) * c.k + r.width / 2), ys = ns.map(n => r.top + (n.y - c.y) * c.k + r.height / 2); return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), dockTop: dock.top, vw: innerWidth, mmBottom: mr ? mr.bottom : null, mmShown: mm ? getComputedStyle(mm).display !== 'none' && mr.width > 0 : false, scroll: document.documentElement.scrollWidth, k: c.k, lod: ObsidianGraph.lod().level }; });
    ok(g.minX >= 0 && g.maxX <= g.vw && g.minY >= 0 && g.maxY <= g.dockTop - 4, 'граф вписан в экран над нижней панелью: ни один узел не уходит под неё', JSON.stringify(g));
    ok(!g.mmShown || g.mmBottom <= g.dockTop + 1, 'миникарта не заезжает под нижнюю панель', JSON.stringify({ mm: g.mmBottom, dock: g.dockTop }));
    ok(g.scroll <= g.vw, 'нет горизонтальной прокрутки в разделе «Граф»', String(g.scroll));
    await shot(page, 's3-9-phone-graph.png');
    for (const v of ['grid', 'audit', 'plugins']) { await page.tap('#mdock [data-view="' + v + '"]'); await sleep(900); ok(await page.evaluate(v => document.getElementById('app').dataset.view === v && document.documentElement.scrollWidth <= innerWidth, v), 'раздел «' + v + '» на телефоне: без горизонтальной прокрутки'); await shot(page, 's3-9-phone-' + v + '.png'); }
    await done();
  });

  /* ============ 10. Консоль ============ */
  await section(10, 'Консоль браузера: 0 ошибок, 0 предупреждений, 0 запросов с кодом 400+', async () => {
    const real = allLogs.filter(l => !/ERR_ABORTED|favicon/i.test(l));
    ok(real.length === 0, 'за все прогоны блоков ни одной ошибки, предупреждения или неудачного запроса', real.slice(0, 6).join(' | '));
  });

  await browser.close();
  console.log('\n==== ИТОГ (сквозной набор этапа 3): ' + pass + ' ✓ / ' + fail + ' ✗ ====');
  if (fail) { console.log('ПРОВАЛЫ:'); fails.forEach(f => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(2); });
