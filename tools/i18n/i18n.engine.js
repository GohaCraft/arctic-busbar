/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/core/i18n.js  (ФАЙЛ СГЕНЕРИРОВАН tools/i18n/build.py — не правьте словарь здесь, правьте tools/i18n/dict.psv)
   Движок перевода на 6 языков: ru, en, zh (中文), kk (Қазақша), be (Беларуская), uk (Українська).
   Разметка: data-i18n="ключ" (текст), data-i18n-html (текст с <b>), data-i18n-ph (placeholder), data-i18n-title, data-i18n-aria, data-i18n-p='{"n":1}' (параметры {n}).
   API: I18N.t(ключ, параметры, язык?) · I18N.set(язык) · I18N.get() · I18N.apply(корень) · I18N.has(ключ) · I18N.dur(минуты) · I18N.langs · I18N.names.
   Цепочка запасных значений: текущий язык → en → ru → сам ключ. После смены языка шлёт событие window «abai:lang» {lang}: модули перерисовывают динамический текст.
   Язык хранит и применяет Store (scripts/core/store.js): Store.set('lang', 'zh') → I18N.set('zh'). */
(function (g) {
'use strict';
const ORDER = ['ru', 'en', 'zh', 'kk', 'be', 'uk'];
const NAMES = { ru: 'Русский', en: 'English', zh: '中文', kk: 'Қазақша', be: 'Беларуская', uk: 'Українська' };
const D = /* @@DICT@@ */;
let cur = 'ru';
const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const has = key => Object.prototype.hasOwnProperty.call(D, key);
function raw(key, lang) { const r = D[key]; if (!r) return null; const i = ORDER.indexOf(lang || cur); return (i >= 0 && r[i]) || r[1] || r[0] || null; }
function t(key, params, lang) {
  let s = raw(key, lang); if (s == null) return key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] == null ? m : params[k]));
  return s;
}
function prm(el) { const j = el.getAttribute('data-i18n-p'); if (!j) return null; try { return JSON.parse(j); } catch (e) { return null; } }
function apply(root) {
  root = root || document;
  qa('[data-i18n]', root).forEach(el => { const k = el.getAttribute('data-i18n'); if (has(k)) el.textContent = t(k, prm(el)); });
  qa('[data-i18n-html]', root).forEach(el => { const k = el.getAttribute('data-i18n-html'); if (has(k)) el.innerHTML = t(k, prm(el)); });   // только доверенный словарь, без пользовательских данных
  [['ph', 'placeholder'], ['title', 'title'], ['aria', 'aria-label']].forEach(a => qa('[data-i18n-' + a[0] + ']', root).forEach(el => { const k = el.getAttribute('data-i18n-' + a[0]); if (has(k)) el.setAttribute(a[1], t(k, prm(el))); }));
}
function set(lang) {
  if (ORDER.indexOf(lang) < 0) return false;
  cur = lang; document.documentElement.lang = lang; apply(document);
  g.dispatchEvent(new CustomEvent('abai:lang', { detail: { lang } })); return true;
}
/* длительность из минут: «70 ч», «15 мин», «45 с» (если < 1 мин) */
function dur(min) {
  if (!isFinite(min)) return '—';
  if (min >= 180) return (min / 60).toFixed(min >= 600 ? 0 : 1) + ' ' + t('u.h');
  if (min >= 1) return Math.round(min) + ' ' + t('u.min');
  return Math.max(1, Math.round(min * 60)) + ' ' + t('u.s');
}
g.I18N = { t, has, set, get: () => cur, apply, dur, langs: ORDER, names: NAMES, dict: D };
})(window);
