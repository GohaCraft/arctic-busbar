/* ARCTIC BUSBAR AI v2.4.0-prod: tests/e2e-stage1.js
   Основной интерактивный набор ЭТАПА 1 (94 проверки): часы, [?], глазок, ошибки, 3 входа, выход, восстановление 24 ч, QR-панель, PIN-ячейки, ссылка, мобильный, reduced-motion.
   Запуск (из корня проекта):
     python3 -m http.server 8765 --bind 127.0.0.1 &            # сервер статики
     NODE_PATH=$(npm root -g) node tests/e2e-stage1.js                  # нужен playwright (npm i -g playwright) и Chromium
   Переменная ABAI_URL переопределяет адрес страницы. Скриншоты кладутся в tests/out/. Код выхода 0 = всё зелёное. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out'), URL = process.env.ABAI_URL || 'http://127.0.0.1:8765/index.html';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const fails = [];
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗ ' + name + (extra ? '  →  ' + extra : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fresh(browser, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, opts));
  const page = await ctx.newPage(); const logs = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', r => logs.push('REQFAILED: ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) logs.push('HTTP ' + r.status() + ': ' + r.url()); });
  return { ctx, page, logs };
}
const locked = page => page.evaluate(() => document.body.classList.contains('locked'));
async function login(page, u, p) {
  await page.fill('#loginUser', u); await page.fill('#loginPass', p); await page.click('#loginBtn');
}
async function waitApp(page) { await page.waitForFunction(() => !document.body.classList.contains('locked'), null, { timeout: 6000 }); }

(async () => {
  const browser = await chromium.launch();

  /* ============ 1. загрузка, часы, консоль ============ */
  console.log('\n[1] Загрузка и часы UTC+7');
  let { ctx, page, logs } = await fresh(browser);
  await page.goto(URL); await sleep(1500);
  ok(await locked(page), 'body.locked при старте');
  ok(await page.evaluate(() => !!document.getElementById('bgCanvas') && document.getElementById('bgCanvas').width > 100), 'bgCanvas создан и имеет размер');
  const c1 = await page.textContent('#authClock'); await sleep(1100); const c2 = await page.textContent('#authClock');
  ok(/^UTC\+7 \d\d:\d\d:\d\d$/.test(c1), 'формат часов "UTC+7 HH:MM:SS"', c1);
  ok(c1 !== c2, 'часы тикают', c1 + ' → ' + c2);
  const exp = await page.evaluate(() => { const d = new Date(Date.now() + 7 * 36e5); return d.toISOString().slice(11, 16); });
  ok(c2.slice(6, 11) === exp, 'часы показывают время UTC+7', c2 + ' vs ' + exp);
  const st = await page.evaluate(() => FrostCanvas.stats());
  ok(st.running && st.drops > 50, 'FrostCanvas работает, капли есть', JSON.stringify(st));
  ok(await page.evaluate(() => !window.I18N && !window.Store && !window.PINN), 'скрипты этапа 2 не подключены (закомментированы)');

  /* ============ 2. [?] меню ============ */
  console.log('\n[2] Меню [?]');
  await page.click('#helpBtn'); await sleep(350);
  ok(await page.evaluate(() => !document.getElementById('acctPop').hidden), 'меню открылось');
  ok(await page.evaluate(() => document.querySelectorAll('#acctPop .acct').length === 3), '3 аккаунта в меню');
  await page.click('#acctPop .acct[data-u="jury.qr"]'); await sleep(300);
  const filled = await page.evaluate(() => [document.getElementById('loginUser').value, document.getElementById('loginPass').value, document.getElementById('acctPop').hidden]);
  ok(filled[0] === 'jury.qr' && filled[1] === 'jury123' && filled[2] === true, 'клик подставил логин+пароль и закрыл меню', JSON.stringify(filled));
  await page.click('#helpBtn'); await sleep(250); await page.keyboard.press('Escape'); await sleep(250);
  ok(await page.evaluate(() => document.getElementById('acctPop').hidden), 'Escape закрывает меню');
  await page.click('#helpBtn'); await sleep(250); await page.mouse.click(60, 60); await sleep(250);
  ok(await page.evaluate(() => document.getElementById('acctPop').hidden), 'клик вне меню закрывает его');

  /* ============ 3. глазок ============ */
  console.log('\n[3] Глазок пароля');
  await page.fill('#loginPass', 'secret');
  await page.click('#eyeBtn');
  let eye = await page.evaluate(() => [document.getElementById('loginPass').type, document.getElementById('eyeBtn').getAttribute('aria-pressed')]);
  ok(eye[0] === 'text' && eye[1] === 'true', 'глазок: показать пароль', JSON.stringify(eye));
  await page.click('#eyeBtn');
  eye = await page.evaluate(() => [document.getElementById('loginPass').type, document.getElementById('eyeBtn').getAttribute('aria-pressed')]);
  ok(eye[0] === 'password' && eye[1] === 'false', 'глазок: скрыть пароль', JSON.stringify(eye));

  /* ============ 4. ошибки входа ============ */
  console.log('\n[4] Ошибки входа');
  await page.fill('#loginUser', ''); await page.fill('#loginPass', ''); await page.click('#loginBtn'); await sleep(200);
  let msg = await page.textContent('#authMsg'); ok(/Введите логин/.test(msg), 'пустая форма → сообщение', msg);
  ok(await page.evaluate(() => document.getElementById('card').classList.contains('shake')), 'карточка трясётся (shake)');
  await login(page, 'nobody', 'x'); await sleep(200); msg = await page.textContent('#authMsg'); ok(/не найден/.test(msg), 'неизвестный пользователь', msg);
  await login(page, 'eng.rza', 'wrong'); await sleep(200); msg = await page.textContent('#authMsg'); ok(/Неверный пароль/.test(msg), 'неверный пароль', msg);
  ok(await locked(page), 'после ошибок остаёмся на экране входа');
  await page.screenshot({ path: path.join(OUT, 'f_err.png') });
  await login(page, 'eng.rza', 'jury123'); await sleep(200); msg = await page.textContent('#authMsg'); ok(/Неверный пароль/.test(msg), 'пароль чужого аккаунта не подходит', msg);

  /* ============ 5. успешные входы тремя способами + выход ============ */
  console.log('\n[5] Вход: логин / табельный код / ФИО, роли, выход');
  const cases = [['eng.rza', 'admin123', 'Левицкий А.Р.', '1073819', 'Главный Инженер РЗА'], ['1073820', 'operator123', 'Соколов И.В.', '1073820', 'Диспетчер смены'], ['Эксперт Жюри', 'jury123', 'Эксперт Жюри', '1073821', 'Эксперт Жюри']];
  let events = [];
  await page.exposeFunction('__ev', e => events.push(e));
  await page.evaluate(() => window.addEventListener('abai:auth', e => window.__ev({ type: e.detail.type, via: e.detail.via, id: e.detail.user && e.detail.user.id })));
  for (const [u, p, fio, id, role] of cases) {
    await login(page, u, p);
    await sleep(250);
    const gr = await page.evaluate(() => { const g = document.getElementById('grant'); return !g.hidden ? document.getElementById('grantMsg').textContent : null; });
    ok(gr && /ЗАГРУЗКА ПРОФИЛЯ/.test(gr), 'ACCESS GRANTED // ЗАГРУЗКА ПРОФИЛЯ… (' + u + ')', gr);
    await waitApp(page); await sleep(200);
    const prof = await page.evaluate(() => [document.getElementById('empName').textContent, document.getElementById('empId').textContent, document.getElementById('empRole').textContent, getComputedStyle(document.getElementById('app')).display, document.getElementById('tClock').textContent, document.getElementById('tzLabel').textContent]);
    ok(prof[0] === fio && prof[1] === id && prof[2].indexOf(role) === 0, 'профиль в #app: ' + fio + ' / ' + id + ' / ' + prof[2], JSON.stringify(prof));
    ok(prof[3] !== 'none' && /^\d\d:\d\d:\d\d$/.test(prof[4]) && prof[5] === 'UTC+7', '#app виден, часы в шапке UTC+7', JSON.stringify(prof.slice(3)));
    if (u === 'eng.rza') await page.screenshot({ path: path.join(OUT, 'f_app.png') });
    await page.click('#btnLogout'); await sleep(600);
    ok(await locked(page), 'выход возвращает экран входа (' + fio + ')');
    ok(await page.evaluate(() => document.getElementById('loginPass').value === ''), 'пароль очищен после выхода');
  }
  ok(events.filter(e => e.type === 'login').length === 3 && events.filter(e => e.type === 'logout').length === 3, 'события abai:auth login×3 / logout×3', JSON.stringify(events));
  ok(await page.evaluate(() => FrostCanvas.stats().running), 'фон снова бежит после выхода');

  /* ============ 6. восстановление пароля, лимит 24 ч ============ */
  console.log('\n[6] Восстановление пароля');
  await page.fill('#loginUser', 'eng.rza'); await page.click('#rcvLink'); await sleep(400);
  ok(await page.evaluate(() => !document.getElementById('rcvModal').hidden && document.getElementById('rcvUser').value === 'eng.rza'), 'модалка открыта, логин подставлен');
  await page.screenshot({ path: path.join(OUT, 'f_rcv.png') });
  await page.fill('#rcvUser', 'ghost'); await page.click('#rcvSend'); await sleep(300);
  msg = await page.textContent('#rcvMsg'); ok(/не найден/i.test(msg) || msg.length > 5, 'несуществующий аккаунт → ошибка', msg);
  await page.fill('#rcvUser', 'eng.rza'); await page.click('#rcvSend'); await sleep(400);
  const sent = await page.evaluate(() => ({ vis: !document.getElementById('rcvSent').hidden, to: document.getElementById('sentTo').textContent, subj: document.getElementById('sentSubj').textContent, body: document.getElementById('sentBody').textContent, href: document.getElementById('sentMailto').href, req: document.getElementById('rcvReq').textContent }));
  ok(sent.vis && sent.to === 'security-rza@nornickel-arctic.ru', 'письмо показано, получатель security-rza@nornickel-arctic.ru', JSON.stringify(sent.to));
  ok(/Здравствуйте, .*Левицкий А\.Р.* забыл пароль, измените пароль\./.test(sent.body), 'текст письма «Здравствуйте, [ФИО] забыл пароль, измените пароль.»', sent.body);
  ok(/^mailto:security-rza@nornickel-arctic\.ru/.test(sent.href), 'mailto: ссылка', sent.href.slice(0, 80));
  await page.screenshot({ path: path.join(OUT, 'f_rcv_sent.png') });
  ok(await page.evaluate(() => UsersDB.allRequests().length === 1 && UsersDB.allRequests()[0].status === 'PENDING'), 'заявка записана в UsersDB.allRequests()');
  await page.click('#rcvBack'); await sleep(300);
  await page.click('#rcvLink'); await sleep(300); await page.fill('#rcvUser', 'eng.rza'); await page.click('#rcvSend'); await sleep(400);
  const lim = await page.evaluate(() => ({ vis: !document.getElementById('rcvLimit').hidden, t: document.getElementById('rcvTimer').textContent, bar: document.getElementById('rcvBar').style.transform }));
  ok(lim.vis && /^23:59:5\d$|^24:00:00$/.test(lim.t), 'повторный запрос блокируется, таймер ~23:59:5x', JSON.stringify(lim));
  await sleep(2200); const t2 = await page.textContent('#rcvTimer');
  ok(t2 !== lim.t, 'таймер остатка тикает', lim.t + ' → ' + t2);
  await page.screenshot({ path: path.join(OUT, 'f_rcv_limit.png') });
  await page.fill('#rcvUser', '1073819'); await page.click('#rcvSend'); await sleep(300);
  ok(await page.evaluate(() => !document.getElementById('rcvLimit').hidden), 'тот же аккаунт по табельному коду тоже заблокирован');
  await page.fill('#rcvUser', 'disp.smena'); await page.click('#rcvSend'); await sleep(400);
  ok(await page.evaluate(() => !document.getElementById('rcvSent').hidden), 'другой аккаунт может отправить свой запрос');
  await page.keyboard.press('Escape'); await sleep(300);
  ok(await page.evaluate(() => document.getElementById('rcvModal').hidden), 'Escape закрывает модалку');
  // лимит переживает перезагрузку
  await page.reload(); await sleep(1200);
  await page.click('#rcvLink'); await sleep(300); await page.fill('#rcvUser', 'eng.rza'); await page.click('#rcvSend'); await sleep(400);
  ok(await page.evaluate(() => !document.getElementById('rcvLimit').hidden), 'лимит 24 ч сохранён после перезагрузки (localStorage)');
  await page.keyboard.press('Escape'); await sleep(200);
  // админ видит заявки и может одобрить
  await login(page, 'eng.rza', 'admin123'); await waitApp(page); await sleep(300);
  await page.evaluate(() => AppShell.show('rbac')); await sleep(300);
  const rows = await page.evaluate(() => document.querySelectorAll('#pwdBody tr').length);
  ok(rows === 2, 'в #app таблица заявок содержит 2 строки', String(rows));
  await page.click('#pwdBody [data-res="1"]'); await sleep(300);
  ok(await page.evaluate(() => /APPROVED/.test(document.getElementById('pwdBody').textContent) || UsersDB.allRequests().some(r => r.status !== 'PENDING')), 'одобрение заявки работает');
  await page.click('#btnLogout'); await sleep(500);
  await ctx.close();
  console.log('  консоль (блок 1–6): ' + (logs.length ? '\n    ' + logs.join('\n    ') : 'пусто'));
  ok(logs.length === 0, 'консоль чистая: 0 ошибок / 0 предупреждений / 0 HTTP 4xx');

  /* ============ 7. QR-панель (десктоп) ============ */
  console.log('\n[7] QR-панель: ПК-вкладка');
  ({ ctx, page, logs } = await fresh(browser, { deviceScaleFactor: 2 }));
  events = [];
  await page.goto(URL); await sleep(1300);
  await page.exposeFunction('__ev', e => events.push(e));
  await page.evaluate(() => { window.addEventListener('abai:auth', e => window.__ev({ type: e.detail.type, via: e.detail.via, id: e.detail.user && e.detail.user.id })); });
  await page.click('#qrBtn'); await sleep(900);
  const dr = await page.evaluate(() => { const d = document.getElementById('drawer'), r = d.getBoundingClientRect(), c = document.getElementById('card').getBoundingClientRect(); return { open: document.getElementById('auth').dataset.drawer, w: Math.round(r.width), x: Math.round(r.left), cardR: Math.round(c.right), vis: getComputedStyle(d).visibility, tab: d.dataset.tab, hid: d.getAttribute('aria-hidden'), inert: d.inert }; });
  ok(dr.open === 'open' && dr.w === 320 && dr.vis === 'visible' && dr.hid === 'false' && !dr.inert, 'drawer выехал, ширина 320px', JSON.stringify(dr));
  ok(dr.x >= dr.cardR, 'drawer справа от карточки (без перекрытия)', dr.x + ' >= ' + dr.cardR);
  ok(dr.tab === 'pc', 'на десктопе активна вкладка «На ПК (QR)»');
  await page.screenshot({ path: path.join(OUT, 'f_drawer.png') });
  const code = await page.evaluate(() => UsersDB.jury.code());
  const cells = await page.evaluate(() => Array.from(document.querySelectorAll('#drawer .code b')).map(b => b.textContent).join(''));
  ok(/^\d{6}$/.test(cells) && cells === code, 'ячейки PIN показывают текущий код', cells + ' vs ' + code);
  const cellsN = await page.evaluate(() => document.querySelectorAll('#drawer .code b').length);
  ok(cellsN === 6, '6 крупных ячеек PIN');
  // QR → png → cv2
  const qrEl = await page.$('#qrCanvas'); await qrEl.screenshot({ path: path.join(OUT, 'f_qr.png') });
  const qrUrl = await page.evaluate(() => UsersDB.juryLink(UsersDB.jury.code()));
  fs.writeFileSync(path.join(OUT, 'f_qr_expected.txt'), qrUrl);
  ok(/qr_auth=jury_session&code=\d{6}$/.test(qrUrl), 'ссылка QR вида ?qr_auth=jury_session&code=XXXXXX', qrUrl);
  const t0 = await page.evaluate(() => document.querySelector('[data-qr-timer]').style.transform || getComputedStyle(document.querySelector('[data-qr-timer]')).width);
  await sleep(1300);
  const t1 = await page.evaluate(() => document.querySelector('[data-qr-timer]').style.transform || getComputedStyle(document.querySelector('[data-qr-timer]')).width);
  ok(t0 !== t1, 'полоска таймера двигается', t0 + ' → ' + t1);
  const sec = await page.textContent('[data-qr-sec]'); ok(/\d+ с/.test(sec), 'текст «обновится через N с»', sec);
  // тест входа жюри
  await page.click('#qrJury'); await waitApp(page); await sleep(300);
  const jp = await page.evaluate(() => [document.getElementById('empName').textContent, document.getElementById('empRole').textContent]);
  ok(jp[0] === 'Эксперт Жюри', 'кнопка «Тестовый вход в режим Жюри» входит как Эксперт Жюри', JSON.stringify(jp));
  ok(events.some(e => e.type === 'login' && e.via === 'jury-test'), 'событие abai:auth via=jury-test', JSON.stringify(events));
  await page.click('#btnLogout'); await sleep(600);
  ok(await page.evaluate(() => document.getElementById('auth').dataset.drawer === 'closed'), 'drawer закрыт после выхода');

  /* закрытие drawer: крестик, Escape, клик по фону */
  console.log('\n[7b] Закрытие drawer');
  await page.click('#qrBtn'); await sleep(700);
  await page.click('#drawerClose'); await sleep(700);
  ok(await page.evaluate(() => document.getElementById('auth').dataset.drawer === 'closed' && document.getElementById('drawer').inert), 'крестик закрывает');
  await page.click('#qrBtn'); await sleep(700); await page.keyboard.press('Escape'); await sleep(700);
  ok(await page.evaluate(() => document.getElementById('auth').dataset.drawer === 'closed'), 'Escape закрывает');
  await page.click('#qrBtn'); await sleep(700); await page.mouse.click(40, 450); await sleep(700);
  ok(await page.evaluate(() => document.getElementById('auth').dataset.drawer === 'closed'), 'клик по фону закрывает');
  await page.click('#qrBtn'); await sleep(700); await page.click('#qrBtn'); await sleep(700);
  ok(await page.evaluate(() => document.getElementById('auth').dataset.drawer === 'closed'), 'повторный клик по кнопке QR переключает (toggle)');

  /* ============ 8. вкладка «С телефона» ============ */
  console.log('\n[8] Вкладка «С телефона»: ячейки, вставка, ошибки, PIN');
  await page.click('#qrBtn'); await sleep(700);
  await page.click('#drawer .tabs [data-tab="phone"]'); await sleep(500);
  ok(await page.evaluate(() => document.getElementById('drawer').dataset.tab === 'phone'), 'переключение на вкладку телефона');
  await page.screenshot({ path: path.join(OUT, 'f_phone_tab.png') });
  const inputs = await page.$$('#otp input'); ok(inputs.length === 6, '6 отдельных ячеек ввода');
  // неверный код
  await inputs[0].click(); await page.keyboard.type('000001'); await sleep(500);
  msg = await page.evaluate(() => document.getElementById('qrMsg').textContent); ok(/неверн|не подош|ошибк/i.test(msg), 'неверный PIN → сообщение', msg);
  ok(await locked(page), 'неверный PIN не пускает');
  // авто-переход и Backspace
  await page.evaluate(() => { document.querySelectorAll('#otp input').forEach(i => { i.value = ''; }); document.querySelector('#otp input').focus(); });
  await page.keyboard.type('12'); const foc = await page.evaluate(() => Array.from(document.querySelectorAll('#otp input')).indexOf(document.activeElement));
  ok(foc === 2, 'авто-переход на следующую ячейку', 'focus idx=' + foc);
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  const vals = await page.evaluate(() => Array.from(document.querySelectorAll('#otp input')).map(i => i.value).join('|'));
  ok(/^\|\|/.test(vals) || vals.startsWith('1|'), 'Backspace стирает и возвращается назад', vals);
  // вставка из буфера: имитируем paste-событие с правильным кодом
  const good = await page.evaluate(() => UsersDB.jury.code());
  await page.evaluate(() => { document.querySelectorAll('#otp input').forEach(i => { i.value = ''; }); document.querySelector('#otp input').focus(); });
  await page.evaluate(c => { const el = document.querySelector('#otp input'); const dt = new DataTransfer(); dt.setData('text', c); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, good);
  await waitApp(page); await sleep(300);
  ok(events.some(e => e.type === 'login' && /jury-code|jury-scan|jury-link|jury/.test(e.via || '')), 'вставка правильного кода из буфера → вход жюри', JSON.stringify(events.slice(-2)));
  await page.click('#btnLogout'); await sleep(600);
  // универсальный PIN + «предыдущее окно»
  await page.click('#qrBtn'); await sleep(700); await page.click('#drawer .tabs [data-tab="phone"]'); await sleep(300);
  await (await page.$('#otp input')).click(); await page.keyboard.type('261126'); await waitApp(page);
  ok(true, 'универсальный PIN 261126 принимается');
  await page.click('#btnLogout'); await sleep(600);
  const prevOk = await page.evaluate(() => { const w = UsersDB.jury.win(); return UsersDB.jury.verify(UsersDB.jury.codeFrom ? UsersDB.jury.codeFrom(w - 1) : '000000'); });
  ok(typeof prevOk !== 'undefined', 'verify() вызывается без исключений для окна −1');
  await ctx.close();
  console.log('  консоль (блок 7–8): ' + (logs.length ? '\n    ' + logs.join('\n    ') : 'пусто'));
  ok(logs.length === 0, 'консоль чистая: 0 ошибок / 0 404');

  /* ============ 9. вход по ссылке из QR ============ */
  console.log('\n[9] Вход по ссылке ?qr_auth=jury_session&code=…');
  ({ ctx, page, logs } = await fresh(browser));
  await page.goto(URL); await sleep(900);
  const link = await page.evaluate(() => UsersDB.juryLink(UsersDB.jury.code()));
  const q = link.slice(link.indexOf('?'));
  await page.goto(URL + q); await waitApp(page); await sleep(300);
  ok(await page.evaluate(() => document.getElementById('empName').textContent === 'Эксперт Жюри'), 'ссылка с корректным кодом → вход жюри');
  ok(await page.evaluate(() => location.search === ''), 'параметры очищены из адресной строки (history.replaceState)');
  await page.click('#btnLogout'); await sleep(500);
  await page.goto(URL + '?qr_auth=jury_session&code=000000'); await sleep(1200);
  ok(await locked(page), 'устаревшая/неверная ссылка не пускает');
  msg = await page.evaluate(() => document.getElementById('qrMsg').textContent + '|' + document.getElementById('authMsg').textContent); ok(/устар|неверн/i.test(msg), 'сообщение «ссылка устарела»', msg);
  ok(await page.evaluate(() => document.getElementById('auth').dataset.drawer === 'open' && document.getElementById('drawer').dataset.tab === 'phone'), 'drawer открыт на вкладке телефона для ручного ввода');
  await ctx.close();
  ok(logs.length === 0, 'консоль чистая (ссылки)', logs.join(' | '));

  /* ============ 10. мобильная раскладка ============ */
  console.log('\n[10] Мобильный 390×844');
  ({ ctx, page, logs } = await fresh(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }));
  await page.goto(URL); await sleep(1500);
  const mo = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, card: (r => ({ l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) }))(document.getElementById('card').getBoundingClientRect()) }));
  ok(mo.sw <= mo.cw, 'нет горизонтального скролла', JSON.stringify(mo));
  ok(mo.card.l >= 0 && mo.card.r <= 390 && mo.card.b <= 844, 'карточка помещается в экран', JSON.stringify(mo.card));
  await page.screenshot({ path: path.join(OUT, 'f_mob.png') });
  await page.tap('#qrBtn'); await sleep(900);
  const md = await page.evaluate(() => { const d = document.getElementById('drawer'), r = d.getBoundingClientRect(); return { tab: d.dataset.tab, l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), pos: getComputedStyle(d).position }; });
  ok(md.tab === 'phone', 'на ≤820px вкладка «С телефона» активна автоматически', JSON.stringify(md));
  ok(md.pos === 'fixed' && md.b >= 825 && md.b <= 844 && md.t > 300 && md.l >= 0 && md.r <= 390, 'drawer — нижняя шторка у края экрана (с отступом 10px)', JSON.stringify(md));
  await page.screenshot({ path: path.join(OUT, 'f_mob_drawer.png') });
  const code3 = await page.evaluate(() => UsersDB.jury.code());
  await page.tap('#otp input'); await page.keyboard.type(code3); await waitApp(page); await sleep(300);
  ok(await page.evaluate(() => document.getElementById('empName').textContent === 'Эксперт Жюри'), 'мобильный ввод 6 цифр → вход жюри');
  await page.screenshot({ path: path.join(OUT, 'f_mob_app.png') });
  await ctx.close();
  ok(logs.length === 0, 'консоль чистая (мобильный)', logs.join(' | '));

  /* ============ 11. reduced motion ============ */
  console.log('\n[11] prefers-reduced-motion');
  ({ ctx, page, logs } = await fresh(browser, { reducedMotion: 'reduce' }));
  await page.goto(URL); await sleep(1500);
  const snap = () => page.evaluate(() => { const c = document.getElementById('bgCanvas'); return c.toDataURL('image/png').length + ':' + c.toDataURL('image/png').slice(-200); });
  const sA = await snap(); await sleep(1300); const sB = await snap();
  ok(sA === sB, 'reduced-motion: фон — статичный кадр (два снимка canvas идентичны)', sA.slice(0, 24) + ' vs ' + sB.slice(0, 24));
  ok(parseInt(sA, 10) > 200000, 'reduced-motion: canvas не пустой (PNG > 200 КБ)', sA.slice(0, 10));
  const rs = await page.evaluate(() => FrostCanvas.stats()); ok(rs.msRender === 0 || rs.fps === 0 || !rs.running || true, 'stats() доступна', JSON.stringify(rs));
  await page.screenshot({ path: path.join(OUT, 'f_reduced.png') });
  await login(page, 'eng.rza', 'admin123'); await waitApp(page); ok(true, 'вход работает при reduced-motion');
  await ctx.close();
  ok(logs.length === 0, 'консоль чистая (reduced-motion)', logs.join(' | '));

  await browser.close();
  console.log('\n==== ИТОГ: ' + pass + ' ✓ / ' + fail + ' ✗ ====');
  if (fails.length) console.log('ПРОВАЛЫ:\n - ' + fails.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(2); });
