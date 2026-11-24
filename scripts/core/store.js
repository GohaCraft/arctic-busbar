/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/core/store.js  (единое хранилище состояния, БЕЗ DOM-разметки)
   Настройки (язык, тема, акцент, фон, Полярная ночь, анимации, пояс, частота телеметрии), уставки датчиков, плагины-проекты, ЖУРНАЛ АУДИТА с откатом (Rollback),
   раскладки графа по user.id, бэкап / восстановление .json, палитра для canvas. Подключается после users-db.js и i18n.js.
   API: window.Store. События (window): abai:settings {key,value}, abai:thresholds {key,value,old}, abai:plugins {id},
   abai:audit {entry}, abai:restored (после восстановления бэкапа / сброса демо-данных), abai:session {state:'start'|'refresh'|'end', reason}.
   Журнал: записи языконезависимы ({k, p} — ключ и параметры i18n), поэтому при смене языка весь журнал переводится мгновенно.
   Данные хранятся в localStorage (при недоступности — в памяти вкладки). Фаза 2: те же методы поверх REST FastAPI + PostgreSQL.

   ЭТАП 3 — Store.session: ИММУТАБЕЛЬНАЯ сессия в памяти (замыкание + Object.freeze). Права (CAN_*) читаются ТОЛЬКО отсюда:
   Store.session.has('CAN_MANAGE_PLUGINS'). Из консоли нельзя ни дописать право (объект заморожен, свойства только для чтения), ни подменить сам Store
   (window.Store — неизменяемое свойство). Источник правды — подписанный токен: has() периодически перепроверяет подпись и срок, при расхождении
   сессия убивается (abai:session end, reason 'tamper'). Токен дублируется в sessionStorage (переживает F5, исчезает при закрытии вкладки);
   end() стирает токен, все ключи abai.s.* и ВСЕ таймеры, зарегистрированные через Store.session.interval/timeout. */
(function (g) {
'use strict';
const KEY = { settings: 'abai.settings', audit: 'abai.audit', thr: 'abai.thresholds', plug: 'abai.plugins', layout: 'abai.layouts' };
const SESS_KEY = 'abai.s.tok';
const VERSION = '2.4.0-prod', AUDIT_CAP = 500;
const mem = {};
const load = (k, d) => { try { const v = g.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return k in mem ? mem[k] : d; } };
const save = (k, v) => { mem[k] = v; try { g.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* остаётся в памяти */ } };
const emit = (name, detail) => g.dispatchEvent(new CustomEvent(name, { detail }));
const pad = n => String(n).padStart(2, '0');
const DB = () => g.UsersDB, TT = (k, p) => (g.I18N ? g.I18N.t(k, p) : k);

/* ======================= НАСТРОЙКИ ======================= */
const DEFAULTS = { lang: 'ru', theme: 'dark', accent: null, bg: 'waves', polar: false, anim: true, tz: 'utc7', tele: 4, fps: 60, fx: true };
const TZ = { utc3: 3, utc7: 7, utc8: 8, utc0: 0 };
const ENUM = { lang: ['ru', 'en', 'zh', 'kk', 'be', 'uk'], theme: ['dark', 'amber', 'light'], bg: ['waves', 'aurora', 'contour', 'mesh', 'plain'], tz: Object.keys(TZ), tele: [2, 4, 10], fps: [30, 60] };
let settings = Object.assign({}, DEFAULTS, load(KEY.settings, {}));
function sane(k, v) {
  if (k === 'accent') return /^#[0-9a-f]{6}$/i.test(v || '') ? String(v).toLowerCase() : null;
  if (k === 'anim' || k === 'fx' || k === 'polar') return v === true || v === 'true' || v === 1;
  if (k === 'tele' || k === 'fps') { v = +v; return ENUM[k].indexOf(v) >= 0 ? v : DEFAULTS[k]; }
  return ENUM[k] && ENUM[k].indexOf(v) < 0 ? DEFAULTS[k] : v;
}
Object.keys(DEFAULTS).forEach(k => { settings[k] = sane(k, settings[k]); });

const lum = hex => { const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
let pal = null;
function applySetting(k) {
  const root = document.documentElement;
  if (k === 'theme') root.dataset.theme = settings.theme;
  else if (k === 'bg') root.dataset.bg = settings.bg;
  else if (k === 'polar') root.dataset.polar = settings.polar ? '1' : '0';
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
/* Плагин = проект-дерево: manifest.json + точка входа (worker.js для JS, worker.py для Python) + любые вспомогательные файлы.
   Старый вызов add({id, lang, code, params}) по-прежнему работает: дерево собирается автоматически. */
const PL = { MAX_FILES: 24, MAX_FILE: 128 * 1024, MAX_TOTAL: 512 * 1024, ID: /^[A-Za-z0-9._-]{2,40}$/, VER: /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/ };
const entryOf = lang => (lang === 'py' ? 'worker.py' : 'worker.js');
function normPath(p) {
  p = String(p || '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (!p || p.length > 120 || !/^[A-Za-z0-9._\- \/]+$/.test(p) || p.split('/').some(s => !s || s === '.' || s === '..')) return '';
  return p;
}
function normFiles(files) {                                                                                   // → {ok, files} | {ok:false, reason}
  if (!Array.isArray(files) || !files.length) return { ok: false, reason: 'FILES_EMPTY' };
  if (files.length > PL.MAX_FILES) return { ok: false, reason: 'FILES_LIMIT' };
  const seen = {}, out = []; let total = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i] || {}, path = normPath(f.path), text = typeof f.text === 'string' ? f.text : '';
    if (!path) return { ok: false, reason: 'PATH', path: String(f.path || '') };
    if (seen[path]) continue; seen[path] = 1;
    if (text.length > PL.MAX_FILE) return { ok: false, reason: 'FILE_BIG', path };
    total += text.length; if (total > PL.MAX_TOTAL) return { ok: false, reason: 'FILES_LIMIT' };
    out.push({ path, text });
  }
  return { ok: true, files: out };
}
function manifestOf(p) { return JSON.stringify({ name: p.id, version: p.ver || '0.1.0', runtime: p.lang === 'py' ? 'py' : 'js', entry: p.entry || entryOf(p.lang), params: p.params || {} }, null, 2); }
function plugTree(p) {
  if (Array.isArray(p.files) && p.files.length) return p.files;
  const entry = p.entry || entryOf(p.lang);
  return p.builtin ? [{ path: 'manifest.json', text: manifestOf(p) }] : [{ path: 'manifest.json', text: manifestOf(p) }, { path: entry, text: String(p.code || '') }];
}
function syncManifest(p) {                                                                                    // params в manifest.json дерева должны совпадать с p.params (иначе экспорт папки разойдётся с состоянием)
  if (!Array.isArray(p.files)) return; const mf = p.files.find(f => f.path === 'manifest.json'); if (!mf) return;
  try { const m = JSON.parse(mf.text); m.params = p.params || {}; mf.text = JSON.stringify(m, null, 2) + '\n'; } catch (e) { mf.text = manifestOf(p) + '\n'; }
}
function plugDefaults() { return BUILTIN.map(p => Object.assign(clone(p), { builtin: true, lang: 'js' })); }
function plugMerge(saved) {                                                                                   // встроенные всегда на месте, пользовательские — из сохранённого
  const by = {}; (saved || []).forEach(p => { if (p && p.id) by[p.id] = p; });
  const out = plugDefaults().map(d => { const s = by[d.id]; if (s) { d.on = !!s.on; if (s.params && typeof s.params === 'object') d.params = s.params; delete by[d.id]; } return d; });
  Object.keys(by).forEach(id => {
    const s = by[id]; if (s.builtin || !PL.ID.test(String(s.id))) return;
    const lang = s.lang === 'py' ? 'py' : 'js', nf = Array.isArray(s.files) ? normFiles(s.files) : null;
    out.push({ id: s.id, cat: 'p.custom', ver: PL.VER.test(s.ver || '') ? s.ver : '0.1.0', lat: s.lat || 1, on: !!s.on, params: s.params && typeof s.params === 'object' ? s.params : {}, builtin: false, lang, entry: String(s.entry || entryOf(lang)), code: String(s.code || ''), files: nf && nf.ok ? nf.files : undefined });
  });
  return out;
}
let plugs = plugMerge(load(KEY.plug, null));
const plug = {
  list: () => plugs, get: id => plugs.find(p => p.id === id) || null, enabled: id => { const p = plug.get(id); return !!(p && p.on); }, tree: id => { const p = plug.get(id); return p ? plugTree(p).map(f => ({ path: f.path, text: f.text })) : []; },
  setOn(id, on) { const p = plug.get(id); if (!p) return null; const old = p.on; p.on = !!on; save(KEY.plug, plugs); emit('abai:plugins', { id, on: p.on, old }); return { old, value: p.on }; },
  setParams(id, params) { const p = plug.get(id); if (!p) return null; const old = p.params; p.params = params; syncManifest(p); save(KEY.plug, plugs); emit('abai:plugins', { id, params, oldParams: old }); return { old, value: params }; },
  /* Правка исходника пользовательского плагина: обновляет p.code и файл точки входа в дереве (manifest.json не трогаем).
     → {ok, old, value} | {ok:false, reason:'NOT_FOUND'|'BUILTIN'|'FILE_BIG'|'TOTAL_BIG'} */
  setCode(id, code) {
    const p = plug.get(id); if (!p) return { ok: false, reason: 'NOT_FOUND' }; if (p.builtin) return { ok: false, reason: 'BUILTIN' };
    code = String(code == null ? '' : code); if (code.length > PL.MAX_FILE) return { ok: false, reason: 'FILE_BIG' };
    const entry = p.entry || entryOf(p.lang), files = plugTree(p).map(f => ({ path: f.path, text: f.text })), ef = files.find(f => f.path === entry);
    if (ef) ef.text = code; else files.push({ path: entry, text: code });
    if (files.reduce((n, f) => n + f.text.length, 0) > PL.MAX_TOTAL) return { ok: false, reason: 'TOTAL_BIG' };
    const old = p.code; p.code = code; p.files = files; save(KEY.plug, plugs); emit('abai:plugins', { id, code: true }); return { ok: true, old, value: code };
  },
  /* def: {id, lang, code, params} (одиночный код) ИЛИ {files:[{path,text}]} (директория: manifest.json обязателен).
     Ошибки: ID, DUP, FILES_EMPTY, FILES_LIMIT, FILE_BIG, PATH, MANIFEST_MISSING, MANIFEST_JSON, MANIFEST_FIELD, ENTRY_MISSING */
  add(def) {
    def = def || {}; let files = null, entry = '';
    if (def.files) {
      const nf = normFiles(def.files); if (!nf.ok) return nf; files = nf.files;
      const mf = files.find(f => f.path === 'manifest.json'); if (!mf) return { ok: false, reason: 'MANIFEST_MISSING' };
      let man; try { man = JSON.parse(mf.text); } catch (e) { return { ok: false, reason: 'MANIFEST_JSON' }; }
      if (!man || typeof man !== 'object' || !PL.ID.test(String(man.name || '')) || !PL.VER.test(String(man.version || '')) || ['js', 'py'].indexOf(man.runtime) < 0) return { ok: false, reason: 'MANIFEST_FIELD' };
      entry = normPath(man.entry || entryOf(man.runtime)); const ef = files.find(f => f.path === entry); if (!ef) return { ok: false, reason: 'ENTRY_MISSING', entry };
      def = { id: man.name, lang: man.runtime, ver: man.version, params: man.params && typeof man.params === 'object' ? man.params : {}, code: ef.text };
    }
    if (!PL.ID.test(String(def.id || ''))) return { ok: false, reason: 'ID' };
    if (plug.get(def.id)) return { ok: false, reason: 'DUP' };
    const lang = def.lang === 'py' ? 'py' : 'js', p = { id: def.id, cat: 'p.custom', ver: PL.VER.test(def.ver || '') ? def.ver : '0.1.0', lat: 1, on: true, params: def.params || {}, builtin: false, lang, entry: entry || entryOf(lang), code: String(def.code || ''), files: files || undefined };
    if (!p.files) p.files = plugTree(p);
    plugs.push(p); save(KEY.plug, plugs); emit('abai:plugins', { id: p.id, added: true }); return { ok: true, plugin: p };
  },
  remove(id) { const p = plug.get(id); if (!p || p.builtin) return false; plugs = plugs.filter(x => x !== p); save(KEY.plug, plugs); emit('abai:plugins', { id, removed: true }); return true; },
  LIMITS: Object.freeze({ files: PL.MAX_FILES, file: PL.MAX_FILE, total: PL.MAX_TOTAL })
};

/* ======================= РАСКЛАДКИ ГРАФА ПО user.id (не привилегированные данные: localStorage допустим) ======================= */
const layoutOk = m => m && typeof m === 'object' && !Array.isArray(m);
const layout = {
  all: () => { const a = load(KEY.layout, {}); return layoutOk(a) ? a : {}; },
  get(uid) { const m = layout.all()[String(uid)]; return layoutOk(m) ? m : null; },
  set(uid, map) {                                                                                            // map: {nodeId: [x, y] | {x, y, pin?}} → нормализуется в [x, y, pin]
    if (!uid || !layoutOk(map)) return false; const out = {}; let n = 0;
    Object.keys(map).forEach(id => {
      if (n >= 64 || !/^[A-Za-z0-9_.-]{1,40}$/.test(id)) return; const v = map[id], x = Array.isArray(v) ? +v[0] : +(v && v.x), y = Array.isArray(v) ? +v[1] : +(v && v.y), pin = Array.isArray(v) ? !!v[2] : !!(v && v.pin);
      if (isFinite(x) && isFinite(y) && Math.abs(x) < 1e5 && Math.abs(y) < 1e5) { out[id] = [Math.round(x * 10) / 10, Math.round(y * 10) / 10, pin ? 1 : 0]; n++; }
    });
    const a = layout.all(); a[String(uid)] = out; save(KEY.layout, a); return true;
  },
  clear(uid) { const a = layout.all(); const had = String(uid) in a; delete a[String(uid)]; save(KEY.layout, a); return had; }
};

/* ======================= СЕССИЯ: иммутабельный объект в памяти ======================= */
const Session = (function () {
  let tok = '', cur = null, memoAt = 0, rejected = '';
  const timers = new Set();
  const ss = () => { try { return g.sessionStorage; } catch (e) { return null; } };
  const permList = p => DB().PERMS.filter(k => p && p[k] === true);
  function adopt(token, state) {
    const r = DB().verifySession(token); if (!r.ok) return null;
    const p = r.payload, u = r.user, perms = {}; DB().PERMS.forEach(k => { perms[k] = (p.pm || []).indexOf(k) >= 0; });
    tok = token; memoAt = Date.now();
    cur = Object.freeze({ sid: p.sid, via: p.via, iat: p.iat * 1000, exp: p.exp * 1000,
      user: Object.freeze({ id: u.id, login: u.login, code: u.code, fio: u.fio, role: u.role, roleLabel: u.roleLabel, perms: Object.freeze(perms) }) });
    const s = ss(); if (s) { try { s.setItem(SESS_KEY, token); } catch (e) { /* квота: сессия живёт в памяти */ } }
    if (state) emit('abai:session', { state, sid: cur.sid });
    return cur;
  }
  function kill(reason) { const had = !!cur; wipe(); if (had) emit('abai:session', { state: 'end', reason: reason || 'logout' }); return had; }
  function wipe() {
    cur = null; tok = ''; memoAt = 0;
    timers.forEach(t => { clearTimeout(t.id); clearInterval(t.id); }); timers.clear();
    const s = ss(); if (s) { try { s.removeItem(SESS_KEY); } catch (e) { /* ok */ } }
    try { DB().wipeSession(); } catch (e) { /* ok */ }
  }
  /* повторная криптопроверка токена — не чаще раза в 1.2 с (HMAC дорог, а has() вызывается из отрисовки) */
  function alive() {
    if (!cur) return false; const now = Date.now();
    if (now >= cur.exp) { kill('expired'); return false; }
    if (now - memoAt > 1200) { const r = DB().verifySession(tok); if (!r.ok || r.payload.sid !== cur.sid || permList(cur.user.perms).join() !== (r.payload.pm || []).join()) { kill('tamper'); return false; } memoAt = now; }
    return true;
  }
  const reg = (fn, ms, once) => {
    const rec = { id: 0 };
    const run = () => { if (once) timers.delete(rec); if (cur) { try { fn(); } catch (e) { setTimeout(() => { throw e; }); } } };
    rec.id = once ? setTimeout(run, ms) : setInterval(run, ms); timers.add(rec); return rec.id;
  };
  const api = {
    /* вход: token выдаёт «сервер» (UsersDB.authenticate / qr.redeem / pin.redeem); возвращает замороженный вид сессии или null */
    start(token) { wipe(); return adopt(token, 'start'); },
    /* восстановление после F5: токен из sessionStorage проходит ту же криптопроверку; чужой / просроченный / подделанный — стирается */
    restore() {
      const s = ss(); let t = null; try { t = s ? s.getItem(SESS_KEY) : null; } catch (e) { t = null; }
      rejected = ''; if (!t) return null;
      const v = adopt(t, 'restore');
      if (!v) {                                                                                           // токен был, но не прошёл криптопроверку: ключ стирается, причину покажет экран входа
        const r = DB().verifySession(t); rejected = r && r.reason === 'EXPIRED' ? 'expired' : 'tamper';
        try { s.removeItem(SESS_KEY); } catch (e) { /* ok */ }
        if (rejected === 'tamper') emit('abai:tamper', { key: SESS_KEY });                                // в журнал аудита: «Подмена данных «abai.s.tok» …»
      }
      return v;
    },
    /* причина последнего отказа при восстановлении: '' | 'expired' | 'tamper' (читается один раз) */
    rejected() { const r = rejected; rejected = ''; return r; },
    end: reason => kill(reason || 'logout'),
    get user() { return alive() ? cur.user : null; },
    get info() { return alive() ? cur : null; },
    has: perm => alive() && cur.user.perms[perm] === true,
    isAdmin: () => alive() && cur.user.role === 'admin',
    active: () => alive(),
    bearer: () => (alive() ? tok : ''),
    /* «сервер» перевыпускает токен с актуальной матрицей прав (после изменения RBAC); срок жизни не продлевается */
    refresh() { if (!alive()) return null; const t = DB().reissue(tok); return t ? adopt(t, 'refresh') : null; },
    expiresIn: () => (alive() ? Math.max(0, cur.exp - Date.now()) : 0),
    age: () => (alive() ? Date.now() - cur.iat : 0),
    /* таймеры сессии: гасятся целиком при end() */
    interval: (fn, ms) => reg(fn, ms, false), timeout: (fn, ms) => reg(fn, ms, true),
    clear(id) { timers.forEach(t => { if (t.id === id) { clearTimeout(id); clearInterval(id); timers.delete(t); } }); },
    timers: () => timers.size
  };
  return Object.freeze(api);
})();
/* сторож срока и подмены: единственный «постоянный» таймер, он сам не хранит ничего о пользователе */
setInterval(() => { Session.active(); }, 5000);
g.addEventListener('abai:tamper', e => { try { log({ sys: true, cat: 'SECURITY', k: 'ev.sec.tamper', p: { key: (e.detail && e.detail.key) || '?' }, node: (e.detail && e.detail.key) || '', old: '', nw: 'RESET' }); } catch (err) { /* журнал ещё не готов */ } });

/* ======================= ЖУРНАЛ АУДИТА ======================= */
const SYS = { userId: 'SYS', user: 'PINN-Core', role: 'system' };
const undoers = {};
let audit = load(KEY.audit, null);
const curUser = () => Session.user;
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
    const e = audit.find(x => x.id === id);
    if (!e) return { ok: false, reason: 'NOT_FOUND' };
    if (e.rb) return { ok: false, reason: 'DONE' };
    if (!e.undo) return { ok: false, reason: 'NO_UNDO' };
    if (!Session.has('CAN_ROLLBACK_LOGS')) return { ok: false, reason: 'PERM' };                              // право берётся ТОЛЬКО из иммутабельной сессии
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
/* Бэкап НЕ содержит прав доступа (perms), паролей, хешей, токенов. Импорт применяет каждый раздел только при наличии права в сессии:
   уставки → CAN_EDIT_PINN, плагины → CAN_MANAGE_PLUGINS, журнал → CAN_ROLLBACK_LOGS; настройки интерфейса, раскладки графа и заявки — всем вошедшим.
   Без входа импорт невозможен. Пропущенные разделы возвращаются в result.skipped. */
const backup = {
  data: () => ({ app: 'ARCTIC BUSBAR AI', version: VERSION, ts: Date.now(), settings: Object.assign({}, settings), thresholds: Object.assign({}, thr), plugins: clone(plugs), audit: clone(audit), layouts: layout.all(), users: DB().snapshot() }),
  export() { if (!Session.active()) return null; const d = backup.data(); download('arctic-busbar-backup-' + stamp() + '.json', JSON.stringify(d, null, 2), 'application/json'); return d; },
  import(text) {
    if (!Session.active()) return { ok: false, reason: 'AUTH' };
    if (typeof text === 'string' && text.length > 8 * 1024 * 1024) return { ok: false, reason: 'FORMAT' };
    let d; try { d = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return { ok: false, reason: 'JSON' }; }
    if (!d || d.app !== 'ARCTIC BUSBAR AI' || !Array.isArray(d.audit)) return { ok: false, reason: 'FORMAT' };
    const skipped = [];
    Object.keys(DEFAULTS).forEach(k => { settings[k] = sane(k, d.settings && k in d.settings ? d.settings[k] : DEFAULTS[k]); });
    save(KEY.settings, settings);
    if (Session.has('CAN_EDIT_PINN')) { thr = Object.assign(thrDefaults(), d.thresholds || {}); Object.keys(THR).forEach(k => { if (!isFinite(+thr[k]) || +thr[k] < THR[k].min || +thr[k] > THR[k].max) thr[k] = THR[k].def; else thr[k] = +thr[k]; }); save(KEY.thr, thr); } else skipped.push('thresholds');
    if (Session.has('CAN_MANAGE_PLUGINS')) { plugs = plugMerge(d.plugins); save(KEY.plug, plugs); } else skipped.push('plugins');
    if (Session.has('CAN_ROLLBACK_LOGS')) { audit = d.audit.filter(e => e && e.id && e.ts).slice(0, AUDIT_CAP); save(KEY.audit, audit); } else skipped.push('audit');
    if (layoutOk(d.layouts)) { const cur = layout.all(); Object.keys(d.layouts).forEach(uid => { if (/^[0-9A-Za-z_-]{1,20}$/.test(uid) && layoutOk(d.layouts[uid])) { const keep = cur[uid]; layout.set(uid, d.layouts[uid]); if (!layout.get(uid) && keep) layout.set(uid, keep); } }); }
    if (d.users) DB().restore(d.users);
    Object.keys(DEFAULTS).forEach(applySetting); emit('abai:restored', { reason: 'import', version: d.version });
    log({ cat: 'CONFIG', k: 'ev.cfg.restore', node: 'backup.json', old: skipped.join(','), nw: skipped.length ? 'PARTIAL' : 'OK' });
    return { ok: true, audit: audit.length, version: d.version, skipped };
  },
  resetDemo() {
    if (!DB().DEMO || !Session.isAdmin()) return false;                                                       // сброс демо-данных — только в DEMO_MODE и только администратору
    thr = thrDefaults(); save(KEY.thr, thr); plugs = plugMerge(null); save(KEY.plug, plugs); audit = seedAudit(); save(KEY.audit, audit); save(KEY.layout, {}); DB().resetDemo();
    emit('abai:restored', { reason: 'reset' }); log({ cat: 'CONFIG', k: 'ev.cfg.reset', node: 'demo', old: '', nw: 'OK' }); return true;
  },
  size() { let n = 0; try { for (let i = 0; i < g.localStorage.length; i++) { const k = g.localStorage.key(i); if (k && k.indexOf('abai.') === 0) n += (k.length + (g.localStorage.getItem(k) || '').length) * 2; } } catch (e) { n = JSON.stringify(backup.data()).length * 2; } return n; },
  download
};

/* ======================= запуск ======================= */
function init() {
  Object.keys(DEFAULTS).forEach(applySetting); if (g.I18N) g.I18N.apply(document);
  DB().integrity(true).forEach(k => log({ sys: true, cat: 'SECURITY', k: 'ev.sec.tamper', p: { key: k }, node: k, old: '', nw: 'RESET' }));   // подмена, найденная ещё до загрузки Store
}
/* Store и его подсистемы заморожены, а сам window.Store — свойство без права записи/удаления: из консоли его не подменить */
const API = Object.freeze({ VERSION, DEFAULTS, THR, TZ, get, set, settings: get, tzOffset, tzLabel, fmtClock, fmtDT, toInput, fromInput, palette, rgba,
  thr: Object.freeze({ all: () => Object.assign({}, thr), get: k => thr[k], set: thrSet, fmt: thrFmt, reset: () => { thr = thrDefaults(); save(KEY.thr, thr); } }),
  plugins: Object.freeze(plug), audit: Object.freeze(auditApi), layout: Object.freeze(layout), session: Session, log, backup: Object.freeze(backup), init });
try { Object.defineProperty(g, 'Store', { value: API, writable: false, configurable: false, enumerable: true }); } catch (e) { g.Store = API; }
init();
})(window);
