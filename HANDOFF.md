# ARCTIC BUSBAR AI v2.4.0-prod — ПЕРЕДАЧА ЭТАП 1 → ЭТАП 2

Ты — следующий агент в конвейере. Проект: промышленный веб-комплекс предиктивной диагностики подстанций 110–220 кВ (демо InARCTic-2026, ЗГУ Норильск). Владелец — Левицкий А.Р. Работаешь на чистом HTML/CSS/JS без внешних библиотек, шрифтов и картинок (офлайн, открывается двойным кликом по index.html или через `python3 -m http.server`). Ответ — на русском, в 4 блока: дерево файлов, полный код тронутых файлов (готовыми файлами), отчёт, сообщение следующему агенту. Файлы не обрезай и не оставляй заглушек вида «остальной код без изменений».

## 1. СТАТУС И ХВОСТЫ

### Готово на 100% (проверено: 94 + 24 автотеста Playwright, консоль 0 ошибок / 0 предупреждений / 0 HTTP 4xx)
- Экран `#auth`: процедурный canvas-фон 60 FPS (полярная ночь, расфокусированные огни подстанции, метель, конденсат, изморозь по краям, капли с физикой и чистыми следами, пружинный параллакс мыши/наклона телефона), стеклянная карточка в консольном стиле, шапка `[● CORE ONLINE] root@arctic-busbar:~/auth$ UTC+7 ЧЧ:ММ:СС [?]`.
- Меню `[?]` с 3 аккаунтами (клик подставляет логин и пароль и закрывается), глазок `#eyeBtn`, вход по логину / табельному коду / ФИО, ошибки с упругим «встряхиванием» карточки, `ACCESS GRANTED // ЗАГРУЗКА ПРОФИЛЯ…` (1,4 с), открытие `#app` с ФИО / ID / ролью, «Выйти».
- Восстановление пароля: лимит 1 запрос / 24 ч на аккаунт (localStorage, переживает перезагрузку, общий для логина / кода / ФИО), живой таймер остатка, письмо «Здравствуйте, ФИО (ID код) забыл пароль, измените пароль.» на `security-rza@nornickel-arctic.ru` + `mailto:` + запись в `UsersDB.allRequests()`; в `#app` → вкладка «Права и заявки»: «Одобрить / Отклонить» (одобрение выдаёт временный пароль).
- QR-панель жюри (320 px, кнопка «QR жюри» слева внизу карточки): вкладка «На ПК (QR)» — настоящий QR на `#qrCanvas` (свой кодировщик ISO 18004, лучший из помещающихся уровней коррекции H → Q → M → L, тихая зона ≥ 4 модулей, круглый логотип без белого квадрата), 6 крупных ячеек PIN, полоска таймера 30 с, кнопка «Тестовый вход в режим Жюри»; вкладка «С телефона (ввод кода)» — 6 ячеек с автопереходом, вставкой из буфера, кнопка камеры (`getUserMedia` + `BarcodeDetector`); на экранах ≤ 820 px — автоматически вкладка телефона и нижняя шторка. QR проверен независимыми декодерами на живых скриншотах с бегущей линией: ZXing/WeChat — 20 из 20 кадров, OpenCV QRCodeDetector — 15 из 20 (он капризнее телефонных сканеров).
- Автовход по ссылке из QR `?qr_auth=jury_session&code=XXXXXX` (адрес очищается через `history.replaceState`); устаревшая ссылка → сообщение + панель на вкладке телефона.
- Живые часы UTC+7 на экране входа и в шапке `#app` (`#tClock`, пояс переключается `#selTz`), таймер сессии `#empSess`.
- Мобильная раскладка 320–820 px, `prefers-reduced-motion` (один статичный кадр), файл открывается и по `file://`.

### Хвосты (не сделано, по убыванию важности)
1. Вся логика `#app` НЕ написана (по ТЗ Этапа 1): симулятор датчиков, граф, таблицы, журнал аудита, плагины, демо-сценарии, словари языков. Каркас разметки есть, показания «0.0».
2. i18n: в разметке 121 ключ `data-i18n` (русский текст в HTML = эталон RU-словаря), словаря и переключателя языка нет. Строки, зашитые в JS (`MSG` в auth.js, `msg(...)` в qr-jury.js, тексты в users-db.js), нужно провести через i18n, когда появится `I18N.t()`.
3. Сканер камеры работает только там, где есть `BarcodeDetector` (Chrome / Edge / Android); в iOS Safari и Firefox его нет — остаются штатная камера телефона (откроет ссылку → автовход) и ручной ввод 6 цифр. JS-декодера QR-изображений нет (опциональный хвост).
4. `store.js` должен слушать `abai:pwdrequest` и писать запись `PWD_RESET` в журнал аудита (в users-db.js оставлен такой комментарий), а также применять права `CAN_*` (`UsersDB.permsOf(id)`).
5. Сессия не сохраняется при перезагрузке страницы (после F5 — снова экран входа); при желании хранить в `sessionStorage` из store.js.
6. Скорость на реальной видеокарте не измерена (в headless на CPU 26–38 FPS; встроенный регулятор качества сам опускает уровень, если кадр > 26 мс дольше 2,5 с).
7. Демо-данные: пароли в открытом виде и универсальный PIN `261126` — только для демонстрации; в продуктиве пароли заменяются bcrypt-хешами FastAPI (Phase 2).
8. Светлая тема (`data-theme`) касается только `#app`; экран входа всегда тёмный «стеклянный».

## 2. АРХИТЕКТУРА И КОНТРАКТЫ

### Файлы (порядок подключения в конце index.html важен)
```
index.html                 разметка: #auth (вход + drawer + модалки), затем #app (каркас), затем скрипты
styles/industrial.css      общая база и каркас #app (экран входа вынесен)
styles/auth-glass.css      переменные --g-*, сцена, стекло, карточка, шапка-консоль, поля, кнопки, адаптив
styles/auth-panels.css     меню [?], drawer, вкладки, QR / PIN / таймер, ячейки OTP, модалка восстановления, камера, шторка ≤ 820 px
scripts/users-db.js        (1) данные: аккаунты, RBAC, сброс пароля, код и ссылка жюри (без UI)
scripts/qr-encoder.js      (2) кодировщик QR (байтовый режим UTF-8, версии 1–10, ECC L/M/Q/H, маски 0–7)
scripts/qr-jury.js         (3) drawer, отрисовка QR, PIN, ячейки, камера, автовход по ссылке
scripts/frost-scene.js     (4) сцена фона: небо, огни, метель, силуэты, изморозь
scripts/frost-drops.js     (5) физика капель и их отрисовка
scripts/frost-canvas.js    (6) конвейер слоёв bgCanvas, параллакс, регулятор качества
scripts/auth.js            (7) логика входа / выхода, [?], часы, восстановление пароля, shake
scripts/app-shell.js       (8) каркас #app: вкладки, быстрые настройки, таблица заявок
tests/e2e-stage1.js        основной набор (94 проверки)      tests/e2e-stage1-extra.js  дополнительный (24)
HANDOFF.md                 это сообщение
```
Закомментированы в index.html (раскомментировать по мере появления файлов, иначе 404): `scripts/i18n.js`, `scripts/store.js`, `scripts/pinn-simulator.js`, `scripts/obsidian-graph.js`, `scripts/scada-ui.js`.

### Стеклянный стиль (CSS-переменные `:root`, глобальные)
`--g-bg:rgba(13,19,29,.58)  --g-bg-2:rgba(8,13,21,.80)  --g-blur:blur(30px) saturate(190%)  --g-line:rgba(255,255,255,.15)  --g-line-2:rgba(255,255,255,.08)  --g-spec:inset 0 1px 0 rgba(255,255,255,.24)  --g-shadow  --g-ice:#7DD3FC  --g-ice2:#38BDF8  --g-glow:rgba(56,189,248,.32)  --g-ok:#34D399  --g-warn:#FBBF24  --g-err:#FB7185  --g-tx:#E6EEF8  --g-dim:#8FA3BA  --g-faint:#5F738B  --g-field:rgba(3,7,12,.52)  --g-r:20px  --g-r-sm:12px  --g-mono  --g-sans  --g-ease  --g-spring`.
Класс `.glass` (карточка, drawer, модалки): фон `var(--g-bg)`, `backdrop-filter: blur(30px) saturate(190%)` (+ `-webkit-`), рамка `1px solid var(--g-line)`, блик `var(--g-spec)`. Ловушка Backdrop Root: у предков `.glass` не должно быть `opacity<1`, `filter`, `clip-path`, `mask`; анимации на предках — с `backwards`. Консольная строка: класс `.term` (`.on` + `.dot`, `.path`, `.clock`, `.help`). Классы состояний: `.msg.err|ok|info`, `.card.shake|err`.

### Классы и атрибуты `body`
`body.locked` — виден экран входа (`#auth`), `#app` скрыт (`visibility:hidden; position:fixed`, чтобы не раздувать ширину страницы); `body.entering` — 0,7 с после входа; `body.no-animations` — отключает анимации; `body[data-role]` (`admin|operator|jury`) и `body[data-uid]` выставляются при входе; элементы `[data-perm=admin]` скрываются для не-админов.

### window.UsersDB (scripts/users-db.js)
- Константы: `ENTERPRISE_ADMIN_EMAIL`, `MAIL_TEMPLATE{subject,body}`, `RESET_LIMIT_MS` (24 ч), `JURY_BASE_URL`, `JURY_QR_URL`, `PERMS` = `['CAN_SWITCH_RELAY','CAN_EDIT_PINN','CAN_ROLLBACK_LOGS','CAN_MANAGE_PLUGINS']`.
- `authenticate(query, password)` → `{ok:true,user}` | `{ok:false, reason:'EMPTY'|'NO_USER'|'BAD_PASS', userId?}`; `user = {id, login, code, fio, role, roleLabel, perms}`.
- `list()`, `find(q)` (логин / табельный код / ФИО без учёта регистра, точек, пробелов, ё/е), `juryUser()`, `permsOf(id)`, `setPerm(id, perm, bool)` → `{ok, userId, perm, old, value}` (жюри менять нельзя).
- `requestReset(query)` → `{ok:true, request, to, subject, body, mailto, nextAt}` | `{ok:false, reason:'NO_USER'|'LIMIT', remainingMs, nextAt, fio, text}`; `request = {id:'PW-…', ts, userId, login, code, fio, text, to, status:'PENDING'|'APPROVED'|'REJECTED', by?, resolvedTs?}`.
- `allRequests()`, `pending()`, `resolve(id, approve, by)` → `{ok, request, tempPassword}`; `remainingMs(userId)`, `formatClock(ms)` → `ЧЧ:ММ:СС`, `formatRemaining(ms)`, `resetLimit(userId)` (снять лимит: тесты / админ).
- Жюри: `jury.win()`, `jury.code()`, `jury.left()` (0…1), `jury.verify(code)` — принимает текущее, предыдущее и следующее окно 30 с (допуск часов ±30 с) и универсальный PIN `261126`; `juryLink(code?)` → `<адрес страницы>?qr_auth=jury_session&code=XXXXXX` (при `file://` база — `http://192.168.4.1:8000/`; переопределяется `window.ABAI_JURY_URL` или localStorage `abai.jury_url`); `devices()`, `countDevice()`, `drawQR(canvas, text)`.
- localStorage-ключи: `abai.pwd_last`, `abai.pwd_requests`, `abai.pass_override`, `abai.perms_override`, `abai.jury_devices`, `abai.jury_url` (если localStorage недоступен — копия в памяти вкладки).

### Остальные публичные объекты
- `window.AuthApp = {user(), isAuthed(), logout(), login(user, via), shake(), profile(user), clock()}`; строка профиля `<id>_<язык>_<тема>_<вид>_<пояс>_<anim>`, например `1073819_ru_dark_grid_utc7_anim1` (вид `grid|graph`).
- `window.QRJury = {init, toggle(force), setTab('pc'|'phone'), refresh(force), encodeBest(text), drawQR(canvas, qr), codeFrom(text), submit(code, via), consumeUrlAuth(), closeCam(), isOpen(), state() → {code, url, version, ecc}}`; `window.QREncoder = {encode(text,{ecc,minVersion,maxVersion,mask}), capacityBytes, MAX_VERSION}`.
- `window.FrostCanvas = {ok, start(), stop(), wipe(x, y, px, py), pulse(a), setReduced(bool), stats()}`; запускается сам по `body.locked`, останавливается при входе.
- `window.AppShell = {show(view), renderPwd(), profile(), TZ}`; виды: `grid | graph | audit | rbac | plugins | settings`.

### События на `window` (CustomEvent, данные в `e.detail`)
- `abai:auth` — `{type:'login'|'logout', user, via:'password'|'jury-test'|'jury-code'|'jury-scan'|'jury-link', ts}` (при logout `via` нет, `user` — вышедший).
- `abai:pwdrequest` — объект заявки (см. выше); `abai:pwdresolved` — `{request, tempPassword}`.
- `abai:jury-ok` / `abai:jury-fail` — `{via}`; вход выполняет auth.js.

### Каркас `#app`: готовые id и хуки
Шапка: `tU tI tT tRul tSrc` (показатели), `tzLabel tClock cfgString`, `selLang selTheme selTz`, `btnCrash`, демо `demoHeat demoSpoof demoBlackout demoReset`, `alarm`, `linkBar`. Профиль: `empAva empName empId empRole empSess`, `btnLogout`. Счётчики вкладок: `cGrid cGraph cAudit cPwd cPlug`. Виды: `view-grid` (`gridSearch gridTags`, карточки датчиков `MLX90614-IR-01 INA219-CUR-01 MPU6050-VIB-01 LTO-BAT-BUF`), `view-graph` (`graphCanvas gSearch gRep gLen gFlow gShowS gShowR gShowF gFit gPin miniMap`), `view-audit` (`auditPeriod auditFrom auditTo auditUser auditType auditCsv auditBackup auditRestore auditTable auditBody`), `view-rbac` (`rbacTable rbacBody pwdTable pwdBody`), `view-plugins` (`btnAddPlugin btnUpdate updMsg pluginTable`), `view-settings` (`inpAccent chkAnim btnBackup btnRestore`), инспектор `insp inspClose inspBody`, модалки `mQr mCrash mPlugin`, шаблон состояний `<template id="tplStates">` (`data-s="empty|offline|error|loading"`). Хуки: `data-view`, `data-act="calib|params|qr"`, `data-tag`, `data-set="lang|theme|tz"`, `data-i18n`, `data-perm="admin"`; закрытие модалок — `[data-close]`.

### Как тестировать
`python3 -m http.server 8765 --bind 127.0.0.1` в корне проекта, затем `NODE_PATH=$(npm root -g) node tests/e2e-stage1.js` и `…/e2e-stage1-extra.js` (нужны playwright и Chromium); код выхода 0 = всё зелёное. После каждого этапа прогоняй оба набора как регрессию.

## 3. ПЛАН СЛЕДУЮЩЕГО ШАГА (ЭТАП 2: логика `#app`)
Файлы по порядку (раскомментировать строки в index.html по мере готовности):
1. `scripts/i18n.js` — словари RU / EN для всех 121 ключей `data-i18n` (RU берётся из текущей разметки), `I18N.t(key)`, `I18N.apply(root)`, `I18N.set(lang)`, событие `abai:lang`; привязка к `#selLang` и `.seg[data-set=lang]`; перевести строки из auth.js / qr-jury.js.
2. `scripts/store.js` — состояние приложения и шина событий, журнал аудита (запись `PWD_RESET` по `abai:pwdrequest`, вход / выход по `abai:auth`), проверка прав `CAN_*` через `UsersDB.permsOf`, экспорт / импорт резервной копии, (по желанию) сохранение сессии.
3. `scripts/pinn-simulator.js` — симулятор датчиков (температура LWIR, ток / напряжение МЭК 61850, вибрация, питание LTO / ДГУ), законы Кирхгофа, прогноз RUL, сценарии из панели `demo*`.
4. `scripts/obsidian-graph.js` — граф топологии на `#graphCanvas` + `#miniMap`, поиск, фильтры, закрепление узлов, инспектор `#insp`.
5. `scripts/scada-ui.js` — карточки датчиков, фильтры и теги, журнал аудита (период, пользователь, тип, CSV), вкладки прав и плагинов, состояния `tplStates`, модалка отчёта об ошибке.
Правила: запускать циклы только по `abai:auth login`, останавливать по `logout`; не менять контракты `abai:*` и `UsersDB` без необходимости; файлы auth-* / qr-* / frost-* трогать только при баге; в консоли 0 ошибок и 0 404; все новые CSS-переменные добавлять рядом с `--g-*`.
