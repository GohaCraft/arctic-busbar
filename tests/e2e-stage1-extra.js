/* ARCTIC BUSBAR AI v2.4.0-prod: tests/e2e-stage1-extra.js
   Дополнительный набор (24 проверки): окна кода ±30 с, камера (fake device), file://, мобильный #app без переполнения, клавиатура.
   Запуск (из корня проекта):
     python3 -m http.server 8765 --bind 127.0.0.1 &            # сервер статики
     NODE_PATH=$(npm root -g) node tests/e2e-stage1-extra.js                  # нужен playwright (npm i -g playwright) и Chromium
   Переменная ABAI_URL переопределяет адрес страницы. Скриншоты кладутся в tests/out/. Код выхода 0 = всё зелёное. */
const { chromium } = require('playwright');
let pass = 0, fail = 0; const fails = [];
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' :: ' + x : '')); console.log('  ✗ ' + n + (x ? ' → ' + x : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = process.env.ABAI_URL || 'http://127.0.0.1:8765/index.html';
async function mk(browser, opts) { const ctx = await browser.newContext(opts); const page = await ctx.newPage(); const logs = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); }); page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', r => logs.push('REQFAILED: ' + r.url())); page.on('response', r => { if (r.status() >= 400) logs.push('HTTP ' + r.status() + ': ' + r.url()); }); return { ctx, page, logs }; }
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

  console.log('\n[A] Окна кода: ротация каждые 30 с, соседние окна, чужие коды');
  let { ctx, page, logs } = await mk(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(URL); await sleep(1000); await page.click('#qrBtn'); await sleep(1000);
  const w = await page.evaluate(() => {
    const real = Date.now.bind(Date), J = UsersDB.jury, at = off => { Date.now = () => real() + off; const c = J.code(); Date.now = real; return c; };
    const c0 = at(0), cN = at(30000), cP = at(-30000), c2 = at(60000), cM2 = at(-60000);
    return { c0, cN, cP, c2, cM2, vCur: J.verify(c0), vNext: J.verify(cN), vPrev: J.verify(cP), vFar: J.verify(c2) || J.verify(cM2), vUni: J.verify('261126'), vBad: J.verify('12345'), vTxt: J.verify('abc123') };
  });
  ok(w.c0 !== w.cN && w.c0 !== w.cP, 'код меняется от окна к окну', JSON.stringify([w.c0, w.cN, w.cP]));
  ok(w.vCur && w.vNext && w.vPrev, 'verify принимает текущее, предыдущее и следующее окна (допуск расхождения часов ±30 с)');
  ok(!w.vFar, 'verify отклоняет код на 2 окна дальше (±60 с)', String(w.vFar));
  ok(w.vUni, 'универсальный PIN 261126 принимается'); ok(!w.vBad && !w.vTxt, 'короткие/нецифровые строки отклоняются');
  const before = await page.evaluate(() => Array.from(document.querySelectorAll('#drawer .code b')).map(b => b.textContent).join(''));
  await page.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + 31000; });
  await sleep(450);
  const after = await page.evaluate(() => [Array.from(document.querySelectorAll('#drawer .code b')).map(b => b.textContent).join(''), UsersDB.jury.code(), document.querySelector('[data-qr-url]').title]);
  ok(after[0] !== before && after[0] === after[1], 'ячейки PIN обновились при смене окна без перезагрузки', before + ' → ' + after[0]);
  ok(after[2].endsWith('code=' + after[1]), 'ссылка QR обновилась вместе с кодом', after[2]);
  await ctx.close();

  console.log('\n[B] Камера: оверлей сканера (fake device)');
  ({ ctx, page, logs } = await mk(browser, { viewport: { width: 1440, height: 900 }, permissions: ['camera'] }));
  await page.goto(URL); await sleep(1000); await page.click('#qrBtn'); await sleep(900); await page.click('#drawer .tabs [data-tab="phone"]'); await sleep(400);
  await page.click('#camBtn'); await sleep(1500);
  const cam = await page.evaluate(() => ({ vis: !document.getElementById('cam').hidden, msg: document.getElementById('camMsg').textContent, hasStream: !!document.getElementById('camVideo').srcObject }));
  ok(cam.vis && cam.msg.length > 5, 'оверлей камеры открыт и показывает статус', JSON.stringify(cam));
  ok(cam.hasStream || /не поддерж|недоступн|запрещ/.test(cam.msg), 'поток получен (fake) либо понятное сообщение', JSON.stringify(cam));
  await page.click('#camClose'); await sleep(400);
  ok(await page.evaluate(() => document.getElementById('cam').hidden && !document.getElementById('camVideo').srcObject), 'закрытие останавливает камеру и скрывает оверлей');
  ok(logs.length === 0, 'консоль чистая (камера)', logs.join(' | ')); await ctx.close();

  console.log('\n[C] Открытие файла напрямую (file://)');
  ({ ctx, page, logs } = await mk(browser, { viewport: { width: 1440, height: 900 } }));
  await page.goto('file://' + require('path').resolve(__dirname, '../index.html')); await sleep(1500);
  ok(await page.evaluate(() => document.body.classList.contains('locked') && FrostCanvas.ok && document.getElementById('bgCanvas').width > 100), 'экран входа и фон работают с file://');
  const lk = await page.evaluate(() => UsersDB.juryLink('123456'));
  ok(/^http:\/\/192\.168\.4\.1:8000\/\?qr_auth=jury_session&code=123456$/.test(lk), 'ссылка QR при file:// — адрес стенда http://192.168.4.1:8000/', lk);
  await page.click('#qrBtn'); await sleep(900); await page.click('#qrJury'); await page.waitForFunction(() => !document.body.classList.contains('locked'), null, { timeout: 5000 }); ok(true, 'тестовый вход жюри работает с file://');
  ok(logs.length === 0, 'консоль чистая (file://)', logs.join(' | ')); await ctx.close();

  console.log('\n[D] Мобильный #app после входа: нет горизонтального переполнения');
  ({ ctx, page, logs } = await mk(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }));
  await page.goto(URL); await sleep(1000); await page.fill('#loginUser', 'eng.rza'); await page.fill('#loginPass', 'admin123'); await page.tap('#loginBtn');
  await page.waitForFunction(() => !document.body.classList.contains('locked')); await sleep(800);
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); ok(sw[0] === sw[1] && sw[1] === 390, 'ширина страницы = 390 (без раздувания viewport)', JSON.stringify(sw));
  await page.tap('#btnLogout'); await sleep(700); ok(await page.evaluate(() => document.body.classList.contains('locked')), 'выход с телефона возвращает экран входа');
  const sw2 = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); ok(sw2[0] === sw2[1], 'после выхода ширина снова 390', JSON.stringify(sw2));
  ok(logs.length === 0, 'консоль чистая (мобильный #app)', logs.join(' | ')); await ctx.close();

  console.log('\n[E] Клавиатура и фокус');
  ({ ctx, page, logs } = await mk(browser, { viewport: { width: 1440, height: 900 } }));
  await page.goto(URL); await sleep(1000);
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'loginUser'), 'автофокус на поле логина');
  await page.keyboard.type('eng.rza'); await page.keyboard.press('Enter'); await sleep(200);
  ok(await page.evaluate(() => document.activeElement.id === 'loginPass'), 'Enter в логине переводит фокус на пароль');
  await page.keyboard.type('admin123'); await page.keyboard.press('Enter'); await page.waitForFunction(() => !document.body.classList.contains('locked'), null, { timeout: 6000 }); ok(true, 'Enter в пароле — вход с клавиатуры');
  await page.click('#btnLogout'); await sleep(600);
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'loginUser'), 'после выхода фокус возвращается на логин');
  ok(logs.length === 0, 'консоль чистая (клавиатура)', logs.join(' | ')); await ctx.close();

  await browser.close();
  console.log('\n==== ИТОГ (extra): ' + pass + ' ✓ / ' + fail + ' ✗ ===='); if (fails.length) console.log('ПРОВАЛЫ:\n - ' + fails.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
