/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/core/store.js  (единое хранилище состояния, БЕЗ DOM-разметки)
   Настройки (язык, тема, акцент, анимации, пояс, частота телеметрии), уставки датчиков, плагины, ЖУРНАЛ АУДИТА с откатом (Rollback),
   бэкап / восстановление .json, палитра для canvas. Подключается после users-db.js и i18n.js.
   API: window.Store. События (window): abai:settings {key,value}, abai:thresholds {key,value,old}, abai:plugins {id},
   abai:audit {entry}, abai:restored (после восстановления бэкапа / сброса демо-данных).
   Журнал: записи языконезависимы ({k, p} — ключ и параметры i18n), поэтому при смене языка весь журнал переводится мгновенно.
   Данные хранятся в localStorage (при недоступности — в памяти вкладки). Фаза 2: те же методы поверх REST FastAPI + PostgreSQL. */
(function (g) {
'use strict';
const KEY = { settings: 'abai.settings', audit: 'abai.audit', thr: 'abai.thresholds', plug: 'abai.plugins' };
const VERSION = '2.4.0-prod', AUDIT_CAP = 500;
const mem = {};
const load = (k, d) => { try { const v = g.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return k in mem ? mem[k] : d; } };
const save = (k, v) => { mem[k] = v; try { g.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* остаётся в памяти */ } };
const emit = (name, detail) => g.dispatchEvent(new CustomEvent(name, { detail }));
const pad = n => String(n).padStart(2, '0');
const DB = () => g.UsersDB, TT = (k, p) => (g.I18N ? g.I18N.t(k, p) : k);

/* ======================= НАСТРОЙКИ ======================= */
const DEFAULTS = { lang: 'ru', theme: 'dark', accent: null, anim: true, tz: 'utc7', tele: 4, fps: 60, fx: true };
const TZ = { utc3: 3, utc7: 7, utc8: 8, utc0: 0 };
const ENUM = { lang: ['ru', 'en', 'zh', 'kk', 'be', 'uk'], theme: ['dark', 'amber', 'light'], tz: Object.keys(TZ), tele: [2, 4, 10], fps: [30, 60] };
let settings = Object.assign({}, DEFAULTS, load(KEY.settings, {}));
function sane(k, v) {
  if (k === 'accent') return /^#[0-9a-f]{6}$/i.test(v || '') ? String(v).toLowerCase() : null;
  if (k === 'anim' || k === 'fx') return !!v;
  if (k === 'tele' || k === 'fps') { v = +v; return ENUM[k].indexOf(v) >= 0 ? v : DEFAULTS[k]; }
  return ENUM[k] && ENUM[k].indexOf(v) < 0 ? DEFAULTS[k] : v;
}
Object.keys(DEFAULTS).forEach(k => { settings[k] = sane(k, settings[k]); });

const lum = hex => { const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
let pal = null;
function applySetting(k) {
  const root = document.documentElement;
  if (k === 'theme') root.dataset.theme = settings.theme;
  else if (k === 'accent') {
    if (settings.accent) { root.style.setProperty('--acc', settings.accent); root.style.setProperty('--acc-fg', lum(settings.accent) > .42 ? '#06121C' : '#FFFFFF'); }
    else { root.style.removeProperty('--acc'); root.style.removeProperty('--acc-fg'); }
  } else if (k === 'anim') document.body.classList.toggle('no-animations', !settings.anim);
  else if (k === 'lang' && g.I18N) g.I18N.set(settings.lang);
  if (k === 'theme' || k === 'accent') pal = null;
}
function get(k) { return k ? settings[k] : Object.assign({}, settings); }
function set(k, v) {
  if (!(k in DEFAULTS)) return false;
  v = sane(k, v); if (settings[k] === v) return false;
  const old = settings[k]; settings[k] = v; save(KEY.settings, settings); applySetting(k);
  emit('abai:settings', { key: k, value: v, old }); return true;
}
const tzOffset = () => (TZ[settings.tz] == null ? 7 : TZ[settings.tz]);
const tzLabel = () => 'UTC' + (tzOffset() >= 0 ? '+' : '') + tzOffset();
const fmtClock = (off, ts) => { const d = new Date((ts == null ? Date.now() : ts) + (off == null ? tzOffset() : off) * 36e5); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()); };
const fmtDT = ts => { const d = new Date(ts + tzOffset() * 36e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()); };
const toInput = ts => fmtDT(ts).slice(0, 16).replace(' ', 'T');                                              // для <input type=datetime-local>
const fromInput = s => { const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - tzOffset() * 36e5 : NaN; };

/* палитра для canvas (читается из CSS-переменных активной темы) */
function palette(refresh) {
  if (pal && !refresh) return pal;
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  pal = { bg: v('--background'), card: v('--card'), card2: v('--card-2'), fg: v('--foreground'), mute: v('--muted-foreground'), subtle: v('--subtle'), border: v('--border'), borderStrong: v('--border-strong'),
    acc: v('--acc'), ok: v('--ok'), warn: v('--warn'), err: v('--err'), dot: v('--grid-dot'), sans: v('--font-sans'), mono: v('--font-mono'), light: document.documentElement.dataset.theme === 'light' };
  return pal;
}
function rgba(c, a) {
  c = String(c || '#888').trim(); let m;
  if ((m = /^#([0-9a-f]{3})$/i.exec(c))) c = '#' + m[1].split('').map(x => x + x).join('');
  if ((m = /^#([0-9a-f]{6})$/i.exec(c))) { const n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  if ((m = /^rgba?\(([^)]+)\)/i.exec(c))) { const p = m[1].split(',').map(x => x.trim()); return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')'; }
  return c;
}

/* ======================= УСТАВКИ ======================= */
const THR = {
  T_max: { sensor: 'MLX90614-IR-01', unit: '°C', min: 50, max: 120, def: 85, dec: 1 },
  I_max: { sensor: 'INA219-CUR-01', unit: 'A', min: 600, max: 2500, def: 1250, dec: 0 },
  A_max: { sensor: 'MPU6050-VIB-01', unit: 'g', min: 0.2, max: 2, def: 0.8, dec: 2 },
  U_min: { sensor: 'LTO-BAT-BUF', unit: 'V', min: 150, max: 215, def: 198, dec: 0 }
};
const thrDefaults = () => { const o = {}; Object.keys(THR).forEach(k => { o[k] = THR[k].def; }); return o; };
let thr = Object.assign(thrDefaults(), load(KEY.thr, {}));
const thrFmt = (k, v) => (+v).toFixed(THR[k].dec);
function thrSet(k, v) {
  if (!THR[k]) return { ok: false, reason: 'KEY' };
  v = +v; if (!isFinite(v) || v < THR[k].min || v > THR[k].max) return { ok: false, reason: 'RANGE', min: THR[k].min, max: THR[k].max };
  const old = thr[k]; thr[k] = v; save(KEY.thr, thr); emit('abai:thresholds', { key: k, value: v, old }); return { ok: true, old, value: v };
}

/* ======================= ПЛАГИНЫ ======================= */
const BUILTIN = [
  { id: 'IEC61850-RX-TAP', cat: 'p.c1', ver: '1.3.0', lat: 4, on: true, params: { iface: 'eth1', mode: 'RX-only', sv_rate_hz: 4000 } },
  { id: 'PINN-KIRCHHOFF-GUARD', cat: 'p.c2', ver: '2.4.0', lat: 12, on: true, params: { max_rate_c_per_s: 1.2, hold_s: 6 } },
  { id: 'LWIR-BLIZZARD-FILTER', cat: 'p.c3', ver: '1.1.2', lat: 8, on: true, params: { window: 5, median: true } },
  { id: 'ATS-AUTO-TRANSFER', cat: 'p.c9', ver: '1.2.1', lat: 6, on: true, params: { rul_min: 15 } },
  { id: 'LTO-DGU-STARTER', cat: 'p.c4', ver: '1.5.0', lat: 3, on: true, params: { start_delay_s: 3 } },
  { id: 'EXPORT-XLSX-PDF', cat: 'p.c5', ver: '1.0.4', lat: 21, on: true, params: { format: 'csv', bom: true } },
  { id: 'VOICE-ALARM-TTS', cat: 'p.c6', ver: '0.9.1', lat: 35, on: false, params: { lang: 'ru-RU', rate: 1 } },
  { id: 'TG-WEBHOOK-GATE', cat: 'p.c7', ver: '1.2.0', lat: 120, on: false, params: { url: 'https://hooks.example.com/abai', method: 'POST' } },
  { id: 'NANOCAD-PASSPORT', cat: 'p.c8', ver: '0.8.0', lat: 48, on: false, params: { project: 'PS-110-NORILSK', dwg: 'passport.dwg' } }
];
const clone = o => JSON.parse(JSON.stringify(o));
function plugDefaults() { return BUILTIN.map(p => Object.assign(clone(p), { builtin: true, lang: 'js' })); }
function plugMerge(saved) {                                                                                   // встроенные всегда на месте, пользовательские — из сохранённого
  const by = {}; (saved || []).forEach(p => { if (p && p.id) by[p.id] = p; });
  const out = plugDefaults().map(d => { const s = by[d.id]; if (s) { d.on = !!s.on; if (s.params && typeof s.params === 'object') d.params = s.params; delete by[d.id]; } return d; });
  Object.keys(by).forEach(id => { const s = by[id]; if (!s.builtin) out.push({ id: s.id, cat: 'p.custom', ver: s.ver || '0.1.0', lat: s.lat || 1, on: !!s.on, params: s.params || {}, builtin: false, lang: s.lang === 'py' ? 'py' : 'js', code: String(s.code || '') }); });
  return out;
}
let plugs = plugMerge(load(KEY.plug, null));
const plug = {
  list: () => plugs, get: id => plugs.find(p => p.id === id) || null, enabled: id => { const p = plug.get(id); return !!(p && p.on); },
  setOn(id, on) { const p = plug.get(id); if (!p) return null; const old = p.on; p.on = !!on; save(KEY.plug, plugs); emit('abai:plugins', { id, on: p.on, old }); return { old, value: p.on }; },
  setParams(id, params) { const p = plug.get(id); if (!p) return null; const old = p.params; p.params = params; save(KEY.plug, plugs); emit('abai:plugins', { id, params, oldParams: old }); return { old, value: params }; },
  add(def) {
    if (!def || !/^[A-Za-z0-9._-]{2,40}$/.test(def.id || '') || plug.get(def.id)) return { ok: false, reason: plug.get(def && def.id) ? 'DUP' : 'ID' };
    const p = { id: def.id, cat: 'p.custom', ver: '0.1.0', lat: 1, on: true, params: def.params || {}, builtin: false, lang: def.lang === 'py' ? 'py' : 'js', code: String(def.code || '') };
    plugs.push(p); save(KEY.plug, plugs); emit('abai:plugins', { id: p.id, added: true }); return { ok: true, plugin: p };
  },
  remove(id) { const p = plug.get(id); if (!p || p.builtin) return false; plugs = plugs.filter(x => x !== p); save(KEY.plug, plugs); emit('abai:plugins', { id, removed: true }); return true; }
};

/* ======================= ЖУРНАЛ АУДИТА ======================= */
const SYS = { userId: 'SYS', user: 'PINN-Core', role: 'system' };
const undoers = {};
let audit = load(KEY.audit, null);
const curUser = () => (g.AuthApp && g.AuthApp.user && g.AuthApp.user()) || null;
const nextId = () => { let m = 104200; audit.forEach(e => { const n = +String(e.id).replace(/\D/g, ''); if (n > m) m = n; }); return 'TX-' + (m + 1); };
function log(e) {
  const u = e.sys ? null : (e.userObj || curUser());
  const entry = { id: nextId(), ts: e.ts || Date.now(), userId: u ? u.id : SYS.userId, user: u ? u.fio : SYS.user, role: u ? u.role : SYS.role,
    cat: e.cat, k: e.k, p: e.p || {}, node: e.node || '', old: e.old == null ? '' : String(e.old), nw: e.nw == null ? '' : String(e.nw), undo: e.undo || null, rb: false };
  audit.unshift(entry); if (audit.length > AUDIT_CAP) audit.length = AUDIT_CAP;
  save(KEY.audit, audit); emit('abai:audit', { entry }); return entry;
}
function seedAudit() {
  const A = '1073819', O = '1073820', J = '1073821', U = { [A]: ['Левицкий А.Р.', 'admin'], [O]: ['Соколов И.В.', 'operator'], [J]: ['Эксперт Жюри', 'jury'], SYS: [SYS.user, 'system'] };
  const M = 6e4, D = 1440, now = Date.now();
  const R = [ // [минут назад, пользователь, категория, ключ i18n, параметры, узел, было, стало, undo, метка, откачена]
    [26 * D, A, 'AUTH', 'ev.login', {}, '', '', 'password'],
    [25 * D + 380, A, 'PLUGIN', 'ev.plugin.on', { id: 'LWIR-BLIZZARD-FILTER' }, 'LWIR-BLIZZARD-FILTER', 'OFF', 'ON', { kind: 'plugin', data: { id: 'LWIR-BLIZZARD-FILTER', on: false } }],
    [22 * D, A, 'THRESHOLD', 'ev.setpoint', { name: 'T_max' }, 'MLX90614-IR-01', '75 °C', '80 °C', { kind: 'setpoint', data: { key: 'T_max', value: 75 } }],
    [19 * D, A, 'THRESHOLD', 'ev.setpoint', { name: 'T_max' }, 'MLX90614-IR-01', '80 °C', '85 °C', { kind: 'setpoint', data: { key: 'T_max', value: 80 } }],
    [12 * D + 90, 'SYS', 'RELAY', 'ev.ats.test', {}, 'ATS', 'IN1', 'IN2 → IN1'],
    [9 * D, O, 'AUTH', 'ev.login', {}, '', '', 'password'],
    [8 * D + 640, A, 'RBAC', 'ev.rbac.on', { perm: 'CAN_SWITCH_RELAY', who: 'Соколов И.В.' }, 'CAN_SWITCH_RELAY · 1073820', 'OFF', 'ON', { kind: 'rbac', data: { userId: O, perm: 'CAN_SWITCH_RELAY', value: false } }],
    [8 * D + 20, A, 'RBAC', 'ev.rbac.off', { perm: 'CAN_SWITCH_RELAY', who: 'Соколов И.В.' }, 'CAN_SWITCH_RELAY · 1073820', 'ON', 'OFF', { kind: 'rbac', data: { userId: O, perm: 'CAN_SWITCH_RELAY', value: true } }],
    [7 * D, A, 'THRESHOLD', 'ev.setpoint', { name: 'A_max' }, 'MPU6050-VIB-01', '0.60 g', '1.00 g', { kind: 'setpoint', data: { key: 'A_max', value: 0.6 } }, 'amax1', true],
    [7 * D - 25, A, 'ROLLBACK', 'ev.rollback', { tx: '@amax1' }, 'A_max', '1.00 g', '0.60 g'],
    [6 * D + 300, A, 'THRESHOLD', 'ev.setpoint', { name: 'A_max' }, 'MPU6050-VIB-01', '0.60 g', '0.80 g', { kind: 'setpoint', data: { key: 'A_max', value: 0.6 } }],
    [5 * D + 200, 'SYS', 'PINN', 'ev.alarm.heat', { t: '84.6', rul: '15' }, 'A-1', '42.4 °C', '84.6 °C'],
    [5 * D + 199, 'SYS', 'RELAY', 'ev.ats.auto', {}, 'ATS', 'IN1', 'IN2'],
    [4 * D + 700, A, 'AUTH', 'ev.login', {}, '', '', 'password'],
    [4 * D + 640, A, 'PLUGIN', 'ev.plugin.off', { id: 'VOICE-ALARM-TTS' }, 'VOICE-ALARM-TTS', 'ON', 'OFF', { kind: 'plugin', data: { id: 'VOICE-ALARM-TTS', on: true } }],
    [3 * D + 150, O, 'PWD_RESET', 'ev.pwd.req', { id: 'PW-MH4K2Q' }, 'PW-MH4K2Q', '', 'PENDING'],
    [3 * D + 110, A, 'PWD_RESET', 'ev.pwd.ok', { id: 'PW-MH4K2Q' }, 'PW-MH4K2Q', 'PENDING', 'APPROVED'],
    [2 * D + 800, A, 'CONFIG', 'ev.cfg.backup', {}, 'backup.json', '', 'OK'],
    [D + 900, J, 'AUTH', 'ev.login', {}, '', '', 'jury-code'],
    [D + 880, J, 'PINN', 'ev.demo', { name: 'spoof' }, 'MLX90614-IR-01', '', 'SPOOF'],
    [D + 879, 'SYS', 'PINN', 'ev.spoof', { raw: '78.9', t: '42.5' }, 'MLX90614-IR-01', '78.9 °C', '42.5 °C'],
    [D + 400, 'SYS', 'PINN', 'ev.blackout', {}, 'SUBSTATION', '110.2 kV', '0 kV'],
    [D + 399, 'SYS', 'RELAY', 'ev.dgu.start', {}, 'DGU', 'STANDBY', 'ACTIVE'],
    [D + 380, A, 'AUTH', 'ev.logout', {}, '', '', ''],
    [18 * 60, O, 'AUTH', 'ev.login', {}, '', '', 'password'],
    [12 * 60, A, 'THRESHOLD', 'ev.setpoint', { name: 'U_min' }, 'LTO-BAT-BUF', '195 V', '198 V', { kind: 'setpoint', data: { key: 'U_min', value: 195 } }],
    [7 * 60, 'SYS', 'PINN', 'ev.spoof', { raw: '91.7', t: '42.3' }, 'MLX90614-IR-01', '91.7 °C', '42.3 °C'],
    [4 * 60 + 20, O, 'AUTH', 'ev.logout', {}, '', '', ''],
    [2 * 60 + 10, A, 'AUTH', 'ev.login', {}, '', '', 'password'],
    [55, A, 'PLUGIN', 'ev.plugin.params', { id: 'PINN-KIRCHHOFF-GUARD' }, 'PINN-KIRCHHOFF-GUARD', '{"hold_s":4}', '{"hold_s":6}', { kind: 'pluginParams', data: { id: 'PINN-KIRCHHOFF-GUARD', params: { max_rate_c_per_s: 1.2, hold_s: 4 } } }]
  ];
  const rows = R.map(r => { const u = U[r[1]]; return { id: '', ts: now - r[0] * M, userId: r[1], user: u[0], role: u[1], cat: r[2], k: r[3], p: Object.assign({}, r[4]), node: r[5], old: r[6], nw: r[7], undo: r[8] || null, rb: !!r[10], tag: r[9] || '' }; });
  rows.sort((a, b) => a.ts - b.ts); rows.forEach((e, i) => { e.id = 'TX-' + (104200 - rows.length + 1 + i); });
  rows.forEach(e => { if (e.p.tx && e.p.tx[0] === '@') { const t = rows.find(x => x.tag === e.p.tx.slice(1)); e.p.tx = t ? t.id : '—'; } });
  rows.forEach(e => { delete e.tag; });
  return rows.reverse();                                                                                   // новые сверху
}
if (!Array.isArray(audit)) { audit = seedAudit(); save(KEY.audit, audit); }
const auditApi = {
  list: () => audit, count: () => audit.length, find: id => audit.find(e => e.id === id) || null,
  registerUndo: (kind, fn) => { undoers[kind] = fn; },
  rollback(id) {
    const e = audit.find(x => x.id === id), u = curUser();
    if (!e) return { ok: false, reason: 'NOT_FOUND' };
    if (e.rb) return { ok: false, reason: 'DONE' };
    if (!e.undo) return { ok: false, reason: 'NO_UNDO' };
    if (!u || !(DB().permsOf(u.id) || {}).CAN_ROLLBACK_LOGS) return { ok: false, reason: 'PERM' };
    const fn = undoers[e.undo.kind]; if (!fn) return { ok: false, reason: 'NO_HANDLER' };
    const r = fn(e.undo.data, e); if (!r) return { ok: false, reason: 'FAILED' };
    e.rb = true; save(KEY.audit, audit);
    log({ cat: 'ROLLBACK', k: 'ev.rollback', p: { tx: e.id }, node: r.node || e.node, old: r.old, nw: r.nw });
    emit('abai:audit', { entry: e, rolledBack: true }); return { ok: true, entry: e };
  },
  csv(rows) {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"', head = ['TX_ID', 'DATETIME', 'USER_ID', 'USER', 'ROLE', 'CATEGORY', 'NODE', 'EVENT', 'OLD', 'NEW', 'ROLLED_BACK'];
    const body = (rows || audit).map(e => [e.id, fmtDT(e.ts), e.userId, e.user, e.role, e.cat, e.node, TT(e.k, e.p), e.old, e.nw, e.rb ? 'YES' : 'NO'].map(q).join(';'));
    return '﻿' + [head.map(q).join(';')].concat(body).join('\r\n');
  }
};

/* ======================= БЭКАП ======================= */
function download(name, text, mime) {
  const b = new Blob([text], { type: mime || 'application/octet-stream' }), a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const stamp = () => { const d = new Date(Date.now() + tzOffset() * 36e5); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + '-' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()); };
const backup = {
  data: () => ({ app: 'ARCTIC BUSBAR AI', version: VERSION, ts: Date.now(), settings: Object.assign({}, settings), thresholds: Object.assign({}, thr), plugins: clone(plugs), audit: clone(audit), users: DB().snapshot() }),
  export() { const d = backup.data(); download('arctic-busbar-backup-' + stamp() + '.json', JSON.stringify(d, null, 2), 'application/json'); return d; },
  import(text) {
    let d; try { d = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return { ok: false, reason: 'JSON' }; }
    if (!d || d.app !== 'ARCTIC BUSBAR AI' || !Array.isArray(d.audit)) return { ok: false, reason: 'FORMAT' };
    Object.keys(DEFAULTS).forEach(k => { settings[k] = sane(k, d.settings && k in d.settings ? d.settings[k] : DEFAULTS[k]); });
    save(KEY.settings, settings);
    thr = Object.assign(thrDefaults(), d.thresholds || {}); Object.keys(THR).forEach(k => { if (!isFinite(+thr[k])) thr[k] = THR[k].def; }); save(KEY.thr, thr);
    plugs = plugMerge(d.plugins); save(KEY.plug, plugs);
    audit = d.audit.filter(e => e && e.id && e.ts).slice(0, AUDIT_CAP); save(KEY.audit, audit);
    if (d.users) DB().restore(d.users);
    Object.keys(DEFAULTS).forEach(applySetting); emit('abai:restored', { reason: 'import', version: d.version });
    log({ cat: 'CONFIG', k: 'ev.cfg.restore', node: 'backup.json', old: '', nw: 'OK' });
    return { ok: true, audit: audit.length, version: d.version };
  },
  resetDemo() {
    thr = thrDefaults(); save(KEY.thr, thr); plugs = plugMerge(null); save(KEY.plug, plugs); audit = seedAudit(); save(KEY.audit, audit); DB().resetDemo();
    emit('abai:restored', { reason: 'reset' }); log({ cat: 'CONFIG', k: 'ev.cfg.reset', node: 'demo', old: '', nw: 'OK' }); return true;
  },
  size() { let n = 0; try { for (let i = 0; i < g.localStorage.length; i++) { const k = g.localStorage.key(i); if (k && k.indexOf('abai.') === 0) n += (k.length + (g.localStorage.getItem(k) || '').length) * 2; } } catch (e) { n = JSON.stringify(backup.data()).length * 2; } return n; },
  download
};

/* ======================= запуск ======================= */
function init() { Object.keys(DEFAULTS).forEach(applySetting); if (g.I18N) g.I18N.apply(document); }
g.Store = { VERSION, DEFAULTS, THR, TZ, get, set, settings: get, tzOffset, tzLabel, fmtClock, fmtDT, toInput, fromInput, palette, rgba,
  thr: { all: () => Object.assign({}, thr), get: k => thr[k], set: thrSet, fmt: thrFmt, reset: () => { thr = thrDefaults(); save(KEY.thr, thr); } },
  plugins: plug, audit: auditApi, log, backup, init };
init();
})(window);
