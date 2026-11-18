/* ARCTIC BUSBAR AI v2.4.0-prod: tests/e2e-stage2-app.js
   Набор ЭТАПА 2 — внутренний интерфейс #app: каркас (Ribbon / Topbar / Workspace / Inspector), матрица датчиков, граф Obsidian,
   три демо-сценария, журнал аудита с откатом, плагины, окно «Профиль» (QR/PIN, RBAC, заявки), окно «Настройки» (темы, акцент, 6 языков, бэкап),
   телефон 390×844 (верхняя полоса, нижний Dock, карточки вместо таблиц), 0 ошибок консоли / 0 запросов 404.
   Запуск (из корня проекта):
     python3 -m http.server 8765 --bind 127.0.0.1 &
     NODE_PATH=$(npm root -g) node tests/e2e-stage2-app.js
   ABAI_ONLY=6,7 — прогнать только указанные блоки; ABAI_URL — другой адрес страницы. Скриншоты — tests/out/. Код выхода 0 = всё зелёное. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out'), URL = process.env.ABAI_URL || 'http://127.0.0.1:8765/index.html';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const fails = [];
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗ ' + name + (extra ? '  →  ' + extra : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ONLY = (process.env.ABAI_ONLY || '').split(',').filter(Boolean), want = n => !ONLY.length || ONLY.indexOf(String(n)) >= 0;
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) }).catch(() => {});

async function fresh(browser, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true }, opts));
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
const locked = page => page.evaluate(() => document.body.classList.contains('locked'));
const show = async (page, v) => { await page.evaluate(v => AppShell.show(v), v); await sleep(520); };
async function openProfile(page, tab) {
  const open = await page.evaluate(() => { const w = document.getElementById('mProfile'); return !!w && !w.hidden && w.dataset.open === '1'; });
  if (!open) { const mobile = await page.evaluate(() => innerWidth <= 820); await (mobile ? page.tap('#btnProfileM') : page.click('#btnProfile')); await sleep(600); }
  if (tab) { await page.click('#mProfile .wnd-tab[data-tab="' + tab + '"]'); await sleep(380); }
}
async function closeWnd(page) { await page.keyboard.press('Escape'); await sleep(450); }
async function logout(page) { await openProfile(page, 'id'); await page.click('#btnLogout'); await sleep(900); }
const auditTop = (page, n) => page.evaluate(n => Store.audit.list().slice(0, n).map(e => ({ id: e.id, k: e.k, cat: e.cat, node: e.node, old: e.old, nw: e.nw, rb: !!e.rb, undo: !!e.undo })), n || 6);
async function section(n, title, fn) {
  if (!want(n)) return; console.log('\n[' + n + '] ' + title);
  try { await fn(); } catch (e) { fail++; const em = String(e && e.message || e).split('\n').slice(0, 14).join(' ').replace(/\u001b\[[0-9;]*m/g, ''); fails.push('блок ' + n + ' аварийно завершён :: ' + em); console.log('  ✗ блок ' + n + ' аварийно завершён: ' + em); }
}
async function waitFor(page, fn, arg, ms) { try { await page.waitForFunction(fn, arg, { timeout: ms || 8000, polling: 120 }); return true; } catch (e) { return false; } }
const nodePos = (page, pred) => page.evaluate(pr => {
  const n = ObsidianGraph.nodes().find(x => x.id === pr || x.kind === pr), c = ObsidianGraph.camera(), r = document.getElementById('graphCanvas').getBoundingClientRect();
  return n ? { id: n.id, x: r.left + (n.x - c.x) * c.k + r.width / 2, y: r.top + (n.y - c.y) * c.k + r.height / 2, wx: n.x, wy: n.y } : null;
}, pred);

(async () => {
  const browser = await chromium.launch();
  let ctx, page, logs; const allLogs = [];
  const done = async () => { if (ctx) { allLogs.push(...logs); await ctx.close(); ctx = null; } };

  /* ============ 1. каркас ============ */
  await section(1, 'Каркас #app: Ribbon 48 px, Topbar 48 px, Workspace 100 %, Inspector за краем', async () => {
    ({ ctx, page, logs } = await fresh(browser)); await loginAs(page, 'eng.rza', 'admin123');
    const lay = await page.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(); return { rbw: Math.round(r('ribbon').width), tph: Math.round(r('top').height), mnw: Math.round(r('main').width), vw: innerWidth, inspX: Math.round(r('insp').left), sel: document.querySelectorAll('#top select').length, nav: document.querySelectorAll('#rbNav button').length, gear: document.querySelectorAll('#ribbon [data-open="settings"]').length, scroll: document.documentElement.scrollWidth, ava: document.getElementById('rbAva').textContent, hasCrash: !!document.getElementById('btnCrash') }; });
    ok(lay.rbw === 48, 'Ribbon шириной 48 px', JSON.stringify(lay));
    ok(lay.tph === 48, 'Topbar высотой 48 px');
    ok(Math.abs(lay.mnw - (lay.vw - 48)) <= 1, 'Workspace занимает всё остальное по ширине (100 %)', lay.mnw + ' / ' + (lay.vw - 48));
    ok(lay.sel === 0, 'в шапке нет <select>');
    ok(lay.nav === 4, '4 раздела в Ribbon: датчики, граф, аудит, плагины');
    ok(lay.gear === 1 && lay.hasCrash, 'одна шестерёнка «Настройки» и кнопка быстрого отчёта');
    ok(/^[А-ЯA-Z]{2}$/.test(lay.ava), 'кнопка профиля с аватаром-инициалами', lay.ava);
    ok(lay.inspX >= lay.vw - 2, 'Inspector спрятан за правым краем (translateX)', String(lay.inspX));
    ok(lay.scroll <= lay.vw, 'нет горизонтальной прокрутки');
    ok(await page.evaluate(() => /sans|Inter|SF|system/i.test(getComputedStyle(document.body).fontFamily) && /Mono|Consolas|Menlo|monospace/i.test(getComputedStyle(document.getElementById('tClock')).fontFamily)), 'текст — sans, числа — моноширинный шрифт');
    await shot(page, 's2_app_grid.png');
  }); await done();

  /* ============ 2. матрица датчиков: живые значения без нулей ============ */
  await section(2, 'Матрица датчиков: живые значения, спарклайны', async () => {
    ({ ctx, page, logs } = await fresh(browser)); await loginAs(page, 'eng.rza', 'admin123'); await sleep(1500);
    const s = await page.evaluate(() => PINN.state());
    ok(s.T > 38 && s.T < 48 && s.Rk > 12 && s.Rk < 17 && Math.abs(s.F - 31.5) < 1, 'MLX90614-IR-01: ≈42 °C, R_k ≈ 14 µΩ, усилие 31.5 кН', [s.T, s.Rk, s.F].map(v => +v.toFixed(2)).join(' / '));
    ok(s.I > 700 && s.I < 860 && s.U > 108 && s.U < 112 && s.S > 135 && s.S < 160, 'INA219-CUR-01: ≈780 А, ≈110 кВ, S ≈ 149 МВА', [s.I, s.U, s.S].map(v => +v.toFixed(1)).join(' / '));
    ok(s.freq > 2.5 && s.freq < 4 && s.acc > 0.1 && s.acc < 0.3 && s.status['MPU6050-VIB-01'] === 'ok', 'MPU6050-VIB-01: ≈3.2 Гц, ≈0.18 g, НОРМА', [s.freq, s.acc].map(v => +v.toFixed(2)).join(' / '));
    ok(s.vdc > 214 && s.vdc < 225 && s.soc >= 95 && s.ltoState === 'standby' && s.dgu === 'standby', 'LTO-BAT-BUF: ≈220 В DC, ≈98 %, ожидание ДГУ', [s.vdc, s.soc, s.ltoState].join(' / '));
    const cards = await page.evaluate(() => [...document.querySelectorAll('#sensorGrid .sc')].map(c => ({ canv: !!c.querySelector('canvas'), cal: !!c.querySelector('button[data-calib]'), zeroOnly: /(^|\s)0(\.0)?\s*(°C|µΩ|kN|А|кВ|MVA|Hz|g)\b/.test(c.innerText) })));
    ok(cards.length === 4 && cards.every(c => c.canv && c.cal), '4 карточки: спарклайн + кнопка «Калибровка уставки»', JSON.stringify(cards));
    ok(cards.every(c => !c.zeroOnly), 'в карточках нет нулевых заглушек');
    const px = await page.evaluate(() => [...document.querySelectorAll('#sensorGrid .sc canvas')].map(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 20) n++; return n; }));
    ok(px.every(n => n > 150), 'спарклайны реально нарисованы (непрозрачные пиксели)', px.join(','));
    const tl = () => page.evaluate(() => { const q = PINN.series('temp'); return { n: q.t.length, last: q.t[q.t.length - 1], v: q.v[q.v.length - 1] }; }), c1 = await tl();
    await sleep(1600); const c2 = await tl();
    ok(c1.n > 200 && c2.last > c1.last && c2.v > 30 && c2.v < 60, 'история серии предзаполнена и растёт без обрывов (скользящее окно)', JSON.stringify(c1) + ' → ' + JSON.stringify(c2));
    ok(await page.evaluate(() => document.querySelectorAll('#gridTags button').length >= 4), 'фильтры по типу датчика (чипы)');
    await page.fill('#gridSearch', 'INA'); await sleep(350);
    ok(await page.evaluate(() => [...document.querySelectorAll('#sensorGrid .sc')].filter(c => c.offsetParent !== null && getComputedStyle(c).display !== 'none').length === 1), 'поиск «INA» оставляет одну карточку');
    await page.fill('#gridSearch', ''); await sleep(250);
  }); await done();

  /* ============ 3. топбар и меню демо ============ */
  await section(3, 'Topbar: метрики, часы UTC+7, меню «Испытания стенда»', async () => {
    ({ ctx, page, logs } = await fresh(browser)); await loginAs(page, 'eng.rza', 'admin123');
    const t = await page.evaluate(() => ({ core: document.getElementById('coreStatus').innerText, m: ['tU', 'tI', 'tT', 'tRul', 'tSrc'].map(i => document.getElementById(i).textContent), sec: document.getElementById('secTitle').textContent, demo: document.getElementById('btnDemo').innerText }));
    ok(/PINN Core/i.test(t.core) && /Online/i.test(t.core), 'слева: заголовок раздела + «PINN Core Online»', t.core);
    ok(/^11[01]\.\d$/.test(t.m[0]) && +t.m[1] > 600 && /^\d+\.\d$/.test(t.m[2]) && /ч|h/.test(t.m[3]) && /ВВОД 1/.test(t.m[4]), 'по центру: 110 кВ / ток / стык °C / RUL / ВВОД 1', t.m.join(' | '));
    ok(/Испытания стенда/.test(t.demo), 'справа: выпадающее меню «Испытания стенда (Demo)»', t.demo);
    const c1 = await page.textContent('#tClock'); await sleep(1100); const c2 = await page.textContent('#tClock');
    ok(/^\d\d:\d\d:\d\d$/.test(c1) && c1 !== c2 && (await page.textContent('#tzLabel')) === 'UTC+7', 'живые часы тикают, метка UTC+7', c1 + ' → ' + c2);
    const exp = await page.evaluate(() => new Date(Date.now() + 7 * 36e5).toISOString().slice(11, 16)); ok(c2.slice(0, 5) === exp, 'часы показывают красноярское время (UTC+7)', c2 + ' vs ' + exp);
    await page.click('#btnDemo'); await sleep(350);
    const dm = await page.evaluate(() => { const m = document.getElementById('demoMenu'); return { vis: !m.hidden && m.getBoundingClientRect().height > 40, items: ['demoHeat', 'demoSpoof', 'demoBlackout', 'demoReset'].every(i => !!document.getElementById(i)) }; });
    ok(dm.vis && dm.items, 'меню: 3 сценария + «Сброс»'); await shot(page, 's2_demo_menu.png');
    await page.keyboard.press('Escape'); await sleep(300); ok(await page.evaluate(() => document.getElementById('demoMenu').hidden), 'Escape закрывает меню');
    await page.click('#btnDemo'); await sleep(300); await page.mouse.click(700, 500); await sleep(300); ok(await page.evaluate(() => document.getElementById('demoMenu').hidden), 'клик вне меню закрывает его');
  }); await done();

  /* ============ 4. навигация и Inspector ============ */
  await section(4, 'Навигация по Ribbon, индикатор, Inspector по клику на карточку', async () => {
    ({ ctx, page, logs } = await fresh(browser)); await loginAs(page, 'eng.rza', 'admin123');
    const tops = [], views = ['grid', 'graph', 'audit', 'plugins'];
    for (const v of views) {
      await page.click('#rbNav button[data-view="' + v + '"]'); await sleep(700);
      const r = await page.evaluate(v => ({ view: document.getElementById('app').dataset.view, on: document.getElementById('view-' + v).classList.contains('on'), ind: Math.round(document.getElementById('rbInd').getBoundingClientRect().top), title: document.getElementById('secTitle').textContent }), v);
      tops.push(r.ind); ok(r.view === v && r.on && r.title.length > 3, 'раздел «' + v + '» открывается, заголовок: ' + r.title);
    }
    ok(new Set(tops).size === 4, 'индикатор активного раздела плавно переезжает (4 разные позиции)', tops.join(','));
    ok(await page.evaluate(() => [...document.querySelectorAll('#rbNav button')].every(b => (b.getAttribute('aria-label') || '').length > 2)), 'у иконок есть подписи (tooltip / aria-label)');
    await page.click('#rbNav button[data-view="grid"]'); await sleep(700);
    await page.click('#sensorGrid .sc .sc-desc, #sensorGrid .sc'); await sleep(550);
    const i1 = await page.evaluate(() => { const e = document.getElementById('insp'), r = e.getBoundingClientRect(); return { open: e.classList.contains('open'), w: Math.round(r.width), right: Math.round(r.right), vw: innerWidth, title: document.getElementById('inspTitle').textContent, rows: document.querySelectorAll('#inspBody .in-kv > div').length, fx: document.querySelectorAll('#inspBody .in-fx span').length, name: (document.querySelector('#inspBody .in-id b') || {}).textContent || '' }; });
    ok(i1.open && Math.abs(i1.w - 320) <= 2 && i1.right <= i1.vw + 1, 'клик по карточке: Inspector 320 px выезжает справа', JSON.stringify(i1));
    ok(/MLX90614/.test(i1.name) && i1.rows >= 3 && i1.fx >= 1, 'в Inspector — живые параметры и формулы датчика', i1.name + ' / ' + i1.rows + ' / ' + i1.fx); await shot(page, 's2_inspector.png');
    await page.click('#inspClose'); await sleep(500); ok(await page.evaluate(() => !document.getElementById('insp').classList.contains('open')), 'закрывается крестом ×');
    await page.click('#sensorGrid .sc'); await sleep(450); await page.mouse.click(300, 28); await sleep(500);
    ok(await page.evaluate(() => !document.getElementById('insp').classList.contains('open')), 'закрывается кликом вне панели');
    await page.click('#sensorGrid .sc'); await sleep(400); await page.keyboard.press('Escape'); await sleep(450);
    ok(await page.evaluate(() => !document.getElementById('insp').classList.contains('open')), 'закрывается по Escape');
    ok(await page.evaluate(() => { const c = [...document.querySelectorAll('.btn-pri,.btn-err')]; return !!c.length; }), 'кнопки действия оформлены (Shadcn-кнопки)');
  }); await done();

  /* ============ 5. граф ============ */
  await section(5, 'Граф топологии: Retina, 60 FPS, 12 узлов, hover / drag / zoom / pan / minimap / фильтры', async () => {
    ({ ctx, page, logs } = await fresh(browser, { deviceScaleFactor: 2 })); await loginAs(page, 'eng.rza', 'admin123'); await show(page, 'graph'); await sleep(2200);
    const gs = await page.evaluate(() => { const c = document.getElementById('graphCanvas'), s = ObsidianGraph.stats(); return Object.assign({ cw: c.width, ch: c.height, cssw: c.clientWidth, cssh: c.clientHeight }, s); });
    ok(gs.nodes === 12, '12 узлов топологии', String(gs.nodes)); ok(gs.edges >= 14, 'связей ≥ 14 (питание, резерв, телеметрия)', String(gs.edges));
    ok(gs.cw === Math.round(gs.cssw * 2) && gs.ch === Math.round(gs.cssh * 2) && gs.dpr === 2, 'Retina: холст в 2× разрешении', gs.cw + 'x' + gs.ch + ' / css ' + gs.cssw + 'x' + gs.cssh);
    const names = await page.evaluate(() => ObsidianGraph.nodes().map(n => n.id).sort().join(','));
    ok(names === ['ats', 'bus1', 'bus2', 'core', 'dgu', 'in1', 'in2', 'joint', 'lto', 's_cur', 's_ir', 's_vib'].join(','), 'узлы: Ввод 1/2, АВР, СШ-1/2, стык А-1, Edge-PINN, буфер LTO, ДГУ и 3 датчика', names);
    const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 > 1500) res(n / ((performance.now() - t0) / 1000)); else requestAnimationFrame(f); })(); }));
    ok(fps >= 28 && (await page.evaluate(() => ObsidianGraph.stats().fps)) >= 28, 'частота кадров графа ≥ 28 FPS в headless (на железе 60)', fps.toFixed(0) + ' / ' + (await page.evaluate(() => ObsidianGraph.stats().fps)));
    const dots = await page.evaluate(() => { const c = document.getElementById('graphCanvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < d.length; i += 64) if (d[i + 3] > 40) ink++; return { ink, bg: getComputedStyle(document.getElementById('gWrap')).backgroundImage.indexOf('radial-gradient') >= 0 }; });
    ok(dots.bg && dots.ink > 400, 'тёмное радиальное поле + тонкая точечная сетка, линии и узлы нарисованы на холсте', JSON.stringify(dots));
    await shot(page, 's2_graph.png');
    /* hover */
    const jp = await nodePos(page, 'joint'); await page.mouse.move(jp.x, jp.y, { steps: 6 }); await sleep(800);
    const hv = await page.evaluate(() => ({ h: ObsidianGraph.hover() && ObsidianGraph.hover().id, dim: ObsidianGraph.nodes().filter(n => n.hl < 0.7).length, cur: getComputedStyle(document.getElementById('graphCanvas')).cursor }));
    ok(hv.h === 'joint' && hv.dim >= 3, 'hover подсвечивает узел и плавно приглушает остальные', JSON.stringify(hv));
    await page.mouse.move(jp.x + 500, jp.y + 300, { steps: 6 }); await sleep(900); ok(await page.evaluate(() => ObsidianGraph.nodes().every(n => n.hl > 0.92)), 'уход курсора возвращает яркость узлам');
    /* drag со связанными соседями */
    const b0 = await nodePos(page, 'bus1'), j0 = await nodePos(page, 'joint');
    await page.mouse.move(j0.x, j0.y); await page.mouse.down(); await page.mouse.move(j0.x + 90, j0.y + 60, { steps: 10 }); await sleep(250); await page.mouse.move(j0.x + 130, j0.y + 80, { steps: 8 }); await sleep(500); await page.mouse.up(); await sleep(900);
    const j1 = await nodePos(page, 'joint'), b1 = await nodePos(page, 'bus1');
    ok(Math.hypot(j1.wx - j0.wx, j1.wy - j0.wy) > 40, 'узел перетаскивается мышью', 'Δ=' + Math.round(Math.hypot(j1.wx - j0.wx, j1.wy - j0.wy)));
    ok(Math.hypot(b1.wx - b0.wx, b1.wy - b0.wy) > 4, 'соседи тянутся за узлом на «пружинах»', 'Δ=' + Math.hypot(b1.wx - b0.wx, b1.wy - b0.wy).toFixed(1));
    /* zoom / pan */
    const k0 = await page.evaluate(() => ObsidianGraph.camera().k), box = await page.evaluate(() => { const r = document.getElementById('graphCanvas').getBoundingClientRect(); return { x: r.left + r.width * 0.62, y: r.top + r.height * 0.55 }; });
    await page.mouse.move(box.x, box.y); await page.mouse.wheel(0, -500); await sleep(700); const k1 = await page.evaluate(() => ObsidianGraph.camera().k);
    ok(k1 > k0 * 1.15, 'колесо мыши — масштаб к курсору', k0.toFixed(2) + ' → ' + k1.toFixed(2));
    const cx0 = await page.evaluate(() => ObsidianGraph.camera().x); await page.mouse.move(box.x, box.y + 150); await page.mouse.down(); await page.mouse.move(box.x - 140, box.y + 170, { steps: 8 }); await page.mouse.up(); await sleep(500);
    ok(Math.abs((await page.evaluate(() => ObsidianGraph.camera().x)) - cx0) > 20, 'перетаскивание фона — панорама');
    /* minimap */
    const mm = await page.evaluate(() => { const r = document.getElementById('miniMap').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const before = await page.evaluate(() => ObsidianGraph.camera().x + ',' + ObsidianGraph.camera().y); await page.mouse.click(mm.x + mm.w * 0.2, mm.y + mm.h * 0.25); await sleep(900);
    ok(mm.w > 100 && (await page.evaluate(() => ObsidianGraph.camera().x + ',' + ObsidianGraph.camera().y)) !== before, 'миникарта #miniMap: клик перемещает камеру', before + ' → ' + (await page.evaluate(() => ObsidianGraph.camera().x + ',' + ObsidianGraph.camera().y)));
    await page.click('#gFit'); await sleep(1100); ok(await page.evaluate(() => ObsidianGraph.camera().k) > 0.3, '«Вписать в экран» возвращает полный вид');
    /* фильтры */
    await page.click('#gShowS'); await sleep(1100); ok(await page.evaluate(() => ObsidianGraph.nodes().filter(n => n.kind === 'sensor').every(n => n.vis < 0.15)), 'фильтр «Сенсоры» выключен — датчики скрыты');
    await page.click('#gShowS'); await sleep(1000); ok(await page.evaluate(() => ObsidianGraph.nodes().filter(n => n.kind === 'sensor').every(n => n.vis > 0.9)), 'фильтр включён — датчики вернулись');
    await page.evaluate(() => { const i = document.getElementById('gRep'); i.value = 90; i.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(250); ok((await page.textContent('#gRepV')).trim() === '90', 'ползунок «Отталкивание» меняет значение');
    await page.click('#gpToggle'); await sleep(450); const col = await page.evaluate(() => document.getElementById('gPanel').getBoundingClientRect().height); await page.click('#gpToggle'); await sleep(450); ok(col < 80 && (await page.evaluate(() => document.getElementById('gPanel').getBoundingClientRect().height)) > 200, 'панель фильтров сворачивается и разворачивается');
    await page.fill('#gSearch', 'MLX'); await sleep(900); ok(await page.evaluate(() => { const n = ObsidianGraph.nodes().filter(n => n.hl > 0.9).map(n => n.id); return n.length >= 1 && n.length <= 4; }), 'поиск по узлам подсвечивает найденное'); await page.fill('#gSearch', ''); await sleep(500);
    /* клик по узлу → Inspector, по фону → закрыть */
    await page.click('#gFit'); await sleep(1200); const cp = await nodePos(page, 'core'); await page.mouse.click(cp.x, cp.y); await sleep(600);
    ok(await page.evaluate(() => document.getElementById('insp').classList.contains('open') && (ObsidianGraph.selected() || {}).id === 'core'), 'клик по узлу открывает Inspector с живыми параметрами', await page.evaluate(() => (document.querySelector('#inspBody .in-id b') || {}).textContent));
    await shot(page, 's2_graph_insp.png'); await page.mouse.click(520, 760); await sleep(550); ok(await page.evaluate(() => !document.getElementById('insp').classList.contains('open')), 'клик по пустому полю графа закрывает Inspector');
    await page.click('#gPin'); await sleep(300); ok(await page.evaluate(() => ObsidianGraph.stats().pinned === true), '«Закрепить все» фиксирует раскладку'); await page.click('#gPin'); await sleep(300);
  }); await done();

  /* ============ 6. демо-сценарии ============ */
  await section(6, 'Демо-сценарии: нагрев стыка, помеха пурги, блэкаут', async () => {
    ({ ctx, page, logs } = await fresh(browser)); await loginAs(page, 'eng.rza', 'admin123');
    /* --- нагрев --- */
    await page.evaluate(() => { window.__maxT = 0; window.__maxRk = 0; setInterval(() => { const s = PINN.state(); window.__maxT = Math.max(window.__maxT, s.T); window.__maxRk = Math.max(window.__maxRk, s.Rk); }, 40); });
    await page.click('#btnDemo'); await sleep(300); await page.click('#demoHeat');
    ok(await waitFor(page, () => PINN.state().alarm.active, null, 45000), 'нагрев: температура стыка растёт к 85 °C, включается авария');
    const h = await page.evaluate(() => { const s = PINN.state(); return { T: window.__maxT, Rk: s.Rk, rul: s.rul, src: s.src, ats: s.ats, in1: s.in1, kind: s.alarm.kind, banner: !document.getElementById('alarm').hidden && document.getElementById('alarm').getBoundingClientRect().height > 30, title: document.getElementById('alarmTitle').textContent, toast: document.querySelectorAll('#toasts .toast').length, st: document.querySelector('#sensorGrid .sc[data-sid="MLX90614-IR-01"]').dataset.st }; });
    ok(h.T >= 80 && h.Rk >= 90 && h.rul <= 16 && h.kind === 'heat', 'пик T ≥ 80 °C (→85), R_k → ~95 µΩ, RUL → ~15 мин', [h.T, h.Rk, h.rul].map(v => +(+v).toFixed(1)).join(' / '));
    ok(h.src === 'IN2' && h.ats === 'closed' && h.in1 === 'open', 'АВР автоматически перевёл питание на ВВОД 2', h.src + '/' + h.ats);
    ok(h.banner && /перегрев|heat|overheat/i.test(h.title), 'баннер аварии в потоке страницы', h.title); ok(h.toast >= 1, 'стеклянные Toast-уведомления показаны');
    const a1 = await auditTop(page, 8); ok(a1.some(e => e.k === 'ev.alarm.heat') && a1.some(e => /ats/.test(e.k) || e.cat === 'RELAY'), 'в журнал записаны авария и автопереключение АВР', a1.map(e => e.k).join(','));
    ok(h.st === 'warn' || h.st === 'err', 'карточка датчика вне уставки подсвечена (data-st)', h.st); await shot(page, 's2_heat.png');
    await page.click('#alarmAck'); await sleep(700); ok(await page.evaluate(() => document.getElementById('alarm').hidden && !PINN.state().alarm.active), 'квитирование снимает аварию и скрывает баннер'); ok((await auditTop(page, 4)).some(e => e.k === 'ev.alarm.ack'), 'квитирование записано в журнал');
    await page.click('#btnDemo'); await sleep(300); await page.click('#demoReset'); await sleep(1800);
    ok(await page.evaluate(() => { const s = PINN.state(); return s.T < 50 && !s.alarm.active && s.src === 'IN1' && s.scenario === 'none' && s.ats === 'open'; }), '«Сброс стенда» возвращает штатный режим (ВВОД 1, АВР разомкнут)');
    /* --- помеха --- */
    await page.click('#btnDemo'); await sleep(300); await page.click('#demoSpoof');
    ok(await waitFor(page, () => PINN.state().spoofSeen || PINN.state().guard.active, null, 16000), 'помеха: PINN Kirchhoff Guard распознал скачок ИК без роста тока');
    await sleep(800);
    const sp = await page.evaluate(() => { const f = document.querySelector('#sensorGrid .sc .sc-flag.on'); return { flag: f ? f.textContent : '', trip: PINN.state().alarm.active && PINN.state().alarm.kind === 'heat', ats: PINN.state().ats, T: PINN.state().T }; });
    ok(/Kirchhoff/.test(sp.flag) && /SPOOF/.test(sp.flag), 'плашка «Kirchhoff Guard · SPOOF FILTERED» на карточке', sp.flag);
    ok(!sp.trip && sp.ats === 'open' && sp.T < 55, 'ложного отключения нет: АВР разомкнут, оценка T не выросла', JSON.stringify(sp));
    ok((await auditTop(page, 8)).some(e => /spoof|false|guard/i.test(e.k)), 'в журнале есть запись о фильтрации помехи'); await shot(page, 's2_spoof.png');
    await page.click('#btnDemo'); await sleep(300); await page.click('#demoReset'); await sleep(1600);
    /* --- блэкаут --- */
    await page.click('#btnDemo'); await sleep(300); await page.click('#demoBlackout');
    ok(await waitFor(page, () => PINN.state().U < 5 && PINN.state().ltoState === 'discharge', null, 12000), 'блэкаут: напряжение 0 В, буфер LTO в разряде');
    const b1 = await page.evaluate(() => ({ src: PINN.state().src, name: I18N.t('node.lto'), vdc: PINN.state().vdc, soc: PINN.state().soc })); ok(b1.src === 'LTO' && /55/.test(b1.name) && b1.vdc > 190, 'питание держит буфер LTO (−55 °C), напряжение DC в норме', JSON.stringify(b1));
    ok(await waitFor(page, () => PINN.state().dgu === 'active', null, 45000), 'ДГУ автозапуска переходит в АКТИВЕН');
    const bo = await page.evaluate(() => { const s = PINN.state(); return { src: s.src, I: s.I, U: s.U, banner: !document.getElementById('alarm').hidden, dgu: document.getElementById('view-grid') ? document.querySelector('#sensorGrid .sc[data-sid="LTO-BAT-BUF"]').innerText.replace(/\s+/g, ' ') : '' }; });
    ok(bo.I < 5 && bo.U < 5 && bo.banner, 'напряжение и ток шины 0, баннер «Блэкаут подстанции»', JSON.stringify(bo));
    ok((await auditTop(page, 10)).some(e => e.k === 'ev.blackout'), 'блэкаут записан в журнал'); await shot(page, 's2_blackout.png');
    await show(page, 'graph'); await sleep(1500); ok(await page.evaluate(() => ObsidianGraph.stats().pulses > 0), 'в графе пульсы идут от LTO / ДГУ'); await shot(page, 's2_blackout_graph.png');
    await page.click('#btnDemo'); await sleep(300); await page.click('#demoReset'); await sleep(1600);
  }); await done();

  /* ============ 7. профиль: QR / PIN / выход ============ */
  await section(7, 'Профиль сотрудника: данные, QR + 6-значный PIN (30 с), вход с телефона, выход', async () => {
    ({ ctx, page, logs } = await fresh(browser)); await loginAs(page, 'eng.rza', 'admin123');
    await openProfile(page, 'id');
    const p = await page.evaluate(() => ({ title: document.getElementById('pfTitle').textContent, name: empName.textContent, id: empId.textContent, role: empRole.textContent, badge: empBadge.textContent, sess: empSess.textContent, cfg: cfgString.textContent, tabs: [...document.querySelectorAll('#mProfile .wnd-tab')].map(t => t.dataset.tab).join(','), w: document.querySelector('#mProfile .wnd').getBoundingClientRect().width }));
    ok(/Профиль сотрудника/.test(p.title) && /управление доступом/i.test(p.title), 'заголовок «Профиль сотрудника и управление доступом»', p.title);
    ok(p.name === 'Левицкий А.Р.' && p.id === '1073819' && /Главный Инженер РЗА/.test(p.role) && /Admin|Админ/i.test(p.badge), 'ФИО, табельный ID, должность, плашка роли', JSON.stringify([p.name, p.id, p.role, p.badge]));
    ok(p.tabs === 'id,rbac,req', '3 вкладки: профиль / RBAC / заявки'); ok(p.cfg.length > 8, 'конфиг-строка сессии #cfgString', p.cfg);
    const myPerms = uid => page.evaluate(uid => { const perms = UsersDB.permsOf(uid), li = [...document.querySelectorAll('#pfPerms li')]; return { n: li.length, same: li.every(x => (x.dataset.on === '1') === !!perms[x.dataset.perm]), on: li.filter(x => x.dataset.on === '1').length, txt: li.map(x => x.dataset.perm + '=' + x.dataset.on).join(' ') }; }, uid);
    const mp = await myPerms('1073819'); ok(mp.n === 4 && mp.same && mp.on === 4, 'блок «Мои права доступа»: 4 права, у главного инженера РЗА выданы все', mp.txt);
    const s1 = await page.textContent('#empSess'); await sleep(2200); ok((await page.textContent('#empSess')) !== s1 && /\d\d:\d\d/.test(s1), 'живой таймер сессии тикает', s1 + ' → ' + (await page.textContent('#empSess')));
    const q = await page.evaluate(() => { const c = document.getElementById('pfQr'); return { w: c.width || c.clientWidth, pin: document.getElementById('pfPin').textContent.replace(/\D/g, ''), url: document.getElementById('pfUrl').textContent, sec: +document.getElementById('pfSec').textContent.replace(/\D/g, '') }; });
    ok(q.w >= 120 && /^\d{6}$/.test(q.pin), 'живой QR и одноразовый 6-значный код', q.w + ' / ' + q.pin);
    ok(/qr_auth=session&uid=1073819&code=\d{6}/.test(q.url), 'ссылка привязана к ТЕКУЩЕМУ аккаунту: ?qr_auth=session&uid=<ID>&code=<PIN>', q.url);
    await sleep(2300); const q2 = await page.evaluate(() => +document.getElementById('pfSec').textContent.replace(/\D/g, '')); ok(q.sec >= 1 && q.sec <= 30 && q2 !== q.sec, 'таймер окна 30 с отсчитывает секунды', q.sec + ' → ' + q2);
    await shot(page, 's2_profile.png');
    /* ссылки для телефона — все три аккаунта, в изолированных контекстах */
    const acc = [['1073819', 'Левицкий А.Р.'], ['1073820', 'Соколов И.В.'], ['1073821', 'Эксперт Жюри']];
    for (const [uid, fio] of acc) {
      const qs = await page.evaluate(uid => { const l = UsersDB.session.link(uid); return l.slice(l.indexOf('?')); }, uid);
      const c2 = await fresh(browser); await c2.page.goto(URL + qs); const okLogin = await waitFor(c2.page, () => !document.body.classList.contains('locked'), null, 9000); await sleep(900);
      const who = okLogin ? await c2.page.evaluate(() => document.getElementById('empName').textContent) : '—'; ok(okLogin && who === fio, 'ссылка ?qr_auth=session открывает именно аккаунт ' + uid + ' (' + fio + ')', who);
      allLogs.push(...c2.logs); await c2.ctx.close();
    }
    const c3 = await fresh(browser); await c3.page.goto(URL + '?qr_auth=session&uid=1073820&code=000000'); await sleep(1600); ok(await locked(c3.page), 'неверный код в ссылке не пускает'); allLogs.push(...c3.logs); await c3.ctx.close();
    const c4 = await fresh(browser); await c4.page.goto(URL + '?qr_auth=jury_session&code=261126'); const jOk = await waitFor(c4.page, () => !document.body.classList.contains('locked'), null, 9000); await sleep(700);
    ok(jOk && (await c4.page.evaluate(() => document.getElementById('empName').textContent)) === 'Эксперт Жюри', 'старая ссылка ?qr_auth=jury_session по-прежнему работает'); allLogs.push(...c4.logs); await c4.ctx.close();
    /* ввод PIN в экране входа */
    const pin = await page.evaluate(() => UsersDB.session.code('1073820')), c5 = await fresh(browser); await c5.page.goto(URL); await sleep(1100); await c5.page.click('#qrBtn'); await sleep(900); await c5.page.click('#drawer .tabs [data-tab="phone"]'); await sleep(500);
    await c5.page.click('#otp input'); await c5.page.keyboard.type(pin, { delay: 60 }); const pOk = await waitFor(c5.page, () => !document.body.classList.contains('locked'), null, 8000); await sleep(800);
    ok(pOk && (await c5.page.evaluate(() => document.getElementById('empName').textContent)) === 'Соколов И.В.', 'PIN аккаунта, введённый на экране входа, пускает именно этого сотрудника'); allLogs.push(...c5.logs); await c5.ctx.close();
    /* выход */
    await page.click('#btnLogout'); await sleep(900); ok(await locked(page), '«Выйти из аккаунта» плавно возвращает экран входа');
    ok(await page.evaluate(() => document.getElementById('bgCanvas').width > 100 && FrostCanvas.stats().running), 'фон экрана входа снова живой');
  }); await done();

  /* ============ 8. RBAC ============ */
  await section(8, 'RBAC: матрица прав, переключатели, журнал, откат, ограничения оператора', async () => {
    ({ ctx, page, logs } = await fresh(browser)); await loginAs(page, 'eng.rza', 'admin123'); await openProfile(page, 'rbac');
    const m = await page.evaluate(() => ({ rows: document.querySelectorAll('#rbMatrix .rr:not(.rh)').length, perms: [...document.querySelectorAll('#rbMatrix .p b')].map(b => b.textContent).join(','), sw: document.querySelectorAll('#rbMatrix input[data-rbac]').length, dis: document.querySelectorAll('#rbMatrix input[data-rbac]:disabled').length }));
    ok(m.rows === 4 && m.perms === 'CAN_SWITCH_RELAY,CAN_EDIT_PINN,CAN_ROLLBACK_LOGS,CAN_MANAGE_PLUGINS', '4 права: CAN_SWITCH_RELAY, CAN_EDIT_PINN, CAN_ROLLBACK_LOGS, CAN_MANAGE_PLUGINS', m.perms);
    ok(m.sw === 8 && m.dis === 0, 'Shadcn-переключатели для Admin и Operator (Жюри — фиксированный замок), админ может менять', JSON.stringify(m)); await shot(page, 's2_rbac.png');
    const before = await page.evaluate(() => UsersDB.permsOf('1073820').CAN_SWITCH_RELAY), sel = 'label.sw:has(input[data-rbac="CAN_SWITCH_RELAY"][data-uid="1073820"])';
    await page.click(sel); await sleep(500); const after = await page.evaluate(() => UsersDB.permsOf('1073820').CAN_SWITCH_RELAY);
    ok(before !== after, 'переключатель сохраняет право через UsersDB.setPerm()', before + ' → ' + after);
    const top = (await auditTop(page, 3))[0]; ok(top.cat === 'RBAC' && /rbac/.test(top.k) && /CAN_SWITCH_RELAY/.test(top.node) && top.undo, 'в журнале транзакция RBAC (с возможностью отката)', JSON.stringify(top));
    const rb = await page.evaluate(id => Store.audit.rollback(id), top.id); await sleep(300); ok(rb.ok && (await page.evaluate(() => UsersDB.permsOf('1073820').CAN_SWITCH_RELAY)) === before, 'откат возвращает прежнее право');
    ok((await auditTop(page, 2)).some(e => e.cat === 'ROLLBACK'), 'откат записан отдельной ROLLBACK-транзакцией');
    await page.click('#mProfile .wnd-tab[data-tab="id"]'); await sleep(300);
    const selfSel = 'label.sw:has(input[data-rbac="CAN_EDIT_PINN"][data-uid="1073819"])'; await page.click('#mProfile .wnd-tab[data-tab="rbac"]'); await sleep(300); await page.click(selfSel); await sleep(500); await page.click('#mProfile .wnd-tab[data-tab="id"]'); await sleep(300);
    ok(await page.evaluate(() => { const li = document.querySelector('#pfPerms li[data-perm="CAN_EDIT_PINN"]'); return !!li && li.dataset.on === '0' && !UsersDB.permsOf('1073819').CAN_EDIT_PINN; }), '«Мои права доступа» сразу отражают смену права в матрице (CAN_EDIT_PINN отозвано)');
    await page.click('#mProfile .wnd-tab[data-tab="rbac"]'); await sleep(300); await page.click(selfSel); await sleep(400);
    ok(await page.evaluate(() => UsersDB.permsOf('1073819').CAN_EDIT_PINN === true), 'право возвращено обратно'); await page.click('#mProfile .wnd-tab[data-tab="rbac"]').catch(() => {});
    await closeWnd(page); await logout(page);
    await loginAs(page, 'disp.smena', 'operator123'); await openProfile(page, 'rbac');
    ok(await page.evaluate(() => [...document.querySelectorAll('#rbMatrix input[data-rbac]')].every(i => i.disabled)), 'у оператора переключатели недоступны (только чтение)');
    await page.click('#mProfile .wnd-tab[data-tab="id"]'); await sleep(300);
    const opP = await page.evaluate(() => { const perms = UsersDB.permsOf('1073820'), li = [...document.querySelectorAll('#pfPerms li')]; return { n: li.length, same: li.every(x => (x.dataset.on === '1') === !!perms[x.dataset.perm]), on: li.filter(x => x.dataset.on === '1').length, off: li.filter(x => x.dataset.on === '0').length }; });
    ok(opP.n === 4 && opP.same && opP.off >= 1, 'у оператора «Мои права доступа» совпадают с матрицей (выдано не всё: отозванные права помечены замком)', JSON.stringify(opP));
    await page.click('#mProfile .wnd-tab[data-tab="rbac"]'); await sleep(300);
    await page.click('#mProfile .wnd-tab[data-tab="req"]'); await sleep(400); ok(await page.evaluate(() => !document.getElementById('rqLock').hidden), 'вкладка заявок у оператора закрыта сообщением о правах');
    await closeWnd(page);
    await page.evaluate(() => ScadaUI.openCalibration('T_max')); await sleep(600);
    ok(await page.evaluate(() => document.getElementById('cbApply').disabled && !document.getElementById('cbPerm').hidden && document.getElementById('cbInput').disabled), 'калибровка уставки заблокирована без CAN_EDIT_PINN');
    await closeWnd(page);
    ok(await page.evaluate(() => { const b = document.querySelector('#view-plugins') && ScadaUI.can('CAN_MANAGE_PLUGINS'); return b === false || b === undefined; }), 'оператору недоступно управление плагинами');
  }); await done();

  /* ============ 9. заявки на сброс пароля ============ */
  await section(9, 'Заявки на сброс пароля: счётчик, одобрить (временный пароль + копирование), отклонить', async () => {
    ({ ctx, page, logs } = await fresh(browser)); await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new (require('url').URL)(URL).origin }).catch(() => {});
    await loginAs(page, 'eng.rza', 'admin123');
    ok(await page.evaluate(() => { const b = document.getElementById('cPwd'); return !b || b.hidden || b.textContent.trim() === '' || b.textContent.trim() === '0'; }), 'без заявок бейдж на кнопке профиля скрыт');
    await page.evaluate(() => { UsersDB.requestReset('disp.smena'); UsersDB.requestReset('jury.qr'); }); await sleep(700);
    const cnt = await page.evaluate(() => ({ rb: document.getElementById('cPwd').textContent.trim(), tab: document.getElementById('pfReqCount').textContent.trim() }));
    ok(cnt.rb === '2', 'бейдж на кнопке профиля показывает необработанные заявки (2)', JSON.stringify(cnt));
    await openProfile(page, 'req'); ok((await page.evaluate(() => document.querySelectorAll('#pwdBody tr').length)) === 2 && (await page.textContent('#pfReqCount')).trim() === '2', 'вкладка: живой список из UsersDB.allRequests() и счётчик 2');
    await shot(page, 's2_requests.png');
    await page.click('#pwdBody [data-res="1"]'); await sleep(600);
    const ap = await page.evaluate(() => { const t = document.querySelector('#pwdBody .rq-tmp b'); return { tmp: t ? t.textContent : '', st: UsersDB.allRequests().map(r => r.status).join(',') }; });
    ok(/^.{6,}$/.test(ap.tmp) && /APPROVED/.test(ap.st), '«Одобрить» выдаёт временный пароль', JSON.stringify(ap));
    await page.click('#pwdBody [data-copy]'); await sleep(500);
    const cb = await page.evaluate(() => navigator.clipboard.readText().catch(() => null)); ok((cb !== null && cb === ap.tmp) || (await page.evaluate(() => document.querySelectorAll('#toasts .toast').length)) > 0, 'копирование временного пароля в один клик', String(cb));
    await page.click('#pwdBody [data-res="0"]'); await sleep(500);
    ok(await page.evaluate(() => UsersDB.allRequests().map(r => r.status).sort().join(',') === 'APPROVED,REJECTED') && (await page.textContent('#pfReqCount')).trim() === '0', '«Отклонить» закрывает вторую заявку, счётчик 0');
    const ev = (await auditTop(page, 6)); ok(ev.filter(e => /pwd|req|reset/.test(e.k)).length >= 2, 'решения по заявкам записаны в журнал', ev.map(e => e.k).join(','));
    const who = await page.evaluate(() => UsersDB.allRequests().find(r => r.status === 'APPROVED')), login = who && (await page.evaluate(id => UsersDB.byId(id) && UsersDB.byId(id).login, who.userId || who.uid || who.id));
    await closeWnd(page); await logout(page);
    const logTarget = login || 'disp.smena'; await page.fill('#loginUser', logTarget); await page.fill('#loginPass', ap.tmp); await page.click('#loginBtn'); ok(await waitFor(page, () => !document.body.classList.contains('locked'), null, 7000), 'вход по временному паролю работает (' + logTarget + ')');
  }); await done();

  /* ============ 10. настройки ============ */
  await section(10, 'Настройки: темы, акцент, анимации, часовой пояс, 6 языков без перезагрузки', async () => {
    ({ ctx, page, logs } = await fresh(browser)); await loginAs(page, 'eng.rza', 'admin123');
    await page.evaluate(() => { window.__noReload = 1; }); await page.click('#btnSettings'); await sleep(700);
    const cats = await page.evaluate(() => [...document.querySelectorAll('#mSettings .st-nav button')].map(b => b.dataset.cat).join(',')); ok(cats === 'ui,lang,perf,db', 'меню категорий: Интерфейс / Язык / Производительность / БД', cats);
    ok(await page.evaluate(() => document.querySelectorAll('#themeGrid .theme-card').length === 3 && document.querySelectorAll('#langGrid .lang-btn').length === 6), '3 темы и 6 языков'); await shot(page, 's2_settings.png');
    const bgs = {}; for (const t of ['amber', 'light', 'dark']) { await page.click('#themeGrid .theme-card[data-theme="' + t + '"]'); await sleep(450); bgs[t] = await page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor, getComputedStyle(document.getElementById('app')).getPropertyValue('--acc').trim()].join('|')); }
    ok(new Set(Object.values(bgs).map(v => v.split('|')[1])).size === 3 && Object.keys(bgs).every(k => bgs[k].startsWith(k)), 'темы Dark Obsidian / Amber Industrial / Light Engineering мгновенно меняют палитру', JSON.stringify(bgs));
    await page.evaluate(() => { const i = document.getElementById('inpAccent'); i.value = '#22c55e'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(400);
    ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--acc').trim().toLowerCase() === '#22c55e' && Store.get('accent').toLowerCase() === '#22c55e'), 'выбор акцентного цвета сразу меняет --acc');
    await page.click('#accAuto'); await sleep(350); ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--acc').trim().toLowerCase() !== '#22c55e'), '«по теме» возвращает акцент темы');
    await page.click('#mSettings .st-nav button[data-cat="perf"]'); await sleep(350);
    const an0 = await page.evaluate(() => document.body.classList.contains('no-animations')); await page.click('label.sw:has(#chkAnim)'); await sleep(300); ok((await page.evaluate(() => document.body.classList.contains('no-animations'))) !== an0, 'переключатель плавных анимаций работает'); await page.click('label.sw:has(#chkAnim)'); await sleep(250);
    await page.click('#mSettings .st-nav button[data-cat="lang"]'); await sleep(350);
    const tz0 = await page.textContent('#tzLabel'); const tzBtns = await page.evaluate(() => document.querySelectorAll('#segTz button').length); if (tzBtns > 1) { await page.click('#segTz button[data-v="utc3"]'); await sleep(250); }
    ok(tzBtns >= 2 && (await page.textContent('#tzLabel')) !== tz0, 'часовой пояс переключается, метка в шапке меняется', tz0 + ' → ' + (await page.textContent('#tzLabel')));
    await page.click('#segTz button[data-v="utc7"]'); await sleep(250); ok((await page.textContent('#tzLabel')) === 'UTC+7', 'возврат к UTC+7 (Норильск) мгновенно меняет метку');
    const seen = {}, DEMO = {};
    for (const l of ['en', 'zh', 'kk', 'be', 'uk', 'ru']) {
      await page.click('#langGrid .lang-btn[data-lang="' + l + '"]'); await sleep(350);
      const r = await page.evaluate(() => ({ lang: I18N.get(), html: document.documentElement.lang, demo: document.getElementById('btnDemo').innerText.trim(), auth: document.getElementById('authTitle').textContent.trim(), nav: document.getElementById('secTitle').textContent.trim(), st: document.getElementById('stTitle').textContent.trim(), reload: window.__noReload }));
      seen[l] = r; DEMO[l] = r.demo + '|' + r.auth + '|' + r.nav;
      ok(r.lang === l && r.html === l && r.reload === 1, 'язык ' + l.toUpperCase() + ' применён мгновенно, без перезагрузки', JSON.stringify(r));
    }
    ok(new Set(Object.values(DEMO)).size === 6, 'все 6 языков дают разные тексты в #app и на экране входа (#auth)', Object.values(DEMO).join(' ‖ '));
    await page.click('#langGrid .lang-btn[data-lang="en"]'); await sleep(300); ok(await page.evaluate(() => /Calibrate|setpoint/i.test(document.querySelector('#sensorGrid .sc [data-calib]').textContent) && /Sensor|Matrix/i.test(document.getElementById('secTitle').textContent)), 'EN: карточки и заголовки переведены');
    await page.click('#mSettings .st-nav button[data-cat="perf"]'); await sleep(350);
    ok(await page.evaluate(() => document.querySelectorAll('#segTele button').length >= 2 && document.querySelectorAll('#segFps button').length >= 2), 'раздел «Производительность»: частота телеметрии и FPS');
    await page.click('#langGrid, #mSettings .st-nav button[data-cat="lang"]').catch(() => {});
    await closeWnd(page); await page.reload(); await sleep(1400);
    ok(await page.evaluate(() => I18N.get() === 'en' && !/[А-Яа-я]/.test(document.getElementById('authTitle').textContent)), 'язык сохраняется между перезагрузками, экран входа переведён (EN)');
    await page.evaluate(() => Store.set('lang', 'ru')); await sleep(300);
  }); await done();

  /* ============ 11. полный языковой аудит DOM ============ */
  await section(11, 'Языковой аудит: нет «сырых» ключей, нет кириллицы в EN/ZH — #app, окна, Inspector, #auth', async () => {
    ({ ctx, page, logs } = await fresh(browser));
    await ctx.addInitScript(() => { let real; Object.defineProperty(window, 'I18N', { configurable: true, get() { return real; }, set(v) { const t = v.t; v.t = function (k, p, l) { if (!v.has(k)) { (window.__missing = window.__missing || new Set()).add(k); } return t.call(v, k, p, l); }; real = v; } }); });
    await page.goto(URL); await sleep(1100);
    const SCAN = () => {
      const out = [], seen = new Set(), vis = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (!t) continue; const el = n.parentElement; if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(el.tagName) || !vis(el)) continue; const key = t + '|' + (el.id || el.className); if (seen.has(key)) continue; seen.add(key); out.push(t); }
      document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el => ['placeholder', 'title', 'aria-label'].forEach(a => { const v = el.getAttribute(a); if (v) out.push(v); }));
      return out;
    };
    const RAW = /(^|[\s(«"])((?:a|al|auth|badge|cam|cat|cb|common|core|cr|demo|dock|ev|g|grid|in|insp|kv|name|nav|nd|node|nt|p|pd|perm|pf|qr|rb|rcv|role|rq|sc|sd|set|src|st|t|tag|th|thr|toast|tz|u|via|act)(?:\.[A-Za-z0-9_\-]{1,24}){1,3})(?=$|[\s)»".,;:])/;
    const FIO = /(Левицкий А\.Р\.|Соколов И\.В\.|Эксперт Жюри|Русский|Қазақша|Беларуская|Українська)/, probs = [];   // данные учётных записей и самоназвания языков (эндонимы) не переводятся
    const scan = async (lang, where) => { (await page.evaluate(SCAN)).forEach(t => { if (/\b(undefined|NaN|null)\b|\[object/.test(t)) probs.push(lang + ':' + where + ' BAD «' + t.slice(0, 50) + '»'); const m = t.match(RAW); if (m && !/^(eng|disp|jury|users)\./.test(m[2]) && !/\.(js|json|csv|png|html|py)$/.test(m[2])) probs.push(lang + ':' + where + ' RAW «' + t.slice(0, 50) + '»'); if ((lang === 'en' || lang === 'zh') && /[А-Яа-яЁё]/.test(t.replace(FIO, ''))) probs.push(lang + ':' + where + ' CYR «' + t.slice(0, 60) + '»'); }); };
    await page.evaluate(() => Store.set('lang', 'en')); await sleep(300); await scan('en', 'auth'); await page.evaluate(() => Store.set('lang', 'ru'));
    await page.fill('#loginUser', 'eng.rza'); await page.fill('#loginPass', 'admin123'); await page.click('#loginBtn'); await page.waitForFunction(() => !document.body.classList.contains('locked'), null, { timeout: 8000 }); await sleep(1800);
    for (const l of ['ru', 'en', 'zh', 'kk', 'be', 'uk']) {
      await page.evaluate(l => Store.set('lang', l), l); await sleep(300);
      for (const v of ['grid', 'graph', 'audit', 'plugins']) { await show(page, v); await sleep(300); await scan(l, v); }
      await show(page, 'grid');
      for (const id of ['MLX90614-IR-01', 'LTO-BAT-BUF']) { await page.evaluate(id => ScadaUI.inspect({ kind: 'sensor', id }), id); await sleep(450); await scan(l, 'insp-' + id); }
      for (const id of ['ats', 'joint', 'dgu']) { await page.evaluate(id => ScadaUI.inspect(id), id); await sleep(400); await scan(l, 'insp-' + id); }
      await page.evaluate(() => ScadaUI.closeInspector()); await sleep(300);
      await page.click('#btnDemo'); await sleep(350); await scan(l, 'demo'); await page.keyboard.press('Escape'); await sleep(250);
      await page.evaluate(() => ScadaUI.openCalibration('T_max')); await sleep(500); await scan(l, 'calib'); await closeWnd(page);
      await show(page, 'plugins'); await page.evaluate(() => ScadaUI.openPluginEditor(null)); await sleep(500); await scan(l, 'plugin-new'); await closeWnd(page); await show(page, 'grid');
      await openProfile(page, 'id'); await scan(l, 'profile-id'); for (const tab of ['rbac', 'req']) { await page.click('#mProfile .wnd-tab[data-tab="' + tab + '"]'); await sleep(350); await scan(l, 'profile-' + tab); } await closeWnd(page);
      await page.click('#btnSettings'); await sleep(600); for (const c of ['ui', 'lang', 'perf', 'db']) { await page.click('#mSettings .st-nav button[data-cat="' + c + '"]'); await sleep(320); await scan(l, 'set-' + c); } await closeWnd(page);
      await page.evaluate(() => AppShell.openWnd('mCrash')); await sleep(450); await scan(l, 'crash'); await closeWnd(page);
    }
    const miss = await page.evaluate(() => [...(window.__missing || [])]);
    ok(miss.length === 0, 'все запрошенные ключи есть в словаре (I18N.t не промахивается)', miss.join(', '));
    ok(probs.length === 0, 'нет сырых ключей, undefined/NaN и кириллицы в EN/ZH (6 языков × все экраны, окна, Inspector, #auth)', probs.slice(0, 6).join(' ‖ '));
    const avaOf = async l => { await page.evaluate(l => Store.set('lang', l), l); await sleep(300); return page.evaluate(() => ({ rb: document.getElementById('rbAva').textContent, m: document.getElementById('mAva').textContent })); };
    const avRu = await avaOf('ru'), avEn = await avaOf('en'), avZh = await avaOf('zh'), avUk = await avaOf('uk');
    ok(avRu.rb === 'ЛА' && avEn.rb === 'LA' && avZh.rb === 'LA' && avUk.rb === 'ЛА' && avEn.m === 'LA', 'инициалы аватара следуют языку: ЛА на кириллических интерфейсах, LA на EN/ZH', JSON.stringify([avRu, avEn, avZh, avUk]));
    await page.evaluate(() => Store.set('lang', 'ru'));
  }); await done();

  /* ============ 12. аудит: фильтры, сортировка, откат, CSV ============ */
  await section(12, 'Журнал аудита: предзаполнение, фильтры, сортировка, Rollback, CSV', async () => {
    ({ ctx, page, logs } = await fresh(browser)); await loginAs(page, 'eng.rza', 'admin123'); await show(page, 'audit');
    const a = await page.evaluate(() => ({ rows: document.querySelectorAll('#auditBody tr').length, total: Store.audit.count(), users: new Set(Store.audit.list().map(e => e.user)).size, cats: new Set(Store.audit.list().map(e => e.cat)).size, tab: document.querySelectorAll('#auditTable th[data-sort]').length }));
    ok(a.total >= 25 && a.rows >= 10 && a.users >= 2 && a.cats >= 4, 'журнал предзаполнен реалистичными записями (' + a.total + ' шт., ' + a.cats + ' типов)', JSON.stringify(a));
    ok(a.tab >= 4, 'столбцы сортируются (кликабельные заголовки)'); await shot(page, 's2_audit.png');
    const firstId = async () => page.evaluate(() => document.querySelector('#auditBody tr .au-tx').textContent), id0 = await firstId();
    await page.click('#auditTable th[data-sort="tx"], #auditTable th[data-sort="ts"]'); await sleep(350); const id1 = await firstId(); await page.click('#auditTable th[data-sort="tx"], #auditTable th[data-sort="ts"]'); await sleep(350);
    ok(id1 !== id0 || (await firstId()) !== id0, 'сортировка по столбцу меняет порядок', id0 + ' / ' + id1 + ' / ' + (await firstId()));
    const total0 = await page.evaluate(() => document.querySelectorAll('#auditBody tr').length);
    await page.evaluate(() => ScadaUI.auditFilter({ period: '24h' })); await sleep(250); const p24 = await page.evaluate(() => document.querySelectorAll('#auditBody tr').length);
    await page.evaluate(() => ScadaUI.auditFilter({ period: 'all' })); await sleep(250);
    ok(p24 <= total0 && p24 >= 1, 'фильтр «Период» сужает выборку', total0 + ' → ' + p24);
    await page.evaluate(() => ScadaUI.auditFilter({ user: '1073820' })); await sleep(250); ok(await page.evaluate(() => [...document.querySelectorAll('#auditBody tr')].every(r => /Соколов/.test(r.innerText)) && document.querySelectorAll('#auditBody tr').length > 0), 'фильтр «Сотрудник»');
    await page.evaluate(() => ScadaUI.auditFilter({ user: '' })); await sleep(200);
    await page.evaluate(() => ScadaUI.auditFilter({ type: 'PLUGIN' })); await sleep(250); ok(await page.evaluate(() => document.querySelectorAll('#auditBody tr').length > 0 && [...document.querySelectorAll('#auditBody tr')].length <= Store.audit.list().filter(e => e.cat === 'PLUGIN').length), 'фильтр «Тип события»');
    await page.evaluate(() => ScadaUI.auditFilter({ type: '' })); await sleep(200);
    /* живая запись + откат: калибровка уставки */
    const cnt0 = await page.evaluate(() => Store.audit.count()); await page.evaluate(() => ScadaUI.openCalibration('T_max')); await sleep(600);
    await page.fill('#cbInput', '90'); await page.click('#cbApply'); await sleep(700);
    ok(await page.evaluate(() => Store.thr.get('T_max') === 90) && (await page.evaluate(() => Store.audit.count())) === cnt0 + 1, 'калибровка T_max=90 °C сохранена и записана в журнал');
    const calE = (await auditTop(page, 1))[0]; await show(page, 'audit'); await sleep(300);
    await page.evaluate(() => ScadaUI.auditFilter({ period: 'all', user: '', type: '' })); await sleep(250);
    const rbBtn = await page.evaluate(id => { const b = document.querySelector('#auditBody [data-rb="' + id + '"]'); return b ? b.dataset.rb : null; }, calE.id);
    ok(!!rbBtn, 'у новой записи есть кнопка «Откатить (Rollback)»', String(rbBtn));
    await page.click('[data-rb="' + rbBtn + '"]'); await sleep(700);
    ok(await page.evaluate(() => Store.thr.get('T_max') === 85), 'Rollback возвращает прежнюю уставку 85 °C'); ok((await auditTop(page, 3)).some(e => e.cat === 'ROLLBACK'), 'откат записан транзакцией ROLLBACK');
    ok(await page.evaluate(id => !document.querySelector('[data-rb="' + id + '"]'), rbBtn), 'повторный откат невозможен (запись помечена)');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }).catch(() => null), page.click('#auditCsv')]);
    const csvName = dl ? dl.suggestedFilename() : '', csvText = dl ? fs.readFileSync(await dl.path(), 'utf8') : '';
    ok(/\.csv$/i.test(csvName) && /TX_ID/.test(csvText) && csvText.split('\n').length > 10, 'экспорт .CSV скачивается', csvName + ' / ' + csvText.split('\n').length + ' строк');
  }); await done();

  /* ============ 13. плагины ============ */
  await section(13, 'Плагины: включение/выключение, JSON-параметры, свой плагин JS/Python', async () => {
    ({ ctx, page, logs } = await fresh(browser)); await loginAs(page, 'eng.rza', 'admin123'); await show(page, 'plugins');
    const pl = await page.evaluate(() => ({ rows: document.querySelectorAll('#plugList .pl-row').length, on: document.querySelectorAll('#plugList .pl-row[data-on="1"]').length, cnt: document.getElementById('plCount').textContent }));
    ok(pl.rows === 9 && pl.on === 6, '9 встроенных плагинов, 6 включены', JSON.stringify(pl)); await shot(page, 's2_plugins.png');
    const was = await page.evaluate(() => Store.plugins.enabled('VOICE-ALARM-TTS')); await page.click('label.sw:has(input[data-pl-on="VOICE-ALARM-TTS"])'); await sleep(500);
    ok((await page.evaluate(() => Store.plugins.enabled('VOICE-ALARM-TTS'))) === !was, 'тумблер включает плагин VOICE-ALARM-TTS');
    const e0 = (await auditTop(page, 3))[0]; ok(/plugin/.test(e0.k) && e0.node === 'VOICE-ALARM-TTS' && e0.undo, 'изменение записано в журнал с возможностью отката', JSON.stringify(e0));
    await page.evaluate(id => Store.audit.rollback(id), e0.id); await sleep(300); ok((await page.evaluate(() => Store.plugins.enabled('VOICE-ALARM-TTS'))) === was, 'Rollback возвращает прежнее состояние плагина');
    await page.click('[data-pl-cfg="PINN-KIRCHHOFF-GUARD"]'); await sleep(600);
    const ed = await page.evaluate(() => ({ open: document.getElementById('mPlugin').dataset.open === '1', params: document.getElementById('plParams').value }));
    ok(ed.open && /\{/.test(ed.params), '⚙ открывает JSON-параметры плагина', ed.params.slice(0, 60));
    await page.fill('#plParams', '{ bad json'); await page.click('#plSave'); await sleep(350); ok(await page.evaluate(() => document.getElementById('plErr').textContent.length > 3), 'невалидный JSON отклоняется с понятной ошибкой');
    await page.fill('#plParams', '{"tol_C": 7, "hold_s": 5}'); await page.click('#plSave'); await sleep(600); ok(await page.evaluate(() => JSON.stringify(Store.plugins.get('PINN-KIRCHHOFF-GUARD').params).indexOf('"tol_C":7') >= 0), 'новые параметры применены');
    await page.click('#btnAddPlugin'); await sleep(600);
    /* контракт пользовательского JS-плагина: тело функции, на входе plugin = {packet, params, state}, на выходе {alarm, note} */
    await page.fill('#plName', 'MY-TEST-PLUGIN'); await page.fill('#plCode', "return { alarm: plugin.packet.temp > -100 && plugin.params.on === true, note: 'MY-PLUGIN-HIT ' + Math.round(plugin.packet.temp) };");
    await page.fill('#plParams', '{"on": true}'); await page.click('#plSave'); await sleep(700);
    ok(await page.evaluate(() => !!Store.plugins.get('MY-TEST-PLUGIN') && document.querySelectorAll('#plugList .pl-row').length === 10), 'собственный JS-плагин добавлен в список (10 шт.)');
    ok(await waitFor(page, () => Store.audit.list().some(e => e.k === 'ev.plugin.alarm' && e.node === 'MY-TEST-PLUGIN' && /MY-PLUGIN-HIT/.test(e.nw)), null, 6000), 'свой плагин реально исполняется на такте симуляции: получает пакет и параметры, его alarm попадает в журнал');
    await page.click('#btnAddPlugin'); await sleep(500); await page.fill('#plName', 'BAD-WINDOW'); await page.fill('#plCode', "window.__hack = 1; localStorage.setItem('x', '1'); return { alarm: false };"); await page.click('#plSave'); await sleep(900);
    ok(await waitFor(page, () => !!document.querySelector('#plugList .pl-row[data-id="BAD-WINDOW"] .pill-err'), null, 5000) && await page.evaluate(() => window.__hack === undefined && localStorage.getItem('x') === null), 'плагин не получает window/localStorage: ошибка показана в строке, сайт не затронут');
    await page.click('#btnAddPlugin'); await sleep(500); await page.fill('#plName', 'BAD-SYNTAX'); await page.fill('#plCode', 'return {{ alarm'); await page.click('#plSave'); await sleep(400);
    ok(await page.evaluate(() => document.getElementById('plErr').textContent.length > 3 && !Store.plugins.get('BAD-SYNTAX')), 'синтаксическая ошибка JS отклоняется при сохранении, плагин не создаётся'); await page.click('#mPlugin [data-close]').catch(() => page.keyboard.press('Escape')); await sleep(400);
    await page.click('[data-pl-del="BAD-WINDOW"]'); await sleep(500);
    await page.click('[data-pl-del="MY-TEST-PLUGIN"]'); await sleep(600); ok(await page.evaluate(() => !Store.plugins.get('MY-TEST-PLUGIN') && !Store.plugins.get('BAD-WINDOW') && document.querySelectorAll('#plugList .pl-row').length === 9), 'свои плагины можно удалить (остаются 9 встроенных)');
    await page.click('#btnAddPlugin'); await sleep(500); await page.fill('#plName', 'PY-TEST'); await page.selectOption('#plLang', 'py');
    await page.fill('#plCode', 'def run(state):\n    return state'); await page.click('#plSave'); await sleep(700);
    ok(await page.evaluate(() => { const p = Store.plugins.get('PY-TEST'); return !!p && p.lang === 'py' && /def run/.test(p.code) && !!document.querySelector('#plugList .pl-row[data-id="PY-TEST"] .pill-acc') && !document.querySelector('#plugList .pl-row[data-id="PY-TEST"] .pill-err'); }), 'плагин на Python сохраняется с меткой PY и не исполняется в браузере (Phase 2: сервер FastAPI)');
  }); await done();

  /* ============ 14. бэкап ============ */
  await section(14, 'База данных: экспорт .json, восстановление, сброс демо', async () => {
    ({ ctx, page, logs } = await fresh(browser)); await loginAs(page, 'eng.rza', 'admin123'); await page.click('#btnSettings'); await sleep(600); await page.click('#mSettings .st-nav button[data-cat="db"]'); await sleep(350);
    ok(await page.evaluate(() => document.getElementById('dbStat').innerText.length > 5), 'показан размер данных', await page.textContent('#dbStat'));
    await page.evaluate(() => { Store.thr.set('I_max', 1400); }); await sleep(200);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }).catch(() => null), page.click('#btnBackup')]);
    const nm = dl ? dl.suggestedFilename() : '', txt = dl ? fs.readFileSync(await dl.path(), 'utf8') : '{}', j = (() => { try { return JSON.parse(txt); } catch (e) { return {}; } })();
    ok(/^arctic-busbar-backup-.*\.json$/.test(nm) && j.app === 'ARCTIC BUSBAR AI' && Array.isArray(j.audit) && j.audit.length > 20 && j.thresholds && +j.thresholds.I_max === 1400 && Array.isArray(j.plugins) && j.users, '«Экспорт бэкапа (.json)»: настройки, уставки, плагины, журнал, пользователи', nm + ' ' + Object.keys(j).join(','));
    ok(!/pass_override|tempPassword/.test(txt), 'временные пароли в бэкап не попадают');
    const bpath = path.join(OUT, 'backup-test.json'); fs.writeFileSync(bpath, txt);
    await page.evaluate(() => { Store.thr.set('I_max', 900); Store.set('theme', 'light'); }); await sleep(250);
    await page.setInputFiles('#fileRestore', bpath); await sleep(900);
    ok(await page.evaluate(() => Store.thr.get('I_max') === 1400), '«Восстановление из бэкапа» возвращает уставки'); ok(await page.evaluate(() => Store.get('theme') === 'dark' || Store.get('theme') === 'amber'), 'и настройки интерфейса (тема)');
    ok((await auditTop(page, 3)).some(e => /restore/.test(e.k)), 'восстановление записано в журнал');
    await page.setInputFiles('#fileRestore', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') }); await sleep(700); ok(await page.evaluate(() => Store.thr.get('I_max') === 1400 && document.querySelectorAll('#toasts .toast').length > 0), 'чужой/битый файл отклоняется с сообщением, данные не тронуты');
    await page.evaluate(() => { Store.plugins.add({ id: 'TMP-RESET', lang: 'js', code: 'return {alarm:false};', params: {} }); }); await sleep(200);
    await page.click('#btnResetDemo'); await sleep(250);
    ok(await page.evaluate(() => document.getElementById('btnResetDemo').dataset.arm === '1' && Store.thr.get('I_max') === 1400), '«Сброс демо»: первый клик только взводит подтверждение, данные не тронуты');
    await page.click('#btnResetDemo'); await sleep(900);
    ok(await page.evaluate(() => Store.thr.get('I_max') === 1250 && Store.plugins.list().length === 9 && !Store.plugins.get('TMP-RESET') && document.getElementById('btnResetDemo').dataset.arm === '0'), '«Сброс демо» (второй клик) возвращает заводские уставки, 9 плагинов и убирает свои');
  }); await done();

  /* ============ 15. телефон ============ */
  await section(15, 'Телефон 390×844: верхняя полоса 44 px, нижний Dock, карточки вместо таблиц, окна-шторки', async () => {
    ({ ctx, page, logs } = await fresh(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })); await loginAs(page, 'eng.rza', 'admin123', true);
    const m = await page.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(); return { top: Math.round(r('top').height), rb: getComputedStyle(document.getElementById('ribbon')).display, dock: r('mdock').height, dockBtns: document.querySelectorAll('#mdock button').length, dockPos: getComputedStyle(document.getElementById('mdock')).position, sw: document.documentElement.scrollWidth, vw: innerWidth, bd: getComputedStyle(document.getElementById('mdock')).backdropFilter || getComputedStyle(document.getElementById('mdock')).webkitBackdropFilter }; });
    ok(m.top === 44, 'верхняя стеклянная полоса 44 px', JSON.stringify(m)); ok(m.rb === 'none', 'левый Ribbon на телефоне скрыт');
    ok(m.dockPos === 'fixed' && m.dockBtns === 5 && m.dock >= 50 && /blur/.test(m.bd), 'нижний Dock: фиксированный, «морозное» стекло, 5 кнопок (датчики, граф, аудит, плагины, настройки)', JSON.stringify(m));
    ok(m.sw <= m.vw, 'нет горизонтального переполнения на главной');
    await shot(page, 's2_m_grid.png');
    for (const v of ['graph', 'audit', 'plugins', 'grid']) { await page.tap('#mdock [data-view="' + v + '"]'); await sleep(900); ok(await page.evaluate(v => document.getElementById('app').dataset.view === v && document.documentElement.scrollWidth <= innerWidth, v), 'Dock → «' + v + '», без боковой прокрутки'); if (v === 'graph') await shot(page, 's2_m_graph.png'); if (v === 'audit') await shot(page, 's2_m_audit.png'); if (v === 'plugins') await shot(page, 's2_m_plugins.png'); }
    await page.tap('#mdock [data-view="audit"]'); await sleep(700);
    const au = await page.evaluate(() => { const th = document.querySelector('#auditTable thead'), tr = document.querySelector('#auditBody tr'), cs = tr && getComputedStyle(tr); return { th: th ? getComputedStyle(th).display : 'none', trDisp: cs && cs.display, w: tr && Math.round(tr.getBoundingClientRect().width), vw: innerWidth }; });
    ok(au.th === 'none' && au.trDisp !== 'table-row' && au.w <= au.vw - 8, 'таблица аудита → стек-карточки', JSON.stringify(au));
    await page.tap('#mdock [data-view="plugins"]'); await sleep(600); ok(await page.evaluate(() => document.querySelector('#plugList .pl-row').getBoundingClientRect().width <= innerWidth - 8), 'плагины — карточки без боковой прокрутки');
    await page.tap('#mdock [data-view="grid"]'); await sleep(500);
    await page.tap('#sensorGrid .sc'); await sleep(600); const sh = await page.evaluate(() => { const r = document.getElementById('insp').getBoundingClientRect(); return { open: document.getElementById('insp').classList.contains('open'), w: Math.round(r.width), bottom: Math.round(r.bottom), vh: innerHeight, vw: innerWidth }; });
    ok(sh.open && sh.w >= sh.vw - 2 && sh.bottom <= sh.vh + 2, 'Inspector на телефоне — нижняя шторка на всю ширину', JSON.stringify(sh)); await shot(page, 's2_m_insp.png'); await page.tap('#inspClose'); await sleep(500);
    await page.tap('#btnProfileM'); await sleep(800);
    for (const tab of ['id', 'rbac', 'req']) { await page.tap('#mProfile .wnd-tab[data-tab="' + tab + '"]'); await sleep(450); const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth, w: Math.round(document.querySelector('#mProfile .wnd').getBoundingClientRect().width) })); ok(ov.sw <= ov.vw && ov.w <= ov.vw, 'профиль, вкладка «' + tab + '» — шторка без переполнения', JSON.stringify(ov)); if (tab === 'rbac') { ok(await page.evaluate(() => getComputedStyle(document.querySelector('#rbMatrix .rr.rh')).display === 'none' && getComputedStyle(document.querySelector('#rbMatrix .rr:not(.rh)')).display === 'grid' && document.querySelector('#rbMatrix .who') && getComputedStyle(document.querySelector('#rbMatrix .who')).display !== 'none'), 'RBAC на телефоне — стек-карточки (право → сотрудник → переключатель)'); await shot(page, 's2_m_rbac.png'); } }
    await page.keyboard.press('Escape'); await sleep(500);
    await page.tap('#mdock [data-open="settings"]'); await sleep(800);
    for (const c of ['ui', 'lang', 'perf', 'db']) { await page.tap('#mSettings .st-nav button[data-cat="' + c + '"]'); await sleep(400); ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'настройки, раздел «' + c + '» — без боковой прокрутки'); } await shot(page, 's2_m_settings.png');
    await page.keyboard.press('Escape'); await sleep(450);
    await page.tap('#btnDemoM'); await sleep(450); ok(await page.evaluate(() => !document.getElementById('demoMenu').hidden && document.getElementById('demoMenu').getBoundingClientRect().right <= innerWidth + 1), 'кнопка Demo в верхней полосе открывает меню сценариев'); await page.keyboard.press('Escape');
  }); await done();

  /* ============ 16. консоль и сеть ============ */
  console.log('\n[16] Консоль и сеть за весь прогон');
  ok(allLogs.length === 0, 'консоль чистая: 0 ошибок / 0 предупреждений / 0 запросов 4xx', allLogs.slice(0, 5).join(' | '));
  await browser.close();
  console.log('\n==== ИТОГ (этап 2, #app): ' + pass + ' ✓ / ' + fail + ' ✗ ====');
  if (fails.length) console.log('ПРОВАЛЫ:\n - ' + fails.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
