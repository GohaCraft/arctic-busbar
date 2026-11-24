/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/core/config.js  (глобальный конфиг, БЕЗ UI)
   Подключается САМЫМ ПЕРВЫМ. Единственный «главный выключатель» комплекса:

       window.ABAI_CONFIG = { DEMO_MODE: true }

   DEMO_MODE === true   — показ для жюри: меню [?] с готовыми паролями, кнопки испытаний (Нагрев / Пурга / Блэкаут),
                          симулятор pinn-simulator.js генерирует данные, на экране входа доступен QR жюри.
   DEMO_MODE === false  — боевой режим: [?] и кнопки испытаний удалены из DOM, демо-пароли не загружаются,
                          датчики OFFLINE («—») до подключения железа (Web Serial / WebSocket-шлюз FastAPI).

   Fail-safe: боевым считается ЛЮБОЕ значение, кроме строгого true. Конфиг замораживается: из консоли (F12) после загрузки
   его уже не переключить. Это только UX-слой: настоящая граница доверия — сервер (Phase 2, FastAPI): он сам решает,
   отдавать ли демо-учётки и данные. Сервер может подставить значения ДО загрузки скриптов:
       <script>window.ABAI_CONFIG = { DEMO_MODE: false, API_BASE: '/api/v1' };</script>
   Для тестов тот же приём: page.addInitScript(() => { window.ABAI_CONFIG = { DEMO_MODE: false }; }). */
(function (g) {
'use strict';
const DEFAULTS = {
  DEMO_MODE: true,                          // ← ПЕРЕКЛЮЧАТЕЛЬ ДЕМО / БОЙ
  API_BASE: '',                             // '' = мок-режим на клиенте; '/api/v1' = запросы к FastAPI (Phase 2)
  PUBLIC_URL: '',                           // адрес, который попадает в QR (например 'http://192.168.4.1:8000/'); '' = адрес этой страницы
  GATEWAY_WS: 'ws://127.0.0.1:8765/ws',     // WebSocket Python-демона (шлюз железа)
  SERIAL_BAUD: 115200,                      // скорость UART ESP32
  SESSION_TTL_S: 8 * 3600,                  // срок жизни сессии (JWT-образный токен, exp)
  QR_TTL_S: 90                              // срок жизни QR-токена «Подключить телефон»
};
const given = g.ABAI_CONFIG && typeof g.ABAI_CONFIG === 'object' ? g.ABAI_CONFIG : {};
const cfg = {};
Object.keys(DEFAULTS).forEach(k => { cfg[k] = Object.prototype.hasOwnProperty.call(given, k) ? given[k] : DEFAULTS[k]; });
cfg.DEMO_MODE = cfg.DEMO_MODE === true;
['SERIAL_BAUD', 'SESSION_TTL_S', 'QR_TTL_S'].forEach(k => { cfg[k] = +cfg[k] > 0 ? +cfg[k] : DEFAULTS[k]; });
['API_BASE', 'GATEWAY_WS', 'PUBLIC_URL'].forEach(k => { cfg[k] = typeof cfg[k] === 'string' ? cfg[k] : DEFAULTS[k]; });
try { Object.defineProperty(g, 'ABAI_CONFIG', { value: Object.freeze(cfg), writable: false, configurable: false, enumerable: true }); }
catch (e) { g.ABAI_CONFIG = Object.freeze(cfg); }
})(window);
