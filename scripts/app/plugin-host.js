/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/app/plugin-host.js  (ЭТАП 3: песочница пользовательских JS-плагинов)
   Раньше код плагина выполнялся через new Function в главном потоке — он видел всё окно (Store, localStorage, сессию). Теперь каждый включённый
   пользовательский JS-плагин живёт в своём Web Worker, собранном из Blob:
     1) выход наружу отрезан по всей цепочке прототипов: fetch, XMLHttpRequest, WebSocket, EventSource, importScripts, indexedDB, caches,
        BroadcastChannel, SharedWorker, Worker, WebTransport, navigator, таймеры; self.postMessage подменён (настоящий — в замыкании обвязки);
     2) генерация кода закрыта: eval, Function и конструкторы (Async/Generator)Function заменены на «бросатели» — плагин, скомпилированный обвязкой,
        не может собрать новый код (в том числе import() из склеенных строк); слово import в исходнике плагина отвергается статически;
     3) в плагин попадают только JSON-копии: plugin = {packet, params, state}; наружу уходит только {alarm: boolean, note: строка ≤ 200};
     4) сторожевой таймер в главном потоке: нет ответа за 200 мс (бесконечный цикл) → worker.terminate(); 3 таймаута подряд → плагин отключён.
   Worker не видит DOM, Store, UsersDB, localStorage, sessionStorage и сессию: их там просто нет.
   Если Worker из Blob недоступен (file:// в части браузеров), режим 'inline' допустим ТОЛЬКО при DEMO_MODE=true (как в этапе 2, без изоляции — ограничение
   честно показывается в интерфейсе); в боевой сборке режим 'none': плагины не исполняются.
   API: PluginHost = { mode, sync(list), tick(ctx), onResult(fn), stats, test(code, packet, params, ms), stop, TIMEOUT_MS }.
   fn({id, ok, alarm, note, message, ms}). Python-плагины хранятся и не исполняются (Phase 2: сервер FastAPI). */
(function (g) {
'use strict';
const TIMEOUT_MS = 200, MAX_TIMEOUTS = 3;
const DEMO = () => !!(g.ABAI_CONFIG && g.ABAI_CONFIG.DEMO_MODE === true);

/* ---------- обвязка Worker (исходник берётся из toString → проверяется node --check вместе с файлом) ---------- */
function workerMain() {
  'use strict';
  const compile = Function, post = self.postMessage.bind(self), perf = self.performance;
  const BLOCK = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'SharedWorker', 'Worker', 'WebTransport', 'navigator',
    'setTimeout', 'setInterval', 'requestAnimationFrame', 'Request', 'Response', 'Headers', 'FormData', 'Blob', 'FileReader', 'URL', 'createImageBitmap', 'OffscreenCanvas'];
  const chain = []; for (let o = self; o; o = Object.getPrototypeOf(o)) chain.push(o);
  BLOCK.forEach(n => chain.forEach(o => {
    if (Object.prototype.hasOwnProperty.call(o, n)) { try { Object.defineProperty(o, n, { value: undefined, writable: false, configurable: false }); } catch (e) { /* уже закрыто */ } }
  }));
  const dead = function () { throw new Error('API disabled in plugin sandbox'); };
  const lock = (o, k) => { try { Object.defineProperty(o, k, { value: dead, writable: false, configurable: false }); } catch (e) { /* ok */ } };
  lock(self, 'eval'); lock(self, 'Function'); lock(self, 'postMessage');
  [Function.prototype, Object.getPrototypeOf(async function () {}), Object.getPrototypeOf(function* () {}), Object.getPrototypeOf(async function* () {})].forEach(p => lock(p, 'constructor'));
  const deepFreeze = o => { if (o && typeof o === 'object') { Object.freeze(o); Object.keys(o).forEach(k => deepFreeze(o[k])); } return o; };
  let fn = null, mem = {};                                                                  // mem — единственное изменяемое состояние плагина между тактами
  const arg = pl => Object.freeze({ packet: deepFreeze(pl.packet), params: deepFreeze(pl.params), state: deepFreeze(pl.state), mem });
  self.addEventListener('message', ev => {
    const m = ev.data || {};
    if (m.type === 'init') {
      try {
        if (/\bimport\b/.test(String(m.code))) throw new Error('import is not allowed in plugins');
        fn = new compile('plugin', '"use strict";\n' + String(m.code)); post({ type: 'ready' });
      } catch (e) { post({ type: 'err', phase: 'compile', message: String((e && e.message) || e).slice(0, 240) }); }
      return;
    }
    if (m.type === 'tick' && fn) {
      const t0 = perf.now();
      try {
        const r = fn(arg(m.plugin));
        if (Object.keys(mem).length > 64) mem = {};                                         // страховка от разрастания памяти воркера
        post({ type: 'res', seq: m.seq, alarm: !!(r && r.alarm), note: String((r && r.note) || '').slice(0, 200), ms: perf.now() - t0 });
      } catch (e) { post({ type: 'err', seq: m.seq, phase: 'run', message: String((e && e.message) || e).slice(0, 240) }); }
    }
  });
}
const SRC = '(' + workerMain.toString() + ')();';

/* ---------- состояние ---------- */
let M = null, blobUrl = '';                                                         // M: 'worker' | 'inline' | 'none'
const W = new Map(), listeners = [], inlineFn = new Map();
const hashOf = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h) + ':' + s.length; };
const notify = r => listeners.slice().forEach(f => { try { f(r); } catch (e) { /* слушатель не должен ломать хост */ } });

function probe() {
  if (M) return M;
  try {
    if (typeof g.Worker !== 'function' || typeof g.Blob !== 'function' || !g.URL || !g.URL.createObjectURL) throw new Error('no worker');
    blobUrl = g.URL.createObjectURL(new g.Blob([SRC], { type: 'text/javascript' }));
    const w = new g.Worker(blobUrl); w.terminate(); M = 'worker';
  } catch (e) { M = DEMO() ? 'inline' : 'none'; }
  return M;
}
const fresh = id => ({ id, state: 'init', runs: 0, errors: 0, timeouts: 0, skipped: 0, avgMs: 0, lastMs: 0, key: '', w: null, pending: null, seq: 0, timer: 0, params: {}, last: null });

function spawn(rec, code) {
  kill(rec); rec.state = 'init';
  let w; try { w = new g.Worker(blobUrl); } catch (e) { rec.state = 'error'; notify({ id: rec.id, ok: false, message: 'WORKER_START' }); return; }
  rec.w = w;
  w.onmessage = ev => {
    const m = ev.data || {};
    if (m.type === 'ready') { rec.state = 'ok'; return; }
    if (m.type === 'res') {
      clearTimeout(rec.timer); rec.pending = null; rec.runs++; rec.timeouts = 0; rec.lastMs = m.ms; rec.avgMs = rec.avgMs ? rec.avgMs * 0.9 + m.ms * 0.1 : m.ms; rec.state = 'ok';
      notify({ id: rec.id, ok: true, alarm: !!m.alarm, note: m.note || '', ms: m.ms }); return;
    }
    if (m.type === 'err') {
      clearTimeout(rec.timer); rec.pending = null; rec.errors++; rec.state = 'error';
      notify({ id: rec.id, ok: false, message: m.message || 'ERROR', phase: m.phase });
    }
  };
  w.onerror = ev => { clearTimeout(rec.timer); rec.pending = null; rec.errors++; rec.state = 'error'; if (ev && ev.preventDefault) ev.preventDefault(); notify({ id: rec.id, ok: false, message: (ev && ev.message) || 'WORKER_ERROR' }); };
  w.postMessage({ type: 'init', code });
}
function kill(rec) { clearTimeout(rec.timer); rec.pending = null; if (rec.w) { try { rec.w.terminate(); } catch (e) { /* ok */ } rec.w = null; } }

/* ---------- публичное ---------- */
function sync(list) {
  const mode = probe(), want = new Map();
  (list || []).forEach(p => { if (p && !p.builtin && p.on && p.lang === 'js') want.set(p.id, p); });
  W.forEach((rec, id) => { if (!want.has(id)) { kill(rec); W.delete(id); inlineFn.delete(id); } });
  want.forEach((p, id) => {
    const key = hashOf(String(p.code || '')); let rec = W.get(id);
    if (!rec) { rec = fresh(id); W.set(id, rec); }
    rec.params = p.params || {};
    if (rec.key === key && rec.state !== 'disabled' && (mode !== 'worker' || rec.w)) return;
    if (rec.key === key && rec.state === 'disabled') return;
    rec.key = key; rec.timeouts = 0; rec.errors = 0;
    if (mode === 'worker') spawn(rec, String(p.code || ''));
    else if (mode === 'inline') {
      try { inlineFn.set(id, new Function('plugin', 'window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest', 'Store', 'UsersDB', '"use strict";\n' + String(p.code || ''))); rec.state = 'ok'; }
      catch (e) { rec.state = 'error'; notify({ id, ok: false, message: String(e.message).slice(0, 240), phase: 'compile' }); }
    } else rec.state = 'none';
  });
}
function tick(ctx) {
  if (!M) return;
  W.forEach(rec => {
    if (rec.state === 'disabled' || rec.state === 'none' || rec.state === 'error' && !rec.w && M === 'worker') return;
    const plugin = { packet: ctx.packet, params: rec.params, state: ctx.state };
    if (M === 'inline') {
      const fn = inlineFn.get(rec.id); if (!fn) return;
      const t0 = Date.now();
      try { const a = JSON.parse(JSON.stringify(plugin)); a.mem = rec.mem || (rec.mem = {}); const r = fn(a); rec.runs++; rec.lastMs = Date.now() - t0; notify({ id: rec.id, ok: true, alarm: !!(r && r.alarm), note: String((r && r.note) || '').slice(0, 200), ms: rec.lastMs }); }
      catch (e) { rec.errors++; notify({ id: rec.id, ok: false, message: String(e && e.message || e).slice(0, 240), phase: 'run' }); }
      return;
    }
    if (!rec.w || rec.state === 'init') return;
    if (rec.pending) { rec.skipped++; return; }                                  // предыдущий такт ещё считается — пропускаем (обратное давление)
    rec.pending = ++rec.seq;
    rec.timer = setTimeout(() => {
      if (!rec.pending) return;
      rec.timeouts++; rec.state = 'timeout'; kill(rec);
      if (rec.timeouts >= MAX_TIMEOUTS) { rec.state = 'disabled'; notify({ id: rec.id, ok: false, message: 'TIMEOUT', phase: 'run', disabled: true }); }
      else { notify({ id: rec.id, ok: false, message: 'TIMEOUT', phase: 'run' }); const p = (g.Store && g.Store.plugins.get(rec.id)); if (p) spawn(rec, String(p.code || '')); }
    }, TIMEOUT_MS);
    try { rec.w.postMessage({ type: 'tick', seq: rec.seq, plugin }); } catch (e) { clearTimeout(rec.timer); rec.pending = null; }
  });
}
/* Пробный прогон кода (окно «Добавить плагин»): компиляция + один такт в одноразовом Worker. */
function test(code, packet, params, ms) {
  const limit = ms || 400, mode = probe();
  const pl = { packet: packet || { temp: 42, cur: 780, volt: 110, vib: 0.2, vdc: 220 }, params: params || {}, state: { src: 'IN1', ats: 'open', scenario: 'none' } };
  return new Promise(res => {
    if (mode === 'none') { res({ ok: false, message: 'SANDBOX_UNAVAILABLE' }); return; }
    if (mode === 'inline') {
      try { const f = new Function('plugin', '"use strict";\n' + String(code)); const a = JSON.parse(JSON.stringify(pl)); a.mem = {}; const r = f(a); res({ ok: true, alarm: !!(r && r.alarm), note: String((r && r.note) || '') }); }
      catch (e) { res({ ok: false, message: String(e && e.message || e).slice(0, 240) }); }
      return;
    }
    let w, done = false; const t0 = Date.now();
    const fin = r => { if (done) return; done = true; clearTimeout(tm); try { w.terminate(); } catch (e) { /* ok */ } r.ms = Date.now() - t0; res(r); };
    const tm = setTimeout(() => fin({ ok: false, message: 'TIMEOUT' }), limit);
    try { w = new g.Worker(blobUrl); } catch (e) { fin({ ok: false, message: 'WORKER_START' }); return; }
    w.onmessage = ev => {
      const m = ev.data || {};
      if (m.type === 'ready') w.postMessage({ type: 'tick', seq: 1, plugin: pl });
      else if (m.type === 'res') fin({ ok: true, alarm: !!m.alarm, note: m.note || '' });
      else if (m.type === 'err') fin({ ok: false, message: m.message, phase: m.phase });
    };
    w.onerror = ev => fin({ ok: false, message: (ev && ev.message) || 'WORKER_ERROR' });
    w.postMessage({ type: 'init', code: String(code) });
  });
}
function stop() { W.forEach(kill); W.clear(); inlineFn.clear(); }
function stats() {
  const o = {}; W.forEach((r, id) => { o[id] = { state: r.state, runs: r.runs, errors: r.errors, timeouts: r.timeouts, skipped: r.skipped, avgMs: +r.avgMs.toFixed(2), lastMs: +r.lastMs.toFixed(2) }; }); return o;
}
g.PluginHost = Object.freeze({ mode: () => probe(), sync, tick, onResult: fn => { if (typeof fn === 'function') listeners.push(fn); }, stats, test, stop, TIMEOUT_MS });
})(window);
