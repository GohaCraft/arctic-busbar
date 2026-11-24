/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/app/hardware-ui.js  (ЭТАП 3: окно «Подключение оборудования»)
   Интерфейс поверх HardwareLink (транспорт) и PINN (источник данных). Открывается кнопками [data-open="hardware"]: чип «PINN Core» в статус-баре, плашка OFFLINE
   в матрице датчиков, раздел «Оборудование» в настройках. В боевой сборке (DEMO_MODE=false) при первом входе в сессию окно появляется само.
   Окно: статус канала · «Поиск устройств COM / I²C» (Web Serial: выбор порта ESP32) · список портов с кнопкой «Подключить» · найденные на шине I²C MLX90614 / INA219 / MPU6050 ·
   шлюз FastAPI (WebSocket) · последний пакет и журнал обмена · вкладка «Инструкция для инженеров» (статическая разметка в index.html).
   После F5 канал восстанавливается из sessionStorage ('abai.s.hwlast', стирается при выходе): WebSocket и ранее разрешённый COM-порт открываются без жеста.
   При выходе из системы канал закрывается. Все тексты — через I18N (ключи hw.*, core.*); коды ошибок транспорта переводятся здесь.
   API: window.HardwareUI = { open, refresh, devices } */
(function (g) {
'use strict';
const D = document, $ = id => D.getElementById(id), T = (k, p) => g.I18N.t(k, p);
const HL = () => g.HardwareLink, PN = () => g.PINN;
const DEMO = () => !!(g.ABAI_CONFIG && g.ABAI_CONFIG.DEMO_MODE === true);
const SS = { get: k => { try { return g.sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { g.sessionStorage.setItem(k, v); } catch (e) { /* хранилище закрыто */ } }, del: k => { try { g.sessionStorage.removeItem(k); } catch (e) { /* ok */ } } };
const EXPECT = [{ n: 0x5A, name: 'MLX90614', k: 'hw.i2c.ir' }, { n: 0x40, name: 'INA219', k: 'hw.i2c.cur' }, { n: 0x68, name: 'MPU6050', k: 'hw.i2c.vib' }];
const ERR_KEYS = ['UNSUPPORTED', 'INSECURE', 'DENIED', 'BUSY', 'OPEN_FAIL', 'LOST', 'WS_URL', 'WS_FAIL', 'TIMEOUT', 'NO_LINK'];
const SVGNS = 'http://www.w3.org/2000/svg';
let devices = [], i2c = null, i2cBusy = false, scanBusy = false, logLines = [], logTimer = 0, liveAt = 0, stale = false, lastErr = null, i2cTimer = 0;

const el = (tag, cls, text) => { const e = D.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function icon(id) { const s = D.createElementNS(SVGNS, 'svg'), u = D.createElementNS(SVGNS, 'use'); s.setAttribute('class', 'ico'); u.setAttribute('href', '#' + id); s.appendChild(u); return s; }
const visible = () => { const m = $('mHardware'); return !!(m && !m.hidden); };

/* ---------- статус канала ---------- */
function errText(code) { return ERR_KEYS.indexOf(code) >= 0 ? T('hw.e.' + code) : T('hw.e.UNKNOWN'); }
function renderStatus() {
  const hl = HL(), inf = hl.info(), st = inf.state, box = $('hwStatus'); if (!box) return;
  let s = st, t = 'hw.s.' + st, d = 'hw.s.' + st + '.d';
  if (st === 'online') {
    if (stale) { s = 'error'; t = 'hw.s.stale'; d = 'hw.s.stale.d'; }
    else if (!inf.samples) { s = 'connecting'; t = 'hw.s.wait'; d = 'hw.s.wait.d'; }
  }
  const p = { src: inf.kind === 'ws' ? inf.url : inf.label, n: inf.samples, baud: inf.baud };
  $('hwStateT').textContent = T(t);
  $('hwStateD').textContent = st === 'error' && inf.error ? errText(inf.error.code) : T(d, p);
  box.dataset.s = s; $('hwOff').hidden = !(st === 'online' || st === 'connecting');
  $('hwErr').textContent = lastErr && st !== 'error' ? errText(lastErr) : '';
  const sp = hl.supported(); $('hwNoSerial').hidden = sp.serial; $('hwScan').disabled = scanBusy || (!sp.serial && st !== 'online');
}

/* ---------- списки ---------- */
function renderDevices() {
  const box = $('hwDevices'), inf = HL().info(); if (!box) return;
  box.textContent = '';
  devices.forEach(d => {
    const row = el('div', 'hw-dev'), txt = el('div');
    row.dataset.ok = d.granted ? '1' : '0'; row.appendChild(icon('i-chip'));
    txt.appendChild(el('b', '', d.label)); txt.appendChild(el('span', '', d.vid !== undefined ? 'USB ' + d.vid.toString(16).toUpperCase().padStart(4, '0') + ':' + d.pid.toString(16).toUpperCase().padStart(4, '0') : T('hw.dev.noid')));
    row.appendChild(txt);
    if (inf.state === 'online' && inf.kind === 'serial' && inf.label === d.label) row.appendChild(el('span', 'pill pill-ok', T('hw.dev.on')));
    else { const b = el('button', 'btn btn-sm btn-pri', T('hw.dev.use')); b.type = 'button'; b.dataset.dev = d.id; row.appendChild(b); }
    box.appendChild(row);
  });
  $('hwDevNone').hidden = devices.length > 0;
}
function renderI2c() {
  const sec = $('hwI2cSec'), box = $('hwI2c'); if (!sec) return;
  sec.hidden = !i2c; if (!i2c) return;
  box.textContent = '';
  const row = (addr, name, note, ok) => {
    const r = el('div', 'hw-dev'), tx = el('div'); r.dataset.ok = ok ? '1' : '0'; r.appendChild(icon('i-chip'));
    tx.appendChild(el('b', '', addr + ' · ' + name)); tx.appendChild(el('span', '', note)); r.appendChild(tx);
    r.appendChild(el('span', 'pill ' + (ok ? 'pill-ok' : 'pill-warn'), T(ok ? 'hw.i2c.found' : 'hw.i2c.miss'))); box.appendChild(r);
  };
  const hex = n => '0x' + n.toString(16).toUpperCase().padStart(2, '0');
  EXPECT.forEach(x => row(hex(x.n), x.name, T(x.k), i2c.some(d => d.n === x.n)));
  i2c.filter(d => !EXPECT.some(x => x.n === d.n)).forEach(d => row(d.addr, d.name === 'unknown' ? T('hw.i2c.unk') : d.name, T('hw.i2c.other'), true));
  if (!i2c.length) box.appendChild(el('p', 'hw-empty', T('hw.i2c.empty')));
}
function renderLive(sm) {
  const live = $('hwLive'); if (!live) return;
  const f = { T: [sm && sm.T, 1], Ta: [sm && sm.Ta, 1], I: [sm && sm.I, 0], U: [sm && sm.U, 1], acc: [sm && sm.acc, 2] };
  Object.keys(f).forEach(k => { const b = live.querySelector('[data-k="' + k + '"]'); if (b) b.textContent = typeof f[k][0] === 'number' ? f[k][0].toFixed(f[k][1]) : '—'; });
}
function renderLog() { logTimer = 0; const p = $('hwLog'); if (!p || !visible()) return; p.textContent = logLines.slice(-40).map(l => (l.dir === 'tx' ? '→ ' : '← ') + l.line).join('\n'); p.scrollTop = p.scrollHeight; }
function queueLog() { if (!logTimer) logTimer = setTimeout(renderLog, 200); }

/* ---------- источник данных: чип в статус-баре и раздел настроек ---------- */
function renderSource() {
  const src = PN() ? PN().source() : 'none', inf = HL().info(), chip = $('coreStatus'), lbl = $('coreLbl');
  if (chip) { chip.dataset.s = src === 'hw' ? 'ok' : src === 'sim' ? 'sim' : 'off'; if (lbl) lbl.textContent = T(src === 'hw' ? 'core.online' : src === 'sim' ? 'core.sim' : 'core.off'); }
  const pill = $('hwSrcPill'), note = $('hwSrcNote');
  if (pill) { pill.className = 'pill ' + (src === 'hw' ? 'pill-ok' : src === 'sim' ? 'pill-acc' : 'pill-warn'); pill.textContent = T('hw.src.' + src); }
  if (note) note.textContent = T('hw.src.' + src + '.d', { src: inf.kind === 'ws' ? inf.url : inf.label });
}
function refresh() { renderStatus(); renderDevices(); renderI2c(); renderSource(); renderLive(null); renderLog(); }

/* ---------- действия ---------- */
async function runI2c() {
  if (i2cBusy) return; i2cBusy = true;
  try { i2c = await HL().i2cScan(); } finally { i2cBusy = false; }
  renderI2c();
}
async function doScan() {
  if (scanBusy) return; scanBusy = true; lastErr = null; renderStatus();
  try {
    if (HL().state() === 'online') await Promise.all([HL().scan({ interactive: false }), runI2c()]);
    else await HL().scan({ interactive: true });
  } finally { scanBusy = false; }
  devices = HL().devices(); renderDevices(); renderStatus();
}
async function connectDev(id) {
  const d = devices.find(x => x.id === id); if (!d) return;
  lastErr = null; i2c = null; renderI2c();
  const ok = await HL().connect({ kind: 'serial', id, label: d.label, baud: +$('hwBaud').value });
  if (ok) { clearTimeout(i2cTimer); i2cTimer = setTimeout(runI2c, 1800); }                                   // ESP32 перезагружается при открытии порта — даём время
  renderDevices(); renderStatus();
}
function open() { refresh(); if (g.AppShell) g.AppShell.openWnd('mHardware'); HL().scan({ interactive: false }).then(() => { devices = HL().devices(); renderDevices(); }); }
function remember(inf) {
  if (inf.kind === 'ws') SS.set('abai.s.hwlast', JSON.stringify({ kind: 'ws', url: inf.url }));
  else if (inf.kind === 'serial') SS.set('abai.s.hwlast', JSON.stringify({ kind: 'serial', label: inf.label, baud: inf.baud }));
}
async function autoReconnect() {                                                                              // после F5: возвращаем прежний канал без жеста пользователя
  let last = null; try { last = JSON.parse(SS.get('abai.s.hwlast') || 'null'); } catch (e) { last = null; }
  if (!last || HL().state() !== 'idle') return;
  if (last.kind === 'ws' && last.url) HL().connect({ kind: 'ws', url: last.url });
  else if (last.kind === 'serial') {
    const list = await HL().scan({ interactive: false }), d = list.find(x => x.label === last.label) || (list.length === 1 ? list[0] : null);
    devices = HL().devices(); if (d) HL().connect({ kind: 'serial', id: d.id, label: d.label, baud: last.baud });
  }
}

/* ---------- события ---------- */
g.addEventListener('abai:hw', e => {
  const d = e.detail || {};
  if (d.type === 'state') {
    if (d.state === 'online') { stale = false; lastErr = null; remember(d.info); }
    if (d.state === 'scanning' || d.state === 'connecting') lastErr = null;
    renderStatus(); renderDevices(); renderSource();
  } else if (d.type === 'error') { lastErr = d.code; renderStatus(); }
  else if (d.type === 'stale') { stale = true; renderStatus(); }
  else if (d.type === 'fresh') { stale = false; renderStatus(); }
  else if (d.type === 'sample') { const now = Date.now(); if (now - liveAt > 220) { liveAt = now; if (visible()) { renderLive(d.sample); renderStatus(); } } }
  else if (d.type === 'log') { logLines.push({ dir: d.dir, line: d.line }); if (logLines.length > 80) logLines.shift(); if (visible()) queueLog(); }
  else if (d.type === 'i2c') { /* ответ приходит и в промис i2cScan; отдельный рендер не нужен */ }
  else if (d.type === 'devices') { devices = d.devices || []; renderDevices(); }
});
g.addEventListener('abai:source', renderSource);
g.addEventListener('abai:lang', () => { refresh(); });
g.addEventListener('abai:auth', e => {
  const d = e.detail || {};
  if (d.type === 'login') {
    refresh();
    if (d.restored) autoReconnect();
    else if (!DEMO() && PN() && PN().source() === 'none' && !SS.get('abai.s.hwhint')) { SS.set('abai.s.hwhint', '1'); setTimeout(() => { if (!visible() && g.AuthApp && g.AuthApp.isAuthed()) open(); }, 900); }
  } else if (d.type === 'logout') {
    clearTimeout(i2cTimer); HL().disconnect(true); devices = []; i2c = null; logLines = []; stale = false; lastErr = null; refresh();
  }
});
D.addEventListener('click', e => {
  const o = e.target.closest('[data-open="hardware"]'); if (o) { e.preventDefault(); open(); return; }
  const b = e.target.closest('[data-dev]'); if (b && b.closest('#hwDevices')) connectDev(b.dataset.dev);
});
function bind() {
  if (!$('mHardware')) return;
  $('hwScan').addEventListener('click', doScan);
  $('hwOff').addEventListener('click', () => { SS.del('abai.s.hwlast'); i2c = null; HL().disconnect(false).then(refresh); });
  $('hwWsForm').addEventListener('submit', ev => { ev.preventDefault(); lastErr = null; i2c = null; HL().connect({ kind: 'ws', url: $('hwWsUrl').value }); });
  refresh();
}
if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', bind); else bind();
g.HardwareUI = Object.freeze({ open, refresh, devices: () => devices.slice() });
})(window);
