/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/app/hardware-link.js  (ЭТАП 3: реальное оборудование)
   Транспорт данных от оборудования, когда DEMO_MODE=false (в DEMO им можно пользоваться тоже: симулятор уступает живому источнику):
     • Web Serial (navigator.serial): ESP32 по USB, строки JSON по 115200 бод;
     • WebSocket к шлюзу FastAPI/Python (ws:// или wss://), те же строки JSON.
   Здесь нет ни интерфейса, ни текстов для людей: только данные, события и стабильные коды ошибок (их переводит hardware-ui.js).

   ПРОТОКОЛ (одна JSON-строка на пакет):  {"t":42.4,"ta":-24.1,"i":780,"u":110.2,"acc":0.12}
     t — температура стыка °C (MLX90614) · ta — воздух °C · i — ток А (INA219 × КТТ) · u — напряжение шины кВ (необязательно) · acc — вибрация g (MPU6050)
     команда в сторону ESP32: {"cmd":"i2c_scan"} → ответ {"i2c":[90,64,104]} (адреса в десятичном виде: 0x5A MLX90614, 0x40 INA219, 0x68 MPU6050).
   ЗАЩИТА ВХОДА: строка ≤ 4 КБ, JSON.parse с вырезанием __proto__/constructor/prototype, только конечные числа в разумных диапазонах, не более 50 пакетов/с,
   никакого eval. Данные не имеют отношения к правам: роли и доступ решает только Store.session (сервер Phase 2).

   СОБЫТИЯ window 'abai:hw', detail.type: state {state,info} · sample {sample,raw} · i2c {devices} · devices {devices,cancelled} · log {dir,line} ·
     error {code,message} · stale · fresh.   Состояния: idle | scanning | connecting | online | error.
   КОДЫ ОШИБОК: UNSUPPORTED, INSECURE, DENIED, BUSY, OPEN_FAIL, LOST, WS_URL, WS_FAIL, TIMEOUT, NO_LINK.
   API: window.HardwareLink = { supported, state, info, devices, log, scan, connect, disconnect, send, i2cScan, parseLine, normalize, isFresh, STALE_MS, _test? } */
(function (g) {
'use strict';
const MAX_LINE = 4096, MAX_RATE = 50, LOG_MAX = 200, STALE_MS = 5000;
const I2C_NAMES = { 0x5A: 'MLX90614', 0x40: 'INA219', 0x68: 'MPU6050' };
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);                // НЕ объектный литерал: в { '__proto__': 1 } такой ключ задаёт прототип, а не свойство, и фильтр молча не работал
const RANGES = { T: [-90, 1500], Ta: [-90, 150], I: [0, 100000], U: [0, 1200], acc: [0, 160], vdc: [0, 1000], soc: [0, 100] };
const ALIAS = { T: ['t', 'T', 'temp', 'tj'], Ta: ['ta', 'Ta', 'tamb'], I: ['i', 'I', 'cur'], U: ['u', 'U', 'kv'], acc: ['acc', 'a', 'vib'], vdc: ['vdc', 'Vdc'], soc: ['soc', 'SOC'] };
const VENDORS = { 0x10C4: 'Silicon Labs CP210x', 0x1A86: 'WCH CH340/CH9102', 0x0403: 'FTDI', 0x303A: 'Espressif USB', 0x2341: 'Arduino', 0x067B: 'Prolific' };

const S = { state: 'idle', kind: null, label: '', baud: 0, url: '', since: null, lastAt: null, samples: 0, bad: 0, error: null };
let ports = new Map(), devs = [], logBuf = [], wantOnline = false, port = null, reader = null, ws = null, wsTimer = 0, wsTry = 0, wdTimer = 0, stale = false;
let rateT = 0, rateN = 0, i2cWait = null;

const emit = d => { try { g.dispatchEvent(new CustomEvent('abai:hw', { detail: d })); } catch (e) { /* нет window */ } };
const info = () => Object.freeze(Object.assign({}, S, { error: S.error ? Object.assign({}, S.error) : null }));
function setState(state, patch) {
  Object.assign(S, patch || {}); S.state = state;
  if (state === 'idle') { S.kind = null; S.label = ''; S.url = ''; S.baud = 0; S.since = null; }
  emit({ type: 'state', state, info: info() });
}
function fail(code, message, toState) {
  S.error = { code, message: String(message || code).slice(0, 200) };
  emit({ type: 'error', code, message: S.error.message });
  if (toState) setState(toState);
}
function pushLog(dir, line) {
  logBuf.push({ t: Date.now(), dir, line: String(line).slice(0, 240) }); if (logBuf.length > LOG_MAX) logBuf.shift();
  emit({ type: 'log', dir, line: String(line).slice(0, 240) });
}

/* ---------- разбор строк (чистые функции, покрыты юнит-проверками) ---------- */
function pick(o, names, lim) {
  for (let k = 0; k < names.length; k++) {
    if (!Object.prototype.hasOwnProperty.call(o, names[k])) continue;
    const v = o[names[k]]; if (typeof v !== 'number' || !isFinite(v)) continue;
    if (v < lim[0] || v > lim[1]) continue; return v;
  }
  return undefined;
}
function normalize(o) {
  if (!o || typeof o !== 'object') return null;
  const s = {}; let n = 0;
  for (const k in RANGES) { const v = pick(o, ALIAS[k], RANGES[k]); if (v !== undefined) { s[k] = v; n++; } }
  ['in1', 'in2', 'dgu'].forEach(k => { if (typeof o[k] === 'boolean' || o[k] === 0 || o[k] === 1) s[k] = !!o[k]; });
  if (o.ats === 1 || o.ats === 2) s.ats = o.ats;
  return n ? s : null;
}
function parseLine(line) {
  if (typeof line !== 'string') return { kind: 'bad', reason: 'TYPE' };
  const t = line.trim(); if (!t) return { kind: 'empty' };
  if (t.length > MAX_LINE) return { kind: 'bad', reason: 'LONG' };
  if (t.charAt(0) !== '{') return { kind: 'log', text: t.slice(0, 200) };
  let o; try { o = JSON.parse(t, (k, v) => (BAD_KEYS.has(k) ? undefined : v)); } catch (e) { return { kind: 'bad', reason: 'JSON' }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { kind: 'bad', reason: 'SHAPE' };
  const a = Array.isArray(o.i2c) ? o.i2c : (o.type === 'i2c' && Array.isArray(o.found) ? o.found : null);
  if (a) return { kind: 'i2c', addrs: a.filter(n => Number.isInteger(n) && n > 0 && n < 128).slice(0, 32) };
  if (o.hello !== undefined || o.type === 'hello') return { kind: 'hello', fw: String(o.fw || o.hello || '').slice(0, 40) };
  const s = normalize(o); return s ? { kind: 'sample', sample: s, raw: o } : { kind: 'bad', reason: 'EMPTY' };
}

/* ---------- приём ---------- */
function onLine(line) {
  const r = parseLine(line);
  if (r.kind === 'empty') return;
  pushLog('rx', line);
  if (r.kind === 'bad') { S.bad++; return; }
  if (r.kind === 'log' || r.kind === 'hello') return;
  if (r.kind === 'i2c') {
    const devices = r.addrs.map(n => ({ addr: '0x' + n.toString(16).toUpperCase().padStart(2, '0'), n, name: I2C_NAMES[n] || 'unknown' }));
    emit({ type: 'i2c', devices }); if (i2cWait) { const w = i2cWait; i2cWait = null; w(devices); } return;
  }
  const now = Date.now(); if (now - rateT >= 1000) { rateT = now; rateN = 0; }
  if (++rateN > MAX_RATE) return;                                                  // не чаще 50 пакетов/с
  S.samples++; S.lastAt = now;
  if (stale) { stale = false; emit({ type: 'fresh' }); }
  const sample = Object.assign({}, r.sample, { ts: now });
  emit({ type: 'sample', sample, raw: r.raw });
}
function feedChunk(buf, chunk) {
  buf += chunk; let i;
  while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
  return buf.length > MAX_LINE * 2 ? '' : buf;                                   // мусор без \n не копим
}

/* ---------- поддержка среды ---------- */
function supported() {
  return { serial: !!(g.navigator && g.navigator.serial), ws: typeof g.WebSocket === 'function', secure: g.isSecureContext !== false };
}
const hex4 = n => ('0000' + (n || 0).toString(16)).slice(-4);
function describe(p, granted, idx) {
  let i = {}; try { i = p.getInfo ? p.getInfo() : {}; } catch (e) { /* нет данных */ }
  const vid = i.usbVendorId, pid = i.usbProductId;
  const id = 'serial:' + (vid !== undefined ? hex4(vid) + ':' + hex4(pid) : 'x') + ':' + idx;
  ports.set(id, p);
  return { id, kind: 'serial', label: (VENDORS[vid] || (vid !== undefined ? 'USB ' + hex4(vid) + ':' + hex4(pid) : 'Serial')) + (idx ? ' #' + (idx + 1) : ''), vid, pid, granted: !!granted };
}

/* ---------- поиск устройств «COM / I²C» ---------- */
async function scan(opts) {
  const interactive = !!(opts && opts.interactive), sp = supported(), out = []; let cancelled = false;
  if (!sp.serial) { fail('UNSUPPORTED', 'navigator.serial'); emit({ type: 'devices', devices: out, cancelled }); return out; }
  const prev = S.state; if (prev === 'idle' || prev === 'error') setState('scanning');
  ports = new Map();
  try { const list = await g.navigator.serial.getPorts(); list.forEach((p, k) => out.push(describe(p, true, k))); } catch (e) { /* политика разрешений */ }
  if (interactive) {
    try {
      if (!sp.secure) throw Object.assign(new Error('insecure'), { name: 'SecurityError' });
      const p = await g.navigator.serial.requestPort();
      if (!out.some(d => ports.get(d.id) === p)) out.push(describe(p, true, out.length));
    } catch (e) {
      if (e && e.name === 'NotFoundError') cancelled = true;                       // пользователь закрыл окно выбора — не ошибка
      else if (e && e.name === 'SecurityError') fail('INSECURE', e.message);
      else fail('DENIED', e && e.message);
    }
  }
  devs = out; if (S.state === 'scanning') setState('idle');
  emit({ type: 'devices', devices: out, cancelled }); return out;
}

/* ---------- подключение ---------- */
async function readLoop(p, rd) {
  const td = new TextDecoder(); let buf = '';
  try {
    for (;;) { const r = await rd.read(); if (r.done) break; if (r.value) buf = feedChunk(buf, td.decode(r.value, { stream: true })); }
  } catch (e) { /* порт выдернут или закрыт */ }
  try { rd.releaseLock(); } catch (e) { /* уже освобождён */ }
  if (port === p && wantOnline) { port = null; reader = null; fail('LOST', 'serial read ended', 'error'); }
}
async function connectSerial(o) {
  if (!supported().serial) { fail('UNSUPPORTED', 'navigator.serial', 'error'); return false; }
  const p = o.port || ports.get(o.id); if (!p) { fail('NO_LINK', 'port'); return false; }
  const baud = +o.baud || +((g.ABAI_CONFIG || {}).SERIAL_BAUD) || 115200;
  setState('connecting', { kind: 'serial', label: o.label || 'Serial', baud, error: null });
  try { await p.open({ baudRate: baud }); }
  catch (e) {
    const busy = e && (e.name === 'InvalidStateError' || /busy|already|in use/i.test(e.message || ''));
    fail(busy ? 'BUSY' : 'OPEN_FAIL', e && e.message, 'error'); return false;
  }
  port = p; reader = p.readable.getReader(); wantOnline = true; S.lastAt = null; S.samples = 0; S.bad = 0; stale = false;
  setState('online', { since: Date.now() }); readLoop(p, reader); startWatchdog(); return true;
}
function wsUrlOk(u) { return typeof u === 'string' && /^wss?:\/\/[^\s/?#]+(:\d+)?([/?#]\S*)?$/i.test(u.trim()) && u.length < 300; }
function wsOpen(url) {
  let sock; try { sock = new g.WebSocket(url); } catch (e) { fail('WS_FAIL', e && e.message, 'error'); return; }
  ws = sock; let buf = '';
  sock.onopen = () => { wsTry = 0; S.lastAt = null; S.samples = 0; S.bad = 0; stale = false; setState('online', { since: Date.now(), error: null }); startWatchdog(); };
  sock.onmessage = ev => { if (typeof ev.data === 'string') buf = feedChunk(buf, ev.data.indexOf('\n') < 0 ? ev.data + '\n' : ev.data); };
  sock.onerror = () => { S.error = { code: 'WS_FAIL', message: 'websocket error' }; };
  sock.onclose = () => {
    if (ws !== sock) return; ws = null;
    if (!wantOnline) return;
    fail('WS_FAIL', 'closed', 'connecting');                                       // переподключение с задержкой 1, 2, 4, 8, 16 с
    const d = Math.min(16000, 1000 * Math.pow(2, wsTry++)); clearTimeout(wsTimer); wsTimer = setTimeout(() => { if (wantOnline && !ws) wsOpen(url); }, d);
  };
}
async function connectWs(o) {
  const url = String(o.url || '').trim();
  if (!supported().ws) { fail('UNSUPPORTED', 'WebSocket', 'error'); return false; }
  if (!wsUrlOk(url)) { fail('WS_URL', url.slice(0, 80), 'error'); return false; }
  await disconnect(true); wantOnline = true; wsTry = 0;
  setState('connecting', { kind: 'ws', label: url, url, error: null }); wsOpen(url); return true;
}
async function connect(o) {
  o = o || {};
  if (S.state === 'online' || S.state === 'connecting') await disconnect(true);
  return o.kind === 'ws' ? connectWs(o) : connectSerial(o);
}
async function disconnect(silent) {
  wantOnline = false; clearTimeout(wsTimer); clearInterval(wdTimer); wdTimer = 0; stale = false;
  const sock = ws; ws = null; if (sock) { sock.onclose = null; try { sock.close(); } catch (e) { /* закрыт */ } }
  const rd = reader, p = port; reader = null; port = null;
  if (rd) { try { await rd.cancel(); } catch (e) { /* уже закрыт */ } try { rd.releaseLock(); } catch (e) { /* ok */ } }
  if (p) { try { await p.close(); } catch (e) { /* ok */ } }
  S.error = null; S.lastAt = null; setState('idle'); return !silent;
}
async function send(x) {
  const line = typeof x === 'string' ? x : JSON.stringify(x);
  if (!line || line.length > 512) return false;
  try {
    if (ws && ws.readyState === 1) { ws.send(line); pushLog('tx', line); return true; }
    if (port && port.writable) { const w = port.writable.getWriter(); try { await w.write(new TextEncoder().encode(line + '\n')); } finally { w.releaseLock(); } pushLog('tx', line); return true; }
  } catch (e) { fail('LOST', e && e.message); }
  return false;
}
function i2cScan(o) {
  const ms = (o && o.timeoutMs) || 2500;
  return new Promise(res => {
    if (S.state !== 'online') { fail('NO_LINK', 'i2c'); res([]); return; }
    const t = setTimeout(() => { if (i2cWait) { i2cWait = null; fail('TIMEOUT', 'i2c_scan'); res([]); } }, ms);
    i2cWait = d => { clearTimeout(t); res(d); };
    send({ cmd: 'i2c_scan' }).then(ok => { if (!ok && i2cWait) { clearTimeout(t); i2cWait = null; res([]); } });
  });
}

/* ---------- сторожевой таймер свежести ---------- */
function isFresh() { return S.state === 'online' && S.lastAt !== null && Date.now() - S.lastAt <= STALE_MS; }
function startWatchdog() {
  clearInterval(wdTimer);
  wdTimer = setInterval(() => {
    if (S.state !== 'online') return;
    const age = S.lastAt === null ? Date.now() - (S.since || Date.now()) : Date.now() - S.lastAt;
    if (age > STALE_MS && !stale) { stale = true; emit({ type: 'stale' }); }
  }, 1000);
}
if (g.navigator && g.navigator.serial && g.navigator.serial.addEventListener) {
  g.navigator.serial.addEventListener('disconnect', () => { if (S.kind === 'serial' && S.state === 'online') { port = null; reader = null; fail('LOST', 'usb disconnect', 'error'); } });
}

const api = {
  supported, state: () => S.state, info, devices: () => devs.slice(), log: () => logBuf.slice(),
  scan, connect, disconnect, send, i2cScan, parseLine, normalize, isFresh, STALE_MS
};
/* тестовый вход строки без транспорта — только в DEMO_MODE (в боевой сборке недоступен; для тестов боевого режима подменяют WebSocket/navigator.serial) */
if (g.ABAI_CONFIG && g.ABAI_CONFIG.DEMO_MODE === true) {
  api._test = Object.freeze({
    feed: line => onLine(line),
    attach: (kind, label) => { wantOnline = true; setState('online', { kind: kind || 'ws', label: label || 'test', since: Date.now(), error: null }); startWatchdog(); }
  });
}
g.HardwareLink = Object.freeze(api);
})(window);
