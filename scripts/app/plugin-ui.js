/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/app/plugin-ui.js  (ЭТАП 3)
   Окно #mPlugin: «Добавить плагин» (папка с manifest.json и точкой входа ИЛИ один файл-код) и «Параметры плагина».

   • Вкладка «Папка плагина»: перетаскивание папки или «Выбрать папку…» → PluginPack читает дерево, validate() проверяет manifest, лимиты и код,
     для JS-плагина выполняется пробный запуск в песочнице PluginHost.test (синтаксис, таймаут 400 мс). «Пример на JavaScript/Python» кладёт готовую папку-шаблон.
   • Вкладка «Один файл (код)»: идентификатор, язык, JSON-параметры, код → та же проверка; manifest.json собирается автоматически.
   • Правка существующего плагина: у встроенных — только параметры, у пользовательских — параметры и код точки входа.
   • Право CAN_MANAGE_PLUGINS проверяется при открытии и при сохранении (подписанный токен в замороженной Store.session, не localStorage).
   • Журнал аудита: ev.plugin.add / ev.plugin.params / ev.plugin.code (для кода — короткий SHA-256 до и после).
   • При выходе из системы содержимое окна (код, дерево файлов) стирается.
   API: window.PluginUI = { open(id|null), close(), state() } */
(function (g) {
'use strict';
const D = document, $ = id => D.getElementById(id);
const T = (k, p) => g.I18N.t(k, p), ST = () => g.Store, PK = () => g.PluginPack, PH = () => g.PluginHost, SH = () => g.AppShell;
const can = () => !!(ST() && ST().session && ST().session.has('CAN_MANAGE_PLUGINS'));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = n => '<svg class="ico"><use href="#i-' + n + '"/></svg>';
const toast = (k, a, b) => { if (SH() && SH().toast) SH().toast(k, a, b); };
const denied = () => toast('err', T('perm.t'), T('perm.denied', { perm: 'CAN_MANAGE_PLUGINS' }));
const kb = n => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');
const short = s => { try { return g.CryptoLite.hex(g.CryptoLite.sha256(String(s))).slice(0, 8); } catch (e) { return ''; } };
const clone = o => JSON.parse(JSON.stringify(o));
const entryOf = lang => (lang === 'py' ? 'worker.py' : 'worker.js');
const ID_RE = /^[A-Za-z0-9._-]{2,40}$/;

/* tok — «поколение» окна: сбрасывает результаты асинхронных проверок, если окно успели закрыть или открыть заново */
const S = { plugin: null, tok: 0, seq: 0, rep: null, run: null, runP: null, dup: false, busy: false, lang: 'js' };

const isOpen = () => !!$('mPlugin') && !$('mPlugin').hidden;
const tabOn = () => { const b = $('plTabs') && $('plTabs').querySelector('.wnd-tab.on'); return b ? b.dataset.tab : 'code'; };
const goTab = t => { const b = $('plTabs').querySelector('[data-tab="' + t + '"]'); if (b && !b.classList.contains('on')) b.click(); };
const setI18n = (el, key) => { el.setAttribute('data-i18n', key); el.textContent = T(key); };
const setErr = m => { const e = $('plErr'); if (e) e.textContent = m || ''; };

/* текст под вкладками: что именно произойдёт с кодом плагина */
function noteFor(kind) {
  const m = PH() ? PH().mode() : 'none';
  const k = kind === 'py' ? 'p.note.py' : kind === 'cfg' ? 'p.note.cfg' : m === 'worker' ? 'p.note.js' : m === 'inline' ? 'p.note.inline' : 'p.note.none';
  setI18n($('plNote').querySelector('span'), k);
}

/* ---------- сообщения проверки ---------- */
function msgOf(kind, it, runtime) {                                                                              // kind: 'e' (ошибка) | 'w' (предупреждение)
  const params = Object.assign({ path: it.path || '' }, it.params || {});
  const key = 'pk.' + kind + '.' + it.code + (kind === 'w' && it.code === 'FORBIDDEN_API' && runtime === 'py' ? '.py' : '');
  return g.I18N.has(key) ? T(key, params) : it.code + (it.path ? ' · ' + it.path : '');
}
/* причины отказа Store.plugins.add / setCode; те, что требуют чисел (лимиты), validate() ловит раньше и с подробностями */
const reasonText = r => (r.reason === 'DUP' ? T('p.err.dup') : r.reason === 'ID' ? T('p.err.id')
  : /^(MANIFEST_MISSING|ENTRY_MISSING|PATH|FILES_EMPTY)$/.test(r.reason) && g.I18N.has('pk.e.' + r.reason) ? T('pk.e.' + r.reason, { path: r.path || '', entry: r.entry || '' }) : T('pk.err.invalid'));

/* ---------- пробный запуск JS в песочнице ---------- */
function trial(code, params) {
  const H = PH(); if (!H) return Promise.resolve({ state: 'na' });
  return H.test(code, null, params, 400).then(r => {
    if (r.ok) return { state: 'ok', ms: Math.round(r.ms || 0), alarm: !!r.alarm };
    if (r.message === 'SANDBOX_UNAVAILABLE') return { state: 'na' };
    return { state: 'err', m: String(r.message || 'ERROR').slice(0, 160), fatal: true };
  }, () => ({ state: 'na' }));
}
function runLine(run) {
  if (!run) return '';
  if (run.state === 'ok') return '<li class="ok">' + ico('check') + '<span>' + esc(T('pk.run.ok', { ms: run.ms, alarm: run.alarm ? 'true' : 'false' })) + '</span></li>';
  if (run.state === 'err') return '<li class="err">' + ico('warn') + '<span>' + esc(T('pk.run.err', { m: run.m })) + '</span></li>';
  if (run.state === 'py') return '<li class="warn">' + ico('info') + '<span>' + esc(T('pk.run.py')) + '</span></li>';
  return '<li class="warn">' + ico('info') + '<span>' + esc(T('pk.run.na')) + '</span></li>';
}

/* ---------- вкладка «Папка плагина»: отчёт о проверке ---------- */
function renderRep() {
  const rep = S.rep, box = $('pkRes'); if (!box) return;
  if (!rep) { box.hidden = true; $('pkTree').innerHTML = ''; $('pkIssues').innerHTML = ''; return; }
  box.hidden = false;
  $('pkName').textContent = rep.id || '—';
  $('pkRt').textContent = rep.runtime === 'py' ? 'PY' : rep.runtime === 'js' ? 'JS' : '—';
  $('pkVer').textContent = rep.ver ? 'v' + rep.ver : '—';
  $('pkSize').textContent = T('pk.files', { n: rep.files.length }) + ' · ' + kb(rep.bytes);
  $('pkTree').innerHTML = rep.tree.map(r => '<li class="' + (r.dir ? 'dir' : (r.path === rep.entry || r.path === 'manifest.json') ? 'key' : '') + '" style="--d:' + r.depth + '">' + ico(r.dir ? 'folder' : 'file') + '<span>' + esc(r.name) + '</span>' + (r.dir ? '' : '<small>' + kb(r.size) + '</small>') + '</li>').join('');
  let h = '';
  rep.errors.forEach(e => { h += '<li class="err">' + ico('warn') + '<span>' + esc(msgOf('e', e, rep.runtime)) + '</span></li>'; });
  if (S.dup) h += '<li class="err">' + ico('warn') + '<span>' + esc(T('p.err.dup')) + '</span></li>';
  h += runLine(S.run);
  rep.warnings.forEach(w => { h += '<li class="warn">' + ico('info') + '<span>' + esc(msgOf('w', w, rep.runtime)) + '</span></li>'; });
  if (rep.ok && !S.dup && !(S.run && S.run.fatal)) h = '<li class="ok">' + ico('check') + '<span>' + esc(T('pk.ok')) + '</span></li>' + h;
  $('pkIssues').innerHTML = h;
}
function showPack(res) {
  const my = ++S.seq, rep = PK().validate((res && res.files) || [], (res && res.skipped) || []);
  S.rep = rep; S.run = null; S.runP = null; S.dup = !!(rep.id && ST().plugins.get(rep.id)); setErr('');
  if (rep.runtime === 'py') S.run = { state: 'py' };
  noteFor(rep.runtime === 'py' ? 'py' : 'js');
  if (rep.ok && rep.runtime === 'js') {
    const ef = rep.files.find(f => f.path === rep.entry);
    S.runP = trial(ef ? ef.text : '', rep.manifest.params || {}).then(r => { if (my === S.seq) { S.run = r; renderRep(); } return r; });
  }
  renderRep();
}
const empty = () => ({ files: [], skipped: [] });

function bindDrop() {
  const z = $('pkDrop'); if (!z) return;
  ['dragenter', 'dragover'].forEach(n => z.addEventListener(n, e => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; z.classList.add('over'); }));
  ['dragleave', 'dragend'].forEach(n => z.addEventListener(n, e => { if (e.type === 'dragend' || !z.contains(e.relatedTarget)) z.classList.remove('over'); }));
  z.addEventListener('drop', e => {
    e.preventDefault(); z.classList.remove('over'); if (!can()) return denied();
    PK().fromDataTransfer(e.dataTransfer).then(showPack, () => showPack(empty()));                              // DataTransfer читается синхронно внутри fromDataTransfer
  });
  z.addEventListener('click', e => { if (!e.target.closest('button')) $('pkInput').click(); });
  z.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === z) { e.preventDefault(); $('pkInput').click(); } });
  $('pkPick').addEventListener('click', e => { e.stopPropagation(); $('pkInput').click(); });
  $('pkInput').addEventListener('change', e => {
    const f = e.target.files;
    if (f && f.length) PK().fromFileList(f).then(showPack, () => showPack(empty()));
    e.target.value = '';                                                                                         // тот же каталог можно выбрать повторно
  });
  $('pkSampleJs').addEventListener('click', e => { e.stopPropagation(); showPack({ files: PK().template('js'), skipped: [] }); });
  $('pkSamplePy').addEventListener('click', e => { e.stopPropagation(); showPack({ files: PK().template('py'), skipped: [] }); });
}

/* ---------- вкладка «Один файл» и правка ---------- */
function parseParams() { try { const v = JSON.parse($('plParams').value.trim() || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (e) { return null; } }
const manifestText = (id, ver, lang, entry, params) => JSON.stringify({ name: id, version: ver, runtime: lang, entry, params }, null, 2) + '\n';
const tplJs = () => T('p.code.tpl'), tplPy = () => PK().template('py')[2].text;
function onLangChange() {
  const was = S.lang, now = $('plLang').value === 'py' ? 'py' : 'js', cur = $('plCode').value;
  if (!cur.trim() || cur === (was === 'py' ? tplPy() : tplJs())) $('plCode').value = now === 'py' ? tplPy() : tplJs();
  S.lang = now; noteFor(now);
}

function finish(key, id) {
  toast('ok', T(key), id); S.tok++;
  if (SH()) SH().closeWnd('mPlugin');
  if (g.ScadaUI && g.ScadaUI.renderPlugins) g.ScadaUI.renderPlugins();
}
function logAdd(p, n) { ST().log({ cat: 'PLUGIN', k: 'ev.plugin.add', p: { id: p.id, rt: p.lang, files: n }, node: p.id, old: '', nw: 'ON' }); }

async function saveDir(tok) {
  const rep = S.rep; if (!rep) return setErr(T('pk.err.none'));
  if (S.runP) await S.runP;
  if (tok !== S.tok) return;
  if (!rep.ok || (S.run && S.run.fatal)) return setErr(T('pk.err.invalid'));
  if (S.dup || ST().plugins.get(rep.id)) return setErr(T('p.err.dup'));
  const r = ST().plugins.add({ files: rep.files }); if (!r.ok) return setErr(reasonText(r));
  logAdd(r.plugin, rep.files.length); finish('p.added', r.plugin.id);
}
async function saveCode(tok) {
  const id = $('plName').value.trim(), lang = $('plLang').value === 'py' ? 'py' : 'js', code = $('plCode').value, params = parseParams();
  if (params === null) return setErr(T('p.err.json'));
  if (!ID_RE.test(id)) return setErr(T('p.err.id'));
  if (ST().plugins.get(id)) return setErr(T('p.err.dup'));
  const entry = entryOf(lang), files = [{ path: 'manifest.json', text: manifestText(id, '0.1.0', lang, entry, params) }, { path: entry, text: code }];
  const rep = PK().validate(files, []); if (!rep.ok) return setErr(msgOf('e', rep.errors[0], lang));
  if (lang === 'js') { const t = await trial(code, params); if (tok !== S.tok) return; if (t.state === 'err') return setErr(T('p.err.js', { m: t.m })); }
  const r = ST().plugins.add({ files: rep.files }); if (!r.ok) return setErr(reasonText(r));
  logAdd(r.plugin, 2); finish('p.added', r.plugin.id);
}
async function saveEdit(tok) {
  const p = S.plugin; if (!p || !ST().plugins.get(p.id)) return setErr(T('pk.err.invalid'));
  const params = parseParams(); if (params === null) return setErr(T('p.err.json'));
  const bi = !!p.builtin, code = $('plCode').value, codeChanged = !bi && code !== String(p.code || '');
  if (codeChanged) {
    const entry = p.entry || entryOf(p.lang), files = [{ path: 'manifest.json', text: manifestText(p.id, p.ver || '0.1.0', p.lang, entry, params) }, { path: entry, text: code }];
    const rep = PK().validate(files, []); if (!rep.ok) return setErr(msgOf('e', rep.errors[0], p.lang));
    if (p.lang === 'js') { const t = await trial(code, params); if (tok !== S.tok) return; if (t.state === 'err') return setErr(T('p.err.js', { m: t.m })); }
  }
  const oldParams = clone(p.params || {}), paramsChanged = JSON.stringify(oldParams) !== JSON.stringify(params);
  if (codeChanged) {
    const r = ST().plugins.setCode(p.id, code); if (!r.ok) return setErr(reasonText(r));
    ST().log({ cat: 'PLUGIN', k: 'ev.plugin.code', p: { id: p.id, n: code.length }, node: p.id, old: short(r.old), nw: short(code) });
  }
  if (paramsChanged) {
    ST().plugins.setParams(p.id, params);
    ST().log({ cat: 'PLUGIN', k: 'ev.plugin.params', p: { id: p.id }, node: p.id, old: JSON.stringify(oldParams), nw: JSON.stringify(params), undo: { kind: 'pluginParams', data: { id: p.id, params: oldParams } } });
  }
  finish('p.saved', p.id);
}
async function save() {
  if (S.busy) return;
  if (!can()) { setErr(T('perm.denied', { perm: 'CAN_MANAGE_PLUGINS' })); return; }                                // право проверяется заново: токен мог истечь, пока окно было открыто
  setErr(''); S.busy = true; $('plSave').disabled = true; const tok = S.tok;
  try { if (S.plugin) await saveEdit(tok); else if (tabOn() === 'dir') await saveDir(tok); else await saveCode(tok); }
  catch (e) { setErr(String((e && e.message) || e).slice(0, 160)); }
  finally { S.busy = false; $('plSave').disabled = false; }
}

/* ---------- открытие / закрытие ---------- */
function open(id) {
  if (!can()) return denied();
  const p = id ? ST().plugins.get(id) : null; if (id && !p) return;
  S.tok++; S.seq++; S.plugin = p; S.rep = null; S.run = null; S.runP = null; S.dup = false; S.busy = false; $('plSave').disabled = false;
  const isNew = !p, bi = !!(p && p.builtin);
  setI18n($('plTitle'), isNew ? 'p.new' : 'p.edit');
  $('plSub').textContent = isNew ? '' : p.id + ' · v' + p.ver + (bi ? '' : ' · ' + (p.lang === 'py' ? 'Python' : 'JavaScript'));
  $('plTabs').hidden = !isNew; $('plNameF').hidden = !isNew; $('plLangF').hidden = !isNew; $('plCodeF').hidden = bi;
  $('plName').value = isNew ? '' : p.id; $('plLang').value = p ? p.lang : 'js'; S.lang = p ? p.lang : 'js';
  $('plParams').value = JSON.stringify(p ? p.params : { threshold: 85, enabled: true }, null, 2);
  $('plCode').value = p && !bi ? String(p.code || '') : tplJs();
  $('pkDrop').classList.remove('over'); renderRep(); setErr('');
  goTab(isNew ? 'dir' : 'code');
  noteFor(bi ? 'cfg' : (p ? p.lang : 'js'));
  if (SH()) SH().openWnd('mPlugin', isNew ? $('pkDrop') : $('plParams'));
}
function close() { S.tok++; if (SH()) SH().closeWnd('mPlugin'); }
function wipe() {                                                                                                  // выход из системы: код и дерево файлов не остаются в DOM
  S.tok++; S.seq++; S.plugin = null; S.rep = null; S.run = null; S.runP = null; S.dup = false;
  if (!$('mPlugin')) return;
  $('plCode').value = ''; $('plParams').value = ''; $('plName').value = ''; setErr(''); renderRep();
}

let bound = false;
function bind() {
  if (bound || !$('mPlugin')) return; bound = true;
  bindDrop();
  $('plSave').addEventListener('click', save);
  $('plLang').addEventListener('change', onLangChange);
  $('plName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  $('plTabs').addEventListener('click', e => {
    const b = e.target.closest('.wnd-tab'); if (!b || S.plugin) return; setErr('');
    noteFor(b.dataset.tab === 'dir' ? (S.rep && S.rep.runtime === 'py' ? 'py' : 'js') : $('plLang').value);
  });
  g.addEventListener('abai:lang', () => { if (isOpen()) renderRep(); });
  g.addEventListener('abai:auth', e => { if (e.detail && e.detail.type === 'logout') wipe(); });
  /* файл, брошенный мимо зоны, не должен открываться браузером вместо страницы */
  ['dragover', 'drop'].forEach(n => g.addEventListener(n, e => { const t = e.dataTransfer && e.dataTransfer.types; if (t && Array.prototype.indexOf.call(t, 'Files') >= 0) e.preventDefault(); }));
}
if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', bind); else bind();

g.PluginUI = Object.freeze({
  open, close,
  state: () => ({ open: isOpen(), tab: tabOn(), edit: S.plugin ? S.plugin.id : null, hasPack: !!S.rep, packOk: !!(S.rep && S.rep.ok), dup: S.dup, run: S.run ? S.run.state : null, busy: S.busy })
});
})(window);
