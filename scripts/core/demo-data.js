/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/core/demo-data.js  (ДЕМО-ДАННЫЕ ДЛЯ ЖЮРИ, БЕЗ UI)
   Единственное место, где лежат открытые демо-пароли для меню [?] на экране входа. В users-db.js паролей нет — только PBKDF2-хеши.

   Fail-safe: если window.ABAI_CONFIG.DEMO_MODE !== true, файл не определяет НИЧЕГО (window.ABAI_DEMO остаётся undefined),
   поэтому даже случайно поставленный в боевую сборку он не раскрывает пароли. Для боевой поставки тег <script> с этим файлом удаляют целиком.
   Подключается после config.js; читает его auth.js (меню [?]) и qr-jury.js (тестовый вход жюри). */
(function (g) {
'use strict';
if (!g.ABAI_CONFIG || g.ABAI_CONFIG.DEMO_MODE !== true) return;
const acc = (login, pass, id, fio, role, badge) => Object.freeze({ login, pass, id, fio, role, badge });
g.ABAI_DEMO = Object.freeze({
  accounts: Object.freeze([
    acc('eng.rza', 'admin123', '1073819', 'Левицкий А.Р.', 'admin', 'Admin'),
    acc('disp.smena', 'operator123', '1073820', 'Соколов И.В.', 'operator', 'Operator'),
    acc('jury.qr', 'jury123', '1073821', 'Эксперт Жюри', 'jury', 'Observer')
  ]),
  scenarios: Object.freeze(['heat', 'spoof', 'blackout'])
});
})(window);
