/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/app/plugin-pack.js  (ЭТАП 3: «загрузка директории» плагина)
   Плагин — это папка: manifest.json + точка входа (worker.js для JavaScript, worker.py для Python) + любые вспомогательные текстовые файлы.
   Модуль ничего не исполняет: он (1) читает папку из <input webkitdirectory> или из перетаскивания, (2) проверяет manifest и лимиты теми же правилами,
   что и Store.plugins.add, (3) ищет в коде обращения к запрещённым API и (4) отдаёт готовые шаблоны.  Дальше: Store.plugins.add({files}).
   API: PluginPack = { fromFileList(FileList) → Promise, fromDataTransfer(DataTransfer) → Promise, validate(files, skipped) → отчёт,
                       template('js'|'py') → files, treeOf(files) → строки дерева, normPath(path), TEXT_EXT }
   fromXxx → Promise<{files:[{path,text}], skipped:[{path,reason:'IGNORED'|'EXT'|'BIG'|'BINARY'|'READ'|'LIMIT', size?}], root}>
   validate → {ok, errors:[{code,path,params}], warnings:[{code,path,params}], manifest, runtime, entry, id, ver, bytes, files, tree}
   Коды ошибок: FILES_EMPTY, FILES_LIMIT, FILE_BIG, TOTAL_BIG, PATH, MANIFEST_MISSING, MANIFEST_JSON, MANIFEST_FIELD{field}, ENTRY_MISSING{entry},
   ENTRY_RUNTIME{entry,runtime}, ENTRY_EMPTY, FORBIDDEN_IMPORT{line}.  Предупреждения: SKIPPED{n}, FORBIDDEN_API{api,line}, NO_RETURN. */
(function (g) {
'use strict';
const TEXT_EXT = /\.(json|js|mjs|py|md|txt|ya?ml|toml|cfg|ini|csv)$/i;
const SKIP_DIR = /^(node_modules|__pycache__|venv|\.venv|dist|build)$/i;
const ID = /^[A-Za-z0-9._-]{2,40}$/, VER = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;
const MAX_ENTRIES = 600, MAX_WARN = 8;
const lim = () => (g.Store && g.Store.plugins && g.Store.plugins.LIMITS) || { files: 24, file: 128 * 1024, total: 512 * 1024 };
const entryOf = rt => (rt === 'py' ? 'worker.py' : 'worker.js');

/* тот же путь-фильтр, что в Store.plugins: относительный, без .. и ., латиница/цифры/._- и пробел */
function normPath(p) {
  p = String(p || '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (!p || p.length > 120 || !/^[A-Za-z0-9._\- \/]+$/.test(p) || p.split('/').some(s => !s || s === '.' || s === '..')) return '';
  return p;
}

/* ---------- чтение папки ---------- */
function readText(file) {
  if (file.text) return file.text();
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(file); });
}
async function build(items, root) {
  const files = [], skipped = [], L = lim();
  for (const it of items) {
    const path = it.path, segs = path.split('/'), base = segs[segs.length - 1];
    if (segs.some((s, i) => s.charAt(0) === '.' || (i < segs.length - 1 && SKIP_DIR.test(s)))) { skipped.push({ path, reason: 'IGNORED' }); continue; }
    if (!TEXT_EXT.test(base)) { skipped.push({ path, reason: 'EXT' }); continue; }
    if (it.file.size > L.file) { skipped.push({ path, reason: 'BIG', size: it.file.size }); continue; }
    let text; try { text = await readText(it.file); } catch (e) { skipped.push({ path, reason: 'READ' }); continue; }
    if (text.indexOf('\u0000') >= 0) { skipped.push({ path, reason: 'BINARY' }); continue; }
    files.push({ path, text: text.replace(/^﻿/, '') });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, skipped, root: root || '' };
}
function fromFileList(list) {
  const arr = Array.prototype.slice.call(list || []);
  const rel = arr.map(f => String(f.webkitRelativePath || f.name || ''));
  const first = rel.length && rel[0].indexOf('/') > 0 ? rel[0].split('/')[0] : '';
  const strip = !!first && rel.every(r => r.indexOf(first + '/') === 0);                                          // общий корневой каталог отбрасываем
  const items = arr.slice(0, MAX_ENTRIES).map((f, i) => ({ path: strip ? rel[i].slice(first.length + 1) : rel[i], file: f }));
  return build(items, strip ? first : '').then(r => { if (arr.length > MAX_ENTRIES) r.skipped.push({ path: '…', reason: 'LIMIT' }); return r; });
}
function readAllEntries(reader) {                                                                                // readEntries отдаёт порциями до 100 записей
  return new Promise((res, rej) => { const acc = []; (function next() { reader.readEntries(b => { if (!b.length) res(acc); else { acc.push.apply(acc, b); next(); } }, rej); })(); });
}
const fileOf = entry => new Promise((res, rej) => entry.file(res, rej));
async function walk(entry, prefix, acc, st) {
  if (st.n >= MAX_ENTRIES) { st.cut = true; return; }
  const path = prefix + entry.name;
  if (entry.isFile) { st.n++; try { acc.push({ path, file: await fileOf(entry) }); } catch (e) { st.skipped.push({ path, reason: 'READ' }); } return; }
  if (entry.isDirectory) {
    if (entry.name.charAt(0) === '.' || SKIP_DIR.test(entry.name)) { st.skipped.push({ path: path + '/', reason: 'IGNORED' }); return; }
    const kids = await readAllEntries(entry.createReader());
    for (const k of kids) await walk(k, path + '/', acc, st);
  }
}
function fromDataTransfer(dt) {
  const items = dt && dt.items ? Array.prototype.slice.call(dt.items) : [];
  /* webkitGetAsEntry вызывается синхронно: после первого await DataTransfer очищается браузером */
  const entries = items.map(it => (it.kind === 'file' && it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return fromFileList(dt && dt.files ? dt.files : []);
  const single = entries.length === 1 && entries[0].isDirectory, st = { n: 0, cut: false, skipped: [] }, acc = [];
  return (async () => {
    if (single) { const kids = await readAllEntries(entries[0].createReader()); for (const k of kids) await walk(k, '', acc, st); }
    else for (const e of entries) await walk(e, '', acc, st);
    const r = await build(acc, single ? entries[0].name : '');
    r.skipped = st.skipped.concat(r.skipped); if (st.cut) r.skipped.push({ path: '…', reason: 'LIMIT' });
    return r;
  })();
}

/* ---------- проверка ---------- */
const JS_API = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'localStorage', 'sessionStorage', 'document', 'window', 'navigator', 'eval', 'Function', 'postMessage', 'setTimeout', 'setInterval', 'Worker'];
const JS_API_RE = new RegExp('(^|[^\\w$.])(' + JS_API.join('|') + ')\\b');
const PY_API_RE = [/\b(?:import|from)\s+(os|sys|subprocess|socket|requests|urllib|ctypes|shutil|pathlib|http|asyncio)\b/, /(?:^|[^\w.])(eval|exec|compile|__import__|open)\s*\(/];
function scan(text, runtime, path, sink) {
  const lines = String(text).split('\n'); let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (runtime === 'js') {
      if (/\bimport\b/.test(lines[i])) { sink.errors.push({ code: 'FORBIDDEN_IMPORT', path, params: { line: i + 1 } }); continue; }
      const m = JS_API_RE.exec(lines[i]); if (m && n++ < MAX_WARN) sink.warnings.push({ code: 'FORBIDDEN_API', path, params: { api: m[2], line: i + 1 } });
    } else {
      for (let k = 0; k < PY_API_RE.length; k++) { const m = PY_API_RE[k].exec(lines[i]); if (m) { if (n++ < MAX_WARN) sink.warnings.push({ code: 'FORBIDDEN_API', path, params: { api: m[1], line: i + 1 } }); break; } }
    }
  }
}
function treeOf(files) {                                                                                         // плоский список для вывода дерева: каталоги + файлы
  const rows = {}, list = (files || []).map(f => ({ path: f.path, size: String(f.text || '').length }));
  list.forEach(f => { const p = f.path.split('/'); for (let i = 1; i < p.length; i++) { const d = p.slice(0, i).join('/'); rows[d] = { path: d, name: p[i - 1], depth: i - 1, dir: true, size: 0 }; } rows[f.path] = { path: f.path, name: p[p.length - 1], depth: p.length - 1, dir: false, size: f.size }; });
  return Object.keys(rows).sort().map(k => rows[k]);
}
function validate(files, skipped) {
  const L = lim(), errors = [], warnings = [], sink = { errors, warnings };
  const out = { ok: false, errors, warnings, manifest: null, runtime: '', entry: '', id: '', ver: '', bytes: 0, files: [], tree: [] };
  const err = (code, path, params) => errors.push({ code, path: path || '', params: params || {} });
  const seen = {}, clean = [];
  (Array.isArray(files) ? files : []).forEach(f => {
    const raw = f && f.path, path = normPath(raw); if (!path) { err('PATH', String(raw || '')); return; }
    if (seen[path]) return; seen[path] = 1; clean.push({ path, text: typeof f.text === 'string' ? f.text : '' });
  });
  (skipped || []).forEach(s => { if (s.reason === 'BIG') err('FILE_BIG', s.path, { kb: Math.ceil((s.size || 0) / 1024), max: Math.floor(L.file / 1024) }); });
  const ign = (skipped || []).filter(s => s.reason !== 'BIG').length; if (ign) warnings.push({ code: 'SKIPPED', path: '', params: { n: ign } });
  out.files = clean; out.tree = treeOf(clean);
  if (!clean.length) { if (!errors.length) err('FILES_EMPTY'); return out; }
  if (clean.length > L.files) err('FILES_LIMIT', '', { n: clean.length, max: L.files });
  let total = 0; clean.forEach(f => { total += f.text.length; if (f.text.length > L.file) err('FILE_BIG', f.path, { kb: Math.ceil(f.text.length / 1024), max: Math.floor(L.file / 1024) }); });
  out.bytes = total; if (total > L.total) err('TOTAL_BIG', '', { kb: Math.ceil(total / 1024), max: Math.floor(L.total / 1024) });
  const mf = clean.find(f => f.path === 'manifest.json'); if (!mf) { err('MANIFEST_MISSING'); return out; }
  let man; try { man = JSON.parse(mf.text); } catch (e) { err('MANIFEST_JSON', 'manifest.json', { msg: String(e.message || e).slice(0, 120) }); return out; }
  if (!man || typeof man !== 'object' || Array.isArray(man)) { err('MANIFEST_FIELD', 'manifest.json', { field: 'manifest' }); return out; }
  if (!ID.test(String(man.name || ''))) err('MANIFEST_FIELD', 'manifest.json', { field: 'name' });
  if (!VER.test(String(man.version || ''))) err('MANIFEST_FIELD', 'manifest.json', { field: 'version' });
  if (['js', 'py'].indexOf(man.runtime) < 0) err('MANIFEST_FIELD', 'manifest.json', { field: 'runtime' });
  if (man.params !== undefined && (!man.params || typeof man.params !== 'object' || Array.isArray(man.params))) err('MANIFEST_FIELD', 'manifest.json', { field: 'params' });
  out.manifest = man; out.id = String(man.name || ''); out.ver = String(man.version || ''); out.runtime = man.runtime === 'py' ? 'py' : man.runtime === 'js' ? 'js' : '';
  if (!out.runtime) return out;
  const entry = normPath(man.entry || entryOf(out.runtime)); if (!entry) { err('MANIFEST_FIELD', 'manifest.json', { field: 'entry' }); return out; }
  out.entry = entry;
  if (!(out.runtime === 'js' ? /\.(js|mjs)$/i : /\.py$/i).test(entry)) err('ENTRY_RUNTIME', entry, { entry, runtime: out.runtime });
  const ef = clean.find(f => f.path === entry); if (!ef) { err('ENTRY_MISSING', '', { entry }); return out; }
  if (!ef.text.trim()) err('ENTRY_EMPTY', entry);
  else {
    scan(ef.text, out.runtime, entry, sink);
    if (out.runtime === 'js' && !/\breturn\b/.test(ef.text)) warnings.push({ code: 'NO_RETURN', path: entry, params: {} });
  }
  out.ok = !errors.length; return out;
}

/* ---------- шаблоны ---------- */
const JS_BODY = [
  '// Тело функции: аргумент plugin = { packet, params, state, mem }.',
  '//   packet: { temp, cur, volt, vib, vdc }   params: из manifest.json   state: { src, ats, scenario }',
  '//   mem: объект, который сохраняется между тактами (например, для скорости роста температуры).',
  '// Вернуть { alarm: boolean, note?: string }. Нет доступа к сети, хранилищу, DOM и сессии.',
  'const p = plugin.packet, lim = plugin.params.temp_limit_c, rise = plugin.params.rise_limit_c;',
  'const prev = plugin.mem.prev; plugin.mem.prev = p.temp;',
  'if (p.temp > lim) return { alarm: true, note: "Стык " + p.temp.toFixed(1) + " °C выше уставки " + lim + " °C" };',
  'if (prev !== undefined && p.temp - prev > rise) return { alarm: true, note: "Резкий рост: +" + (p.temp - prev).toFixed(1) + " °C за такт" };',
  'return { alarm: false };', ''
].join('\n');
const PY_BODY = [
  '# Phase 2: файл исполняется на сервере FastAPI в отдельном процессе. Сейчас он хранится и проверяется, но не запускается.',
  '# Контракт тот же, что у JavaScript-плагина: на входе пакет телеметрии и параметры, на выходе alarm и необязательная заметка.',
  '',
  'def run(plugin: dict) -> dict:',
  '    p = plugin["packet"]                       # temp, cur, volt, vib, vdc',
  '    limit = plugin["params"].get("temp_limit_c", 85)',
  '    if p["temp"] > limit:',
  '        return {"alarm": True, "note": f"Стык {p[\'temp\']:.1f} °C выше уставки {limit} °C"}',
  '    return {"alarm": False}', ''
].join('\n');
function template(kind) {
  const py = kind === 'py', id = py ? 'SAMPLE-PY-GUARD' : 'SAMPLE-JS-GUARD', entry = entryOf(py ? 'py' : 'js');
  const manifest = { name: id, version: '1.0.0', runtime: py ? 'py' : 'js', entry, description: py ? 'Пример: контроль температуры стыка (Python, Phase 2)' : 'Пример: уставка температуры и скорость роста', params: { temp_limit_c: 85, rise_limit_c: 6 } };
  const readme = '# ' + id + '\n\nПлагин-пример для ARCTIC BUSBAR AI.\n\n- `manifest.json`: имя, версия, runtime (`js` или `py`), точка входа и параметры по умолчанию.\n- `' + entry + '`: ' + (py ? 'функция `run(plugin)`; исполняется на сервере (Phase 2).' : 'тело функции с аргументом `plugin`; выполняется в изолированном Web Worker.') + '\n\nЗагрузка: перетащите папку в окно «Добавить плагин».\n';
  return [{ path: 'README.md', text: readme }, { path: 'manifest.json', text: JSON.stringify(manifest, null, 2) + '\n' }, { path: entry, text: py ? PY_BODY : JS_BODY }];
}

g.PluginPack = Object.freeze({ fromFileList, fromDataTransfer, validate, template, treeOf, normPath, TEXT_EXT });
})(window);
