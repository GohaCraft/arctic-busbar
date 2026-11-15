/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/app-shell.js  (каркас #app — перенесён из старого users-db.js без изменений поведения)
   Навигация по вкладкам, быстрые переключатели (язык / тема / часовой пояс / анимации / акцент), строка профиля, модалки,
   таблица заявок на смену пароля (RBAC) с «Одобрить / Отклонить». Бизнес-логику дашборда (датчики, граф, аудит) НЕ содержит:
   её напишут store.js / pinn-simulator.js / obsidian-graph.js / scada-ui.js. Реагирует на abai:auth, abai:pwdrequest, abai:pwdresolved. */
(function (g) {
'use strict';
const $ = id => document.getElementById(id), qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s)), B = document.body;
const TZ = { utc3: 3, utc7: 7, utc8: 8, utc0: 0 }, esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let me = null; const tmpMap = {};

const profile = () => me ? g.AuthApp.profile(me) : '';
const cfg = () => { if (me && $('cfgString')) $('cfgString').textContent = profile(); };
function show(v) {
  qa('.view').forEach(x => x.classList.toggle('on', x.id === 'view-' + v));
  qa('#side nav button').forEach(x => x.classList.toggle('on', x.dataset.view === v)); cfg();
}
function renderPwd() {
  if (!$('pwdBody') || !g.UsersDB) return;
  const L = g.UsersDB.allRequests().slice().reverse(), z = TZ[($('selTz') || {}).value] || 0;
  $('pwdBody').innerHTML = L.map(r => '<tr><td>' + r.id + '</td><td>' + new Date(r.ts + z * 36e5).toISOString().replace('T', ' ').slice(0, 19) + '</td><td>' + esc(r.fio) + '</td><td>' + r.code + '</td><td>' + esc(r.text) + '</td><td>' + r.status + (tmpMap[r.id] ? ' · ' + tmpMap[r.id] : '') + '</td><td>' +
    (r.status === 'PENDING' ? '<button class="btn primary" data-res="1" data-id="' + r.id + '">Одобрить</button> <button class="btn" data-res="0" data-id="' + r.id + '">Отклонить</button>' : '—') + '</td></tr>').join('');
  const n = g.UsersDB.pending().length; if ($('cPwd')) { $('cPwd').textContent = n; $('cPwd').classList.toggle('hot', n > 0); }
}
if ($('pwdBody')) $('pwdBody').addEventListener('click', e => {
  const a = e.target.closest('[data-res]'); if (!a) return;
  const r = g.UsersDB.resolve(a.dataset.id, a.dataset.res === '1', me && me.fio); if (r.tempPassword) tmpMap[a.dataset.id] = r.tempPassword; renderPwd();
});
['abai:pwdrequest', 'abai:pwdresolved'].forEach(n => g.addEventListener(n, renderPwd));
g.addEventListener('abai:auth', e => {
  const d = e.detail || {};
  if (d.type === 'login') { me = d.user; show('grid'); renderPwd(); cfg(); } else { me = null; qa('.overlay').forEach(o => { o.hidden = true; }); }
});

qa('#side nav button').forEach(b => { b.onclick = () => show(b.dataset.view); });
if ($('selTheme')) $('selTheme').onchange = e => { document.documentElement.dataset.theme = e.target.value; cfg(); };
if ($('selTz')) $('selTz').onchange = () => { cfg(); renderPwd(); };
if ($('selLang')) $('selLang').onchange = cfg;
if ($('chkAnim')) $('chkAnim').onchange = e => { B.classList.toggle('no-animations', !e.target.checked); cfg(); };
if ($('inpAccent')) $('inpAccent').oninput = e => document.documentElement.style.setProperty('--acc', e.target.value);
qa('.seg[data-set]').forEach(s => { s.onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  const sel = $({ lang: 'selLang', theme: 'selTheme', tz: 'selTz' }[s.dataset.set]); if (!sel) return; sel.value = b.dataset.val; sel.dispatchEvent(new Event('change'));
  qa('button', s).forEach(x => x.classList.toggle('on', x === b));
}; });
qa('[data-act=qr]').forEach(b => { b.onclick = () => { $('mQr').hidden = false; if (g.QRJury) g.QRJury.refresh(true); }; });
qa('[data-close]').forEach(b => { b.onclick = () => { b.closest('.overlay').hidden = true; }; });

g.AppShell = { show, renderPwd, profile, TZ };
})(window);
