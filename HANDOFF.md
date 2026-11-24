# ARCTIC BUSBAR AI v2.4.0-prod — ПЕРЕДАЧА ЭТАП 3 → ЭТАП 4 (Phase 2: сервер FastAPI и реальное железо)

Ты — следующий агент в конвейере. Проект: промышленный веб-комплекс предиктивной диагностики болтовых соединений шин подстанций 110–220 кВ (демо InARCTic-2026, ЗГУ Норильск). Владелец — Левицкий А.Р. (пишет по-русски, часовой пояс Asia/Krasnoyarsk, UTC+7). Чистый HTML/CSS/JS без внешних библиотек, шрифтов и картинок: офлайн, открывается двойным кликом по `index.html` (`file://`) или через `python3 -m http.server`. Ответ — на русском, в 4 блока: (1) журнал найденных багов и решений, (2) дерево файлов, (3) полный код тронутых файлов готовыми файлами + архив, (4) этот файл. Файлы не обрезай и не оставляй заглушек вида «остальной код без изменений». «continue» от пользователя = «продолжай по ТЗ, вопросов не задавай». Среда: Bash без сети (pip / npm / git закрыты), 2 ядра CPU — тяжёлые наборы тестов запускай ПО ОДНОМУ; после паузы сервер и фоновые процессы могут быть остановлены (перезапусти и перепроверь).

## 1. СТАТУС И ХВОСТЫ

### Готово и проверено автотестами (Chromium / Playwright и Node; консоль 0 ошибок / 0 предупреждений / 0 запросов 4xx)
Юнит-набор `tests/unit-core.js` — 218 ✓ / 0 ✗; сквозные: этап 1 — 100 ✓ / 0 ✗, этап 1 доп. — 24 ✓ / 0 ✗, этап 2 — 203 ✓ / 0 ✗, этап 3 — 96 ✓ / 0 ✗.

**Пункты ТЗ этапа 3**
1. **Zero Trust**: права живут только в `Store.session` — замороженной сессии в памяти, собранной из подписанного токена (HS256, 8 ч, права в `pm`). Ключи `abai.perms_override` / `abai.pass_override` код больше не читает и не пишет (остались только строки-история в комментарии шапки `users-db.js`); сквозной тест подкладывает в них права admin и пароль «hacked» — вход и права не меняются. Токен лежит в `sessionStorage` (`abai.s.tok`): F5 сессию сохраняет, закрытие вкладки и новая вкладка — нет; «Выйти» стирает токен и все `abai.s.*`, останавливает таймеры сессии и PINN, очищает граф и черновик плагина. Подделанный или просроченный токен после F5 отвергается с понятной причиной на экране входа, подделка пишется в журнал аудита (`ev.sec.tamper`).
2. **Пароли и QR**: открытых паролей в `users-db.js`, `store.js`, `auth.js`, `qr-jury.js`, `index.html` нет — только хеши PBKDF2-HMAC-SHA256 (29 000 раундов, формат passlib `$pbkdf2-sha256$…`). Демо-пароли лежат только в `scripts/core/demo-data.js`, который ничего не определяет при `DEMO_MODE !== true`. Ссылка QR — `<адрес>#abai-qr=<JWT-образный токен>`: подпись, срок 90 с, одноразовый `jti`, отзыв; открытого кода и uid в адресе нет, токен стирается из адресной строки после чтения. Старые ссылки `?qr_auth=…&code=…` отвергаются (`LEGACY`). Вход: одно нейтральное сообщение «Неверный логин или пароль.» на все причины; 5 ошибок → пауза 30 с, дальше ×2 до 300 с, счётчик запечатан HMAC в `sessionStorage` и переживает F5.
3. **DEMO_MODE** (`window.ABAI_CONFIG = { DEMO_MODE: true }`, `scripts/core/config.js`, замораживается, боевым считается всё, кроме строгого `true`). `true`: меню `[?]` с готовыми паролями, «Испытания стенда» (Нагрев, Пурга, Блэкаут), данные `pinn-simulator.js`. `false`: `[?]`, меню аккаунтов, тестовые кнопки и строка «Сброс демо» отсутствуют в DOM, `ABAI_DEMO` не определён, симулятор не запускается, матрица датчиков OFFLINE «—», статус «PINN Core · нет данных»; окно «Подключение оборудования» (Web Serial / WebSocket-шлюз) + вкладка «Инструкция для инженеров» (ESP32, MLX90614, INA219, MPU6050, I²C, формат JSON, шлюз FastAPI).
4. **`#app`**: Ribbon 48 px, стеклянная статус-полоса без `<select>`, Inspector-лист, на телефоне ≤ 820 px нижний стеклянный Dock + карточки вместо таблиц; настройки в стиле Obsidian (Интерфейс: тема Dark / Amber / Light, градиентные и волнистые фоны, акцент; Язык; Производительность; Оборудование; База и бэкап); 6 языков в `#app` и `#auth`; профиль с личным QR по кнопке «Подключить телефон».
5. **Граф** (`obsidian-graph.js`): минимальные залитые точки разного размера, физика «как d3-force» (притяжение / отталкивание / центр), drag, zoom, pan, LOD (вдали — точки, вблизи — подписи и формулы), импульсы по линиям, раскладка по `user.id` в `Store.layout` (`abai.layouts`), двойной клик освобождает узел, «Сбросить раскладку». **Плагины**: добавление папкой (`manifest.json` + `worker.js` / `worker.py`) с проверкой, деревом файлов и пробным запуском в Web Worker; Python только хранится; без права `CAN_MANAGE_PLUGINS` кнопки добавления, ⚙, удаления скрыты, переключатели заблокированы, право перепроверяется в обработчиках.
6. **Экран входа**: свет по времени суток (ночь → рассвет → день → закат), переключатель «Полярная ночь 24/7» (сохраняется), без боке-пузырей и ёлок; физика капель: касание / мышь стирают иней, капли собираются в крупную и стекают; на телефоне открытие клавиатуры (меняется только высота) не пересоздаёт сцену; стекло в духе Apple / Telegram.

### Журнал найденных багов и решений безопасности (этап 3)
**Реальные уязвимости и баги, найденные тестами и исправленные**
1. `UsersDB.pin.code(uid)` был публичным «оракулом»: любой мог получить PIN чужого аккаунта → PIN выдаётся только владельцу сессии (Bearer.sub === uid), иначе `''`.
2. Защита от ключа `__proto__` в `hardware-link.js` не работала: ключ в литерале объекта `{ '__proto__': 1 }` не создаёт собственного свойства → заменено на `Set` + `JSON.parse`-reviver; тест: загрязнения прототипа нет.
3. Вложенные `UsersDB.qr / pin / jury` не были заморожены (из консоли подменялся `UsersDB.qr.issue`) → заморожены, проверено юнит- и сквозным тестами.
4. Подделанный токен после F5 сбрасывался молча → теперь причина на экране входа (`auth.sess.tamper` / `auth.sess.expired`) и запись в журнал аудита.
5. Переводы (последний проход вычитки — 33 строки: BE 19, UK 6, KK 6, ZH 2): в белорусском «лацінiца» с латинской «i» внутри слова (омоглиф), 15 нарушений чередования у / ў («на Увод» → «на ўвод», «Ўстаўка» → «Устаўка»), «Свой колер» → «Уласны колер», «галоўнаму інжынеру» → «…інжынеру РЗА»; в украинском «Показ ІЧ» (ложный друг: «показання»), непереведённая подсказка камеры QR (в UK и BE), «уже» → «вже»; в казахском разнобой «түйіспе / түйісу / қосылыс» приведён к единому употреблению и «2-кезең» заменено на «Phase 2»; в китайском полуширинные скобки вокруг китайского текста. Теперь это ловят автопроверки словаря.
6. Старые наборы этапов 1–2 под новую архитектуру адаптированы (нейтральные сообщения, подписанные токены, `Store.session`, новые размеры шапки и окон); ни одно ожидание не ослаблено без причины. Пример последней правки: код плагина с `window` / `localStorage` теперь отклоняется пробным запуском в песочнице ЕЩЁ ДО сохранения (ошибка в окне, плагин не создаётся) — тест этапа 2 это проверяет, а прежнее поведение «ошибка в строке плагина» проверяется кодом, который ломается только на живых данных.
**Архитектурные решения**
- Честная модель угроз: подпись токенов на клиенте — мок (ключ в `users-db.js`). Настоящая граница доверия — сервер Phase 2. Клиент уже работает «как с сервером»: единственная точка замены — `scripts/core/users-db.js` (`authenticate`, `verifySession`, `reissue`, `setPerm`, `qr.*`, `pin.*`); интерфейс прав нигде не читает ничего, кроме `Store.session`.
- Данные железа проходят только через `HardwareLink.parseLine/normalize` (лимит 4 КБ на строку, диапазоны значений, синонимы полей, фильтр `__proto__ / constructor / prototype`); в боевом режиме нет `_test`-входа. Источник данных `PINN.source()`: `sim` | `hw` | `none`, связь считается потерянной после 5 с тишины.
- Плагины JS исполняются в Web Worker (нет DOM, `localStorage`, сети; лимит времени на вызов); Python — только хранение (исполнитель — FastAPI, Phase 2).

### Хвосты (не сделано / ограничения, по убыванию важности)
1. **Сервер Phase 2 не написан**: `API_BASE` в конфиге зарезервирован, мок `UsersDB` заменяется вызовами `/api/v1/…` (см. §3). До этого «безопасность» — это дисциплина клиента и честный UX-слой, а не защита от злоумышленника с DevTools.
2. **Реальное железо не подключалось** (устройства нет): протокол проверен разборщиком, юнит-тестами и фиктивным WebSocket-шлюзом. Web Serial работает только в Chrome / Edge на `https://` или `localhost`.
3. **Скиллы `unslop` и `shadcn`**: ТЗ разрешило читать их с GitHub, но GitHub из окружения недоступен (сеть закрыта) — правила из ТЗ применены вручную (§2.3).
4. **Переводы KK / BE / UK / ZH** написаны агентом: автопроверки (алфавиты, омоглифы, у / ў, ложные друзья, копии русских строк, плейсхолдеры) и выборочная вычитка пройдены, но вычитка носителем всё равно желательна. Ключи `hw.e.*`, `hw.s.*`, `hw.src.*`, `pk.e.*`, `pk.w.*` собираются в коде динамически — предупреждение `build.py` «не используется» по ним ложное.
5. Python-плагины не исполняются; JS-плагины исполняются в Worker, но это демо-изоляция, а не доказанная песочница.
6. FPS графа и фона входа на реальной видеокарте не измерен (в headless на CPU порог ≥ 28 FPS). Сканер камеры QR работает только там, где есть `BarcodeDetector`; иначе — штатная камера телефона (ссылка → автовход) или ввод 6 цифр.
7. Универсальный PIN жюри `261126` и демо-пароли — только при `DEMO_MODE === true`. Временные пароли (одобренные заявки) в бэкап `.json` намеренно не попадают; восстановление из бэкапа права и хеши не принимает.

## 2. АРХИТЕКТУРА И КОНТРАКТЫ

### 2.1 Дерево проекта
```
arctic-busbar-ai/
├─ index.html                        разметка: #auth, #app (Ribbon, статус-полоса, 4 вида, Inspector, Dock, окна), SVG-спрайт #i-*, затем скрипты
├─ HANDOFF.md                        этот файл
├─ styles/auth/auth-glass.css        экран входа: сцена, стекло, карточка, поля, кнопки, переключатели языка и полярной ночи, адаптив, клавиатура
├─ styles/auth/auth-panels.css       меню [?], drawer, вкладки, QR / PIN, OTP, восстановление пароля, камера
├─ styles/app/tokens-shadcn.css      токены 3 тем, типографика, кнопки, тумблеры, бейджи, поля, сегменты, стекло .float, keyframes a-*
├─ styles/app/backgrounds.css        фоны #app: градиентные и волнистые (html[data-bg]), полярная ночь (html[data-polar])
├─ styles/app/obsidian-shell.css     сетка #app, Ribbon 48 px, статус-полоса, меню Demo, Inspector, Dock, тосты
├─ styles/app/views-workspace.css    виды: датчики (в том числе OFFLINE), граф (панель, миникарта), журнал аудита, плагины; телефонные карточки
├─ styles/app/modals-profile-set.css менеджер окон, профиль (QR / RBAC / заявки), настройки, калибровка, отчёт
├─ styles/app/hardware-plugins.css   окно «Подключение оборудования», окно добавления плагина (папка / код)
├─ scripts/core/config.js            ABAI_CONFIG (DEMO_MODE, API_BASE, PUBLIC_URL, GATEWAY_WS, SERIAL_BAUD, SESSION_TTL_S, QR_TTL_S), заморожен
├─ scripts/core/crypto-lite.js       SHA-256, HMAC, PBKDF2, HOTP / TOTP, подписанные токены (чистый JS, без DOM)
├─ scripts/core/users-db.js          «сервер»-мок: аккаунты (хеши), RBAC по токену, QR / PIN, блокировка, заявки на сброс пароля
├─ scripts/core/i18n.js              СГЕНЕРИРОВАН tools/i18n/build.py (движок + словарь 6 языков) — руками не править
├─ scripts/core/store.js             настройки, уставки, плагины, журнал + Rollback, бэкап, Store.session, Store.layout
├─ scripts/core/demo-data.js         ТОЛЬКО DEMO: подписи тестовых аккаунтов и пароли для меню [?]
├─ scripts/auth/qr-encoder.js        кодировщик QR (ISO 18004, байтовый режим, версии 1–10, ECC L/M/Q/H)
├─ scripts/auth/qr-jury.js           drawer, QR, PIN, ячейки, камера, автовход по #abai-qr
├─ scripts/auth/frost-scene.js       слои сцены #auth: небо по времени суток, подстанция, сияние, иней
├─ scripts/auth/frost-drops.js       физика капель: сбор в крупную каплю, скольжение, касание
├─ scripts/auth/frost-canvas.js      конвейер слоёв, часы сцены, полярная ночь, политика ресайза, регулятор качества
├─ scripts/auth/auth.js              вход / выход, меню [?] (только DEMO), переключатель языка, восстановление пароля
├─ scripts/app/hardware-link.js      транспорт железа: Web Serial + WebSocket, parseLine / normalize, давность данных
├─ scripts/app/plugin-pack.js        папка плагина: чтение, проверка manifest и кода, шаблоны, дерево файлов
├─ scripts/app/plugin-host.js        Web Worker-песочница JS-плагинов
├─ scripts/app/pinn-simulator.js     ядро: источники sim / hw / none, физика стыка, RUL, LTO / ДГУ, АВР, сценарии (только DEMO)
├─ scripts/app/obsidian-graph.js     граф топологии (Canvas 2D): физика, LOD, импульсы, раскладка по пользователю
├─ scripts/app/scada-ui.js           датчики (OFFLINE), Inspector, калибровка, аудит, плагины, верхняя панель
├─ scripts/app/plugin-ui.js          окно добавления / правки плагина (папка и код)
├─ scripts/app/hardware-ui.js        окно «Подключение оборудования» и инструкция для инженеров
├─ scripts/app/app-shell.js          каркас: виды, окна, тосты, Demo-меню, профиль, RBAC, заявки, настройки, отчёт
├─ tools/i18n/dict.psv               ИСТОЧНИК переводов: key|ru|en|zh|kk|be|uk (664 ключа)
├─ tools/i18n/i18n.engine.js         шаблон движка (в него build.py вставляет словарь)
├─ tools/i18n/build.py               сборка и проверка словаря → scripts/core/i18n.js (`--check` — только проверка)
└─ tests/ unit-core.js · e2e-stage1.js · e2e-stage1-extra.js · e2e-stage2-app.js · e2e-stage3.js · fixtures/plugin-MY-GUARD/ · out/ (создаётся тестами)
```

### 2.2 Порядок подключения (в index.html важен)
CSS: `auth-glass` → `auth-panels` → `tokens-shadcn` → `backgrounds` → `obsidian-shell` → `views-workspace` → `modals-profile-set` → `hardware-plugins`.
JS: `config` → `crypto-lite` → `users-db` → `i18n` → `store` → `demo-data` → `qr-encoder` → `qr-jury` → `frost-scene` → `frost-drops` → `frost-canvas` → `auth` → `hardware-link` → `plugin-pack` → `plugin-host` → `pinn-simulator` → `obsidian-graph` → `scada-ui` → `plugin-ui` → `hardware-ui` → `app-shell`. Новый файл — добавь в свой блок, иначе 404.

### 2.3 Дизайн-система (правила STEP 0, соблюдать)
- Obsidian + Shadcn + Apple Glass + unslop. Моно-палитра Zinc / Slate; стекло (`backdrop-filter: blur(24px) saturate(180%)`) ТОЛЬКО на плавающих слоях (`.float`: Inspector, окна, меню, Dock, тосты) и на карточке входа (явное требование ТЗ этапа 3); свечение — еле заметное.
- Границы — волосяные `1px solid var(--border)` + блик `var(--spec)`. Никаких неоновых рамок, грубых пунктирных кнопок, пустых серых коробок. Цвет статуса несёт смысл (ok / warn / err).
- Токены по темам `html[data-theme="dark|amber|light"]`; акцент `--acc` задаёт `Store`; фон `html[data-bg]`; полярная ночь `html[data-polar="1"|"0"]`; режим `body.dataset.mode = 'demo' | 'prod'`.
- Шрифты — системные стеки, числа `tabular-nums`. Иконки — SVG-спрайт `#i-*`. Keyframes `a-*`; `body.no-animations` и `prefers-reduced-motion` выключают анимации; глобально `[hidden]{display:none!important}`.
- Раскладка `#app`: fixed-grid; десктоп — Ribbon 48 px слева, статус-полоса сверху; телефон ≤ 820 px — верхняя полоса 42 px + `#mdock`. `#insp.open` выезжает. Окна: `.wnd-wrap[data-open="1"]`, закрытие — `[data-close]`, Esc, клик по фону.

### 2.4 Глобальные объекты (контракты не ломать без нужды)
- **`ABAI_CONFIG`** — см. `config.js`. **`CryptoLite`** — `sha256 hmac pbkdf2 hashPassword verifyPassword hotp totp signToken verifyToken(token, key, {typ, aud}) → {ok, payload | reason: FORMAT|ALG|SIGNATURE|EXPIRED|NOT_YET|TYPE|AUDIENCE} decodeToken b64u ab64 randomId timingSafeEqual`.
- **`UsersDB`** (заморожен, включая `qr / pin / jury`): `authenticate(login, pass) → Promise<{ok, token, user} | {ok:false, reason: EMPTY|NO_USER|BAD_PASS|LOCKED}>` (интерфейс показывает ОДНО нейтральное сообщение), `verifySession(token)`, `reissue(token)` (тот же `sid` и `exp`), `setPerm(uid, perm, bool, bearer)` (только admin: `FORBIDDEN` / `UNAUTHENTICATED` / `BAD_ARGS`), `permsOf`, `requestReset / pending / allRequests / resolve(id, approve, by, bearer) / resetLimit`, `qr.{issue(bearer), redeem(token), revoke(bearer, tok), used, parse, isLegacy, inspect}`, `pin.{code(uid, bearer), redeem(code[, uid])}`, `jury.*` (только DEMO), `snapshot()` (только `{requests, last}`) / `restore()` (права и хеши игнорирует) / `resetDemo()`, `wipeSession()`, `lockLeft()`, `integrity(clear)`. Права: `CAN_SWITCH_RELAY`, `CAN_EDIT_PINN`, `CAN_ROLLBACK_LOGS`, `CAN_MANAGE_PLUGINS`. Аккаунты демо: `1073819 eng.rza` (admin), `1073820 disp.smena` (operator), `1073821 jury.qr` (jury).
- **`Store`**: `get/set` настроек `{lang, theme, accent, bg, polar, anim, tz, tele, fps, fx}`; `thr.*` уставки; `plugins.{list,get,enabled,setOn,setParams,add,remove,LIMITS}` (`add` хранит `files` папки); `audit.*`; `layout.{get,set,clear}(uid)` (ключ `abai.layouts`, `{nodeId: [x, y, закреплён]}`); `log(...)`; `backup.*`; **`session`** (заморожен): `start restore end user info has isAdmin active bearer refresh expiresIn age interval timeout clear timers rejected` + события `abai:session`, `abai:auth {type:'login'|'logout'}`.
- **`I18N`**: `t(key, params, lang?)`, `has`, `set`, `get`, `apply(root)`, `dur`. Разметка: `data-i18n`, `data-i18n-html`, `data-i18n-ph`, `data-i18n-title`, `data-i18n-aria`, `data-i18n-p='{"n":1}'`. Запасная цепочка: язык → en → ru → ключ.
- **`PINN`**: `state()`, `series(name)`, `packets()`, `flows`, `alarmNode`, `pluginErrors()`, `source()` (`'sim'|'hw'|'none'`), `isLive()`, `isRunning()`, `scenario(k)` (в боевом режиме сценарии недоступны), `act(k)` / `transfer()` (команды в железо идут через `HardwareLink.send`; отказ → событие `abai:cmdfail`), `ingest(sample)`, `wipe()`, `start/stop`, `ack`, `reset`, `rulOf`, `C`, `TOPO`.
- **`HardwareLink`** (заморожен): `supported state info devices log scan connect disconnect send i2cScan parseLine normalize isFresh STALE_MS`; `_test` — только DEMO. **`HardwareUI`**: `open / refresh / devices`. **`PluginPack`**: `fromFileList fromDataTransfer validate template treeOf normPath TEXT_EXT`. **`PluginHost`**: `mode sync tick onResult stats test stop TIMEOUT_MS`. **`PluginUI`**: `open close state`.
- **`ObsidianGraph`**: `init start stop resize fit focus select setPinned togglePin nodes edges byId hover selected camera isRunning stats lod pins layout saveLayout loadLayout resetLayout onSelect onBackground`. Узлы: `in1 in2 ats bus1 bus2 joint core dgu lto s_cur s_ir s_vib`.
- **`FrostCanvas`**: `start stop wipe setClock(h|null) stats() debug()`; **`ScadaUI`**, **`AppShell`**, **`AuthApp`** `{user, isAuthed, logout, login, shake, profile, clock}`, **`QRJury`** (`state()` → `{url, …}`), **`QREncoder`** — как в этапах 1–2.

### 2.5 События `window` (`e.detail`)
`abai:auth {type:'login'|'logout', user, via}` · `abai:session {state:'start'|'restore'|'refresh'|'end', sid | reason}` · `abai:session-ok {user, token, kind, via}` (вход по QR / PIN) · `abai:jury-fail {via, reason}` · `abai:tamper {key}` (в журнал: `ev.sec.tamper`) · `abai:rbac {userId, perm, value, old}` (админ изменил право) · `abai:pwdrequest / abai:pwdresolved` · `abai:settings {key,value}` · `abai:lang` · `abai:thresholds` · `abai:plugins` · `abai:audit` · `abai:restored` · `abai:sim` · `abai:source {source, prev}` (смена источника данных `sim|hw|none`) · `abai:cmdfail {name}` (команда не дошла до железа) · `abai:alarm` · `abai:ats` · `abai:dgu` · `abai:scenario` · `abai:spoof` · `abai:plugin-alarm` · `abai:plugin-error` · `abai:hw` (`HardwareLink`: состояние, пакеты, список устройств).

### 2.6 DOM-контракт (id и data-хуки, на которые опираются тесты)
Каркас: `app ribbon rbNav rbInd btnProfile btnSettings top secTitle coreStatus coreLbl metrics tU tI tT tRul tSrc btnDemo btnDemoM demoMenu (.dm-item[data-k=heat|spoof|blackout|reset]) rowReset tClock alarm main mdock btnProfileM insp inspBody toasts`. Вид «Датчики»: `sensorGrid .sc[data-sid][data-st][data-off="1"] .sc-val`. Граф: `gWrap graphCanvas gPanel gFit gPin gReset miniMap`. Журнал: `auditPeriod auditUser auditType auditCsv auditBody`. Плагины: `btnAddPlugin plugList .pl-row[data-id] [data-pl-on|data-pl-cfg|data-pl-del]`; окно плагина: `pkDrop pkInput pkName pkRt pkVer pkTree pkIssues pkSampleJs pkSamplePy plName plCode plParams plLang plSave`. Профиль: `mProfile (.wnd-tab[data-tab=id|rbac|req]) empName empId pfPerms rbMatrix input[data-rbac] btnLogout`; телефон: `pfPhone pfQrWrap pfQr pfPin[data-code] pfLink[data-url] pfUrl pfSec pfTimerBar pfPhoneOff pfPhoneDone`. Настройки: `mSettings (.st-nav [data-cat=ui|lang|perf|hw|db])`. Оборудование: `mHardware hwScan hwWsUrl hwWsForm hwWsGo hwStateT .wnd-tab[data-tab=link|guide]`. Экран входа: `loginUser loginPass loginBtn authMsg helpBtn acctPop .acct[data-u][data-p] (только DEMO) qrBtn drawer authPolar bgCanvas`.

### 2.7 Контракт плагина
**JS**: тело функции; вход `plugin = {packet:{temp,cur,volt,vib,vdc}, params, state:{src,ats,scenario}}`, выход `{alarm: boolean, note?: string}`; исполняется в Web Worker. **Папка**: `manifest.json` (`name` 2–40 символов `[A-Za-z0-9._-]`, `version` `x.y.z`, `runtime: js|py`, `entry` по умолчанию `worker.js` / `worker.py`) + точка входа, не более 24 файлов, 128 КБ на файл, 512 КБ всего, только текстовые расширения, пути без `..` и не-ASCII. Образец: `tests/fixtures/plugin-MY-GUARD/`.

### 2.8 Журнал аудита и Rollback
Без изменений: запись `{id, ts, userId, user, role, cat, k, p, node, old, nw, undo, rb}`; текст — `I18N.t(k, p)` при отрисовке; откат через `Store.audit.registerUndo(kind, fn)`, нужен `CAN_ROLLBACK_LOGS`; лимит 500 записей. Добавлена категория безопасности: `ev.sec.tamper` (подмена данных браузера или токена).

### 2.9 i18n: как добавить или изменить текст
1. Правь `tools/i18n/dict.psv` (`ключ|ru|en|zh|kk|be|uk`, все 6 колонок; `|` внутри текста нельзя).
2. `python3 tools/i18n/build.py` — валидирует и пересобирает `scripts/core/i18n.js`; `--check` только проверяет.
3. В коде `T('ключ', {n: 1})`, в разметке `data-i18n="ключ"`; динамический текст перерисовывай по `abai:lang`. Не вшивай русский текст в JS.
4. Юнит-набор проверяет словарь: 7 колонок, уникальные ключи, плейсхолдеры, нет кириллицы в EN / ZH, нет копий русского текста в KK / BE / UK, алфавиты BE и UK, у / ў в BE, «показ» в UK, скобки в ZH, омоглифы.

### 2.10 Железо и шлюз (протокол)
Строка JSON на пакет (UART ESP32 115200 бод или сообщение WebSocket): `{"t":55.2,"ta":-21,"i":780,"u":110.4,"acc":0.15,"vdc":220,"soc":95}` (синонимы `temp / cur / kv …`; `ats`, `in1`, `in2`, `dgu` — положения). Служебное: `{"i2c":[90,64,104]}` — ответ на `{"cmd":"i2c_scan"}`; `{"hello":"fw 2.4.1"}`. Шлюз FastAPI (Phase 2) читает порт ESP32 и ретранслирует строки в `ws://127.0.0.1:8765/ws`. Подробная инструкция для инженеров (пины, адреса I²C 0x5A / 0x40 / 0x68) — в окне «Подключение оборудования» → «Инструкция для инженеров».

### 2.11 Как тестировать
Сервер: `cd` в корень проекта, `python3 -m http.server 8765 --bind 127.0.0.1` (если `curl http://127.0.0.1:8765/index.html` не даёт 200 — перезапусти). Запуск ПО ОДНОМУ (2 ядра): `node tests/unit-core.js` (≈ 2 с, Node, без браузера) · `NODE_PATH=$(npm root -g) node tests/e2e-stage3.js` (≈ 4 мин) · `tests/e2e-stage1.js` (≈ 2 мин) · `tests/e2e-stage1-extra.js` (≈ 0,5 мин) · `tests/e2e-stage2-app.js` (≈ 7 мин). `ABAI_ONLY=1,2` — только указанные блоки; `ABAI_URL` — другой адрес. Код выхода 0 = всё зелёное. Боевой режим в тестах: `ctx.addInitScript(() => { window.ABAI_CONFIG = { DEMO_MODE: false }; })` (после загрузки конфиг не переопределить); WebSocket-шлюз имитируется `page.routeWebSocket(...)`. Для навигации по одному `#`-адресу сначала `page.goto('about:blank')`.

## 3. ПЛАН СЛЕДУЮЩЕГО ШАГА (ЭТАП 4 / Phase 2)
1. **Сервер FastAPI**, замена мока 1 в 1 по контракту `UsersDB`: `POST /api/v1/auth/login` → токен (`sub, sid, role, pm, iat, exp`, подпись на сервере, лучше RS256 / EdDSA), `POST /auth/refresh`, `POST /auth/logout`; `POST /qr/issue` (Bearer) → `{token, url, exp, pin}`, `POST /qr/redeem`, `POST /qr/revoke`; `PATCH /users/{id}/perms` (admin, запись в журнал); заявки на сброс пароля; пароли хешируются на сервере (passlib, `pbkdf2-sha256` или argon2). `API_BASE` в `ABAI_CONFIG` уже есть; блокировку перебора и одноразовость `jti` перенести на сервер (`Redis` / БД), клиентские счётчики оставить только как UX.
2. **Шлюз железа**: демон на Python (`pyserial` + `websockets` / FastAPI WebSocket) → `ws://…/ws`, формат §2.10; проверка на настоящем ESP32 + MLX90614 / INA219 / MPU6050.
3. **Исполнение Python-плагинов** на сервере в изолированном процессе с лимитами; результат — в `abai:plugin-alarm`.
4. Вычитка переводов носителями KK / BE / UK / ZH; при наличии сети — реальные пакеты `unslop` / `shadcn`.
5. Регрессия: все наборы зелёные (числа в §1), консоль 0 / 0 / 0. Контракты `abai:*`, `UsersDB`, `Store`, `I18N` и DOM-хуки §2.6 не менять без нужды. Обнови этот файл и выдай ответ в 4 блока.
