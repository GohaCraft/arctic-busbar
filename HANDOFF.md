# ARCTIC BUSBAR AI v2.4.0-prod — ПЕРЕДАЧА ЭТАП 2 → ЭТАП 3

Ты — следующий агент в конвейере. Проект: промышленный веб-комплекс предиктивной диагностики болтовых соединений шин подстанций 110–220 кВ (демо InARCTic-2026, ЗГУ Норильск). Владелец — Левицкий А.Р. (пользователь пишет по-русски, часовой пояс Asia/Krasnoyarsk, UTC+7). Работаешь на чистом HTML/CSS/JS без внешних библиотек, шрифтов и картинок: офлайн, открывается двойным кликом по `index.html` (`file://`) или через `python3 -m http.server`. Ответ — на русском, в 4 блока: (1) дерево файлов, (2) полный код тронутых файлов готовыми файлами + архив, (3) `=== ОТЧЁТ ДЛЯ НАС: ЧТО СДЕЛАНО ===` (5–7 пунктов), (4) `=== СООБЩЕНИЕ ДЛЯ СЛЕДУЮЩЕГО АГЕНТА (СКОПИРОВАТЬ В НОВЫЙ ЧАТ) ===`. Файлы не обрезай и не оставляй заглушек вида «остальной код без изменений». Пользователь часто пишет только «continue» — это значит «продолжай по ТЗ, вопросов не задавай».

## 1. СТАТУС И ХВОСТЫ

### Готово на 100 % (проверено Playwright: этап 2 — 196 проверки, этап 1 — 94 + 24; консоль 0 ошибок / 0 предупреждений / 0 HTTP 4xx)
- **Раскладка проекта по отделам**: `styles/auth|app`, `scripts/core|auth|app`, `tests`, `tools/i18n`. Экран `#auth` только перенесён и работает как раньше (визуал и капли — следующий этап).
- **Каркас `#app` (Obsidian + Shadcn + iOS Glass)**: слева Ribbon 48 px (4 раздела, индикатор активного, подсказки; внизу круглая кнопка профиля с аватаром, точкой «онлайн» и бейджем заявок на сброс пароля для админа; одна шестерёнка «Настройки»; быстрый отчёт), сверху Topbar 48 px (название раздела + «PINN Core Online» | стеклянные метрики 110.0 кВ / Ток / Стык °C / RUL / ВВОД | выпадающее меню «Испытания стенда (Demo)» + живые часы UTC+7; ни одного `<select>`), рабочая область на 100 % ширины, Inspector `#insp` 320 px — стеклянный лист справа, выезжает только по клику на карточку датчика или узел графа, закрывается ×, Esc и кликом вне.
- **Телефон ≤ 820 px**: верхняя полоса 44 px, таблицы превращаются в карточки, фиксированный «морозный» нижний Dock (Датчики, Граф, Аудит, Плагины, Настройки), окна и Inspector — нижние шторки; горизонтального переполнения нет (проверено на всех видах, окнах и вкладках).
- **Профиль `#mProfile`, 3 вкладки**: (1) карточка сотрудника + блок «Мои права доступа» (срез RBAC текущего аккаунта, `#pfPerms`) + живой QR и 6-значный PIN на 30 с, привязанные к ТЕКУЩЕМУ аккаунту (`?qr_auth=session&uid=<ID>&code=<PIN>`), старая ссылка жюри `?qr_auth=jury_session` работает, `#btnLogout`; (2) матрица RBAC (4 права × 3 сотрудника, тумблеры админа → `UsersDB.setPerm` + запись в журнал, у жюри замок); (3) заявки на сброс пароля со счётчиком, «Одобрить» (временный пароль + копирование в 1 клик) / «Отклонить».
- **Настройки `#mSettings`, одно окно, 4 раздела**: Интерфейс и тема (Dark Obsidian / Amber Industrial / Light Engineering, акцентный цвет → `--acc`), Язык и регион (6 языков мгновенно, пояс UTC+3/+7/+8/0), Производительность и анимации (анимации и параллакс, частота телеметрии, плавность графа 60 / Eco 30 кадров, показ формул Кирхгофа и Хольма на карточках и графе), База данных и бэкап (экспорт `.json`, восстановление, «Сброс демо» в два клика).
- **6 языков RU / EN / ZH / KK / BE / UK**: 498 ключей, переключение без перезагрузки, включая `#auth`; журнал аудита языконезависим (`{k, p}`) и переводится целиком при смене языка; инициалы аватара на EN/ZH — латиницей.
- **Живая среда**: граф `#graphCanvas` (12 узлов, физика Obsidian, drag / zoom / pan, hover-подсветка с затуханием остальных, импульсы по линиям, панель фильтров, миникарта `#miniMap`, на телефоне в портрете граф сам перестраивается вертикально, подписи не накладываются), 4 живых датчика без нулей (спарклайны, пунктирная уставка, калибровка с RBAC и записью в журнал), 3 испытания стенда (нагрев → авария → АВР на Ввод 2 → остывание; помеха пурги → Kirchhoff Guard; блэкаут → LTO → ДГУ), журнал аудита (предзаполнен, фильтры, сортировка, Rollback, CSV), плагины (9 встроенных, тумблеры, JSON-параметры, редактор своего JS / Python).
- **Тосты, анимации** (смена вкладки 220 мс `cubic-bezier(.22,1,.36,1)`, мягкий пульс карточек вне уставки, `prefers-reduced-motion`, `body.no-animations`), окно «Отчёт для Claude» со stack trace и 5 последними пакетами.
- **Реальные баги, найденные тестами и исправленные**: зависание страницы при ≥ 5 тостах; остаточный нагрев стыка после «нагрев → квитирование → сброс»; метка часового пояса отставала до секунды; «ВВОД 1» в тосте блэкаута вместо LTO; наложение подписей графа на телефоне; зачёркнутая плашка на спарклайне; смешение заголовков RBAC на телефоне.

### Хвосты (не сделано / ограничения, по убыванию важности)
1. **Следующий шаг по ТЗ — финальная полировка визуала `#auth`** (стекло, иней, капли). На экране входа НЕТ собственного переключателя языка: язык выбирается в `#app` → Настройки → «Язык и регион», сохраняется и применяется ко входу. Компактный переключатель на карточке входа — задача следующего этапа.
2. **Скиллы `unslop` и `shadcn` не установлены**: в окружении прошлых чатов у Bash нет сети (pip / npm / git закрыты). Правила из ТЗ применены вручную (§2.3): компонентов `shadcn/ui` нет, токены и компоненты написаны на чистом CSS. Если нужны именно пакеты — разрешите сеть в настройках; изменение действует только в НОВОМ чате.
3. **Переводы KK / BE / UK / ZH написаны агентом, без носителя языка** — нужна выборочная вычитка владельцем. Все 6 колонок заполнены, `build.py --check` — 0 ошибок; горизонтальных переполнений на длинных строках нет (автопроверка), визуально выборочно.
4. **Python-плагины** сохраняются, показываются с меткой PY, но НЕ исполняются (Phase 2: сервер FastAPI). **JS-плагины** исполняются каждый такт, но изоляция — только затенение `window / document / localStorage / sessionStorage / fetch / XMLHttpRequest / Store / UsersDB` параметрами функции: это не песочница безопасности (демо).
5. Демо-данные: пароли в открытом виде, универсальный PIN жюри `261126`. Временные пароли (одобренные заявки, `abai.pass_override`) в бэкап `.json` намеренно НЕ попадают (решение этапа 2).
6. Сессия не переживает F5 (снова экран входа); настройки, уставки, плагины, журнал, заявки и права — переживают (localStorage, при его недоступности — память вкладки).
7. FPS графа на реальной видеокарте не измерен: в headless на CPU порог теста ≥ 28 FPS.
8. Сканер камеры QR работает только там, где есть `BarcodeDetector` (Chrome / Edge / Android); иначе — штатная камера телефона (ссылка → автовход) или ручной ввод 6 цифр.
9. Светлая тема касается `#app`; экран входа всегда тёмный.

## 2. АРХИТЕКТУРА И КОНТРАКТЫ

### 2.1 Дерево проекта
```
arctic-busbar-ai/
├─ index.html                      разметка: #auth, #app (Ribbon, Topbar, 4 вида, Inspector, Dock, окна), SVG-спрайт иконок #i-*, шаблоны, затем скрипты
├─ HANDOFF.md                      это сообщение
├─ styles/auth/auth-glass.css      экран входа: переменные --g-*, сцена, стекло, карточка, поля, кнопки, адаптив
├─ styles/auth/auth-panels.css     меню [?], drawer, вкладки, QR / PIN, OTP, модалка восстановления, камера
├─ styles/app/tokens-shadcn.css    токены 3 тем, типографика, кнопки, тумблеры, бейджи, поля, сегменты, стекло .float, keyframes a-*
├─ styles/app/obsidian-shell.css   сетка #app, Ribbon, Topbar, метрики, меню Demo, аварийная плашка, Inspector, Dock, тосты
├─ styles/app/views-workspace.css  виды: датчики, граф (панель фильтров, миникарта), журнал аудита, плагины; телефонные стек-карточки
├─ styles/app/modals-profile-set.css  менеджер окон, профиль (QR / RBAC / заявки), настройки, калибровка, редактор плагина, отчёт
├─ scripts/core/users-db.js        данные: аккаунты, RBAC, сброс пароля, личные и жюри-PIN (без UI)
├─ scripts/core/i18n.js            СГЕНЕРИРОВАН tools/i18n/build.py (движок + словарь 6 языков) — руками не править
├─ scripts/core/store.js           настройки, уставки, плагины, журнал аудита + Rollback, бэкап, палитра canvas (без DOM-разметки)
├─ scripts/auth/qr-encoder.js      кодировщик QR (ISO 18004, байтовый режим, версии 1–10, ECC L/M/Q/H)
├─ scripts/auth/qr-jury.js         drawer, QR, PIN, ячейки, камера, автовход по ссылке; личные и жюри-сессии
├─ scripts/auth/frost-scene.js     сцена фона #auth
├─ scripts/auth/frost-drops.js     капли
├─ scripts/auth/frost-canvas.js    конвейер слоёв, параллакс, регулятор качества
├─ scripts/auth/auth.js            вход / выход, меню [?], восстановление пароля, часы входа
├─ scripts/app/pinn-simulator.js   физическое ядро (без DOM): ток / напряжение, стык по Хольму, RUL, LTO / ДГУ, АВР, сценарии, плагины
├─ scripts/app/obsidian-graph.js   граф топологии (Canvas 2D)
├─ scripts/app/scada-ui.js         датчики, Inspector, калибровка, аудит, плагины, верхняя панель
├─ scripts/app/app-shell.js        каркас: виды, окна, тосты, часы, Demo-меню, профиль, RBAC, заявки, настройки, отчёт
├─ tools/i18n/dict.psv             ИСТОЧНИК переводов: key|ru|en|zh|kk|be|uk (498 строк)
├─ tools/i18n/i18n.engine.js       шаблон движка (в него build.py вставляет словарь)
├─ tools/i18n/build.py             сборка и проверка словаря → scripts/core/i18n.js
└─ tests/e2e-stage1.js (94) · e2e-stage1-extra.js (24) · e2e-stage2-app.js (196) · out/ (скриншоты и выгрузки, создаётся тестами)
```

### 2.2 Порядок подключения (в index.html важен)
CSS: `auth-glass` → `auth-panels` → `tokens-shadcn` → `obsidian-shell` → `views-workspace` → `modals-profile-set`.
JS: `users-db` → `i18n` → `store` → `qr-encoder` → `qr-jury` → `frost-scene` → `frost-drops` → `frost-canvas` → `auth` → `pinn-simulator` → `obsidian-graph` → `scada-ui` → `app-shell`. Новый файл — добавь в конец своего блока, иначе 404.

### 2.3 Дизайн-система (правила STEP 0, соблюдать)
- Только моно-палитра Zinc / Slate: фон `#090A0F`, поднятые слои `#11131A`, плавающие панели `rgba(18,21,30,.72)` + `backdrop-filter: blur(24px) saturate(180%)`. Стекло ТОЛЬКО на плавающих слоях (`.float`: Inspector, окна, меню, Dock, тосты), не на колонках и карточках.
- Границы — волосяные `1px solid var(--border)` (≈ 7 % белого) + блик `var(--spec)`. Никаких неоновых рамок 2–3 px, грубых пунктирных кнопок, пустых серых коробок.
- Семантические токены по темам: `html[data-theme="dark|amber|light"]` (`--background --foreground --card --muted-foreground --border --acc --ok --warn --err …`); акцент `--acc` задаёт `Store` (`accent: null` = акцент темы). Цвет статуса несёт смысл (ok / warn / err).
- Шрифты — системные стеки (`--font-sans` Inter / SF, `--font-mono` JetBrains Mono), числа `font-variant-numeric: tabular-nums`. Иконки — один SVG-спрайт `#i-*`, линия 1.5 px; базовый размер `:where(#app,#toasts) .ico` с нулевой специфичностью.
- Keyframes приложения имеют префикс `a-`; `body.no-animations` и `prefers-reduced-motion` выключают анимации; глобально `[hidden]{display:none!important}`.
- Раскладка `#app`: fixed-grid. Десктоп: `"rb top" 48px / "rb alarm" auto / "rb main" minmax(0,1fr)`; телефон: `"top" 44px "alarm" "main"` + `#mdock`. `#insp.open` выезжает; `body:has(#insp.open)` сдвигает аварийную плашку и тосты. Окна: `.wnd-wrap[data-open="1"]`, закрытие — любой `[data-close]`, Esc, клик по фону.

### 2.4 Глобальные объекты (контракты не ломать без нужды)
- **`window.UsersDB`**: `authenticate(q, pass)`, `list()`, `find(q)`, `byId(id)`, `juryUser()`, `permsOf(id)`, `setPerm(id, perm, bool)` → `{ok, userId, perm, old, value}` (жюри менять нельзя), `requestReset(q)`, `allRequests()`, `pending()`, `resolve(id, approve, by)` → `{ok, request, tempPassword}`, `remainingMs`, `resetLimit`, `jury.{win,code,left,verify}` (допуск ±1 окно 30 с и универсальный PIN `261126`), `juryLink(code?)`, `session.{code(uid), match(code), link(uid, code?), verify(uid, code)}` (личный PIN / QR ЛЮБОГО аккаунта), `snapshot() / restore() / resetDemo()`. Аккаунты: `1073819 eng.rza / admin123 «Левицкий А.Р.» (admin)`, `1073820 disp.smena / operator123 «Соколов И.В.» (operator)`, `1073821 jury.qr / jury123 «Эксперт Жюри» (jury)`. Права: `CAN_SWITCH_RELAY`, `CAN_EDIT_PINN`, `CAN_ROLLBACK_LOGS`, `CAN_MANAGE_PLUGINS`.
- **`window.I18N`**: `t(key, params, lang?)`, `has(key)`, `set(lang)`, `get()`, `apply(root)`, `dur(minutes)`, `langs`, `names`, `dict`. Разметка: `data-i18n`, `data-i18n-html`, `data-i18n-ph`, `data-i18n-title`, `data-i18n-aria`, `data-i18n-p='{"n":1}'`. Цепочка запасных значений: язык → en → ru → ключ.
- **`window.Store`**: `get/set` настроек `{lang, theme, accent, anim, tz (utc3|utc7|utc8|utc0), tele, fps, fx}`; `thr.{all,get,set,fmt,reset}` — уставки `T_max 85 °C`, `I_max 1250 A`, `A_max 0.8 g`, `U_min 198 V`; `plugins.{list,get,enabled,setOn,setParams,add,remove}`; `audit.{list,count,find,registerUndo,rollback,csv}`; `log({cat,k,p,node,old,nw,undo,sys})`; `backup.{data,export,import,resetDemo}`; `fmtClock/fmtDT/toInput/fromInput/tzLabel`, `palette()` для canvas.
- **`window.PINN`**: `state()`, `series(name)` → `{t, v, r}` (`temp|cur|acc|vdc|rk|volt`), `packets()`, `flows()`, `alarmNode`, `pluginErrors()`, `start/stop/isRunning`, `ack()`, `reset()`, `scenario('heat'|'spoof'|'blackout'|'reset')`, `act('transfer'|'return'|'dgu.start'|'dgu.stop')`, `rulOf(rk)`, `C`, `TOPO`. Ключи состояния: `T Tt Traw Rk F I U S freq acc vdc soc ltoT rul ltoState dgu in1 in2 ats src alarm guard spoofSeen scenario scenT h hT status`. Работает только между входом и выходом.
- **`window.ObsidianGraph`**: `init/start/stop/resize/fit/focus/select/setPinned/nodes/edges/byId/hover/selected/camera/isRunning/stats/onSelect/onBackground`. Узлы: `in1 in2 ats bus1 bus2 joint core dgu lto s_cur s_ir s_vib`.
- **`window.ScadaUI`**: `init/setView/renderGrid/renderAudit/renderPlugins/inspect/closeInspector/inspectorTarget/openCalibration/openPluginEditor/auditFilter/evText/whoName/tok/can/stats/start/stop/ackAlarm/rollback/fio`.
- **`window.AppShell`**: `show(view)`, `view()`, `openWnd(id, focusEl?)`, `closeWnd(id)`, `closeAll`, `toast(kind, title, text)`, `inspect`, `open('profile'|'settings'|'crash')`, `openProfile(tab)`, `openSettings`, `refreshAccess`, `renderRequests`, `renderRbac`, `copy`, `state()`.
- **`window.AuthApp`** `{user, isAuthed, logout, login, shake, profile, clock}`; **`QRJury`**, **`QREncoder`**, **`FrostCanvas`** — как в этапе 1.

### 2.5 События `window` (`e.detail`)
`abai:auth {type:'login'|'logout', user, via}` · `abai:jury-ok / abai:jury-fail {via}` · `abai:session-ok {user, via}` (личный вход с телефона) · `abai:pwdrequest / abai:pwdresolved` · `abai:settings {key,value}` · `abai:lang {lang}` · `abai:thresholds {key,value,old}` · `abai:plugins {id,…}` · `abai:audit {entry}` · `abai:restored` · `abai:sim` (каждый такт) · `abai:alarm` · `abai:ats` · `abai:dgu` · `abai:scenario` · `abai:spoof` · `abai:plugin-alarm {id,note}` · `abai:plugin-error {id,message}`.

### 2.6 DOM-контракт (id и data-хуки, на которые опираются тесты)
Каркас: `app ribbon rbNav rbInd btnProfile rbAva btnSettings btnCrash top secTitle coreStatus metrics tU tI tT tRul tSrc btnDemo demoMenu demoHeat demoSpoof demoBlackout demoReset tClock tzLabel alarm alarmAck main mdock btnProfileM btnDemoM mAva insp inspTitle inspClose inspBody toasts`. Виды: `view-grid (gridSearch gridTags sensorGrid)`, `view-graph (gWrap graphCanvas gPanel gSearch gShowS gShowR gShowF gRep gLen gFlow gFit gPin miniMap gTip)`, `view-audit (auditPeriod auditUser auditType auditCsv auditTable auditBody)`, `view-plugins (btnAddPlugin plCount plugList)`. Окна: `mProfile (empName empId empRole pfPerms pfQr pfPin pfLink btnLogout rbMatrix pwdTable pfReqCount; вкладки .wnd-tab[data-tab="id|rbac|req"])`, `mSettings (themeGrid accRow inpAccent chkFx langGrid segTz chkAnim segTele segFps btnBackup btnRestore fileRestore btnResetDemo dbStat; разделы .st-nav button[data-cat="ui|lang|perf|db"])`, `mCalib`, `mPlugin (plName plLang plParams plCode plErr plSave)`, `mCrash`. Хуки: карточка датчика `[data-sid]` + `data-st="ok|warn|err"`; строка плагина `.pl-row[data-id][data-on]`, кнопки `data-pl-on / data-pl-cfg / data-pl-del`; тумблер RBAC `input[data-rbac="PERM"][data-uid]`; тумблеры — `label.sw` со скрытым checkbox; «Сброс демо» взводится первым кликом (`data-arm="1"`, 3.5 с) и выполняется вторым.

### 2.7 Контракт пользовательского JS-плагина
Тело функции; на входе `plugin = {packet:{temp,cur,volt,vib,vdc}, params, state:{src,ats,scenario}}`, на выходе `{alarm: boolean, note?: string}`. Первый `alarm:true` пишет в журнал `ev.plugin.alarm`; исключение — `ev.plugin.error` и красная метка в строке. Код проверяется при сохранении (`new Function`).

### 2.8 Журнал аудита и Rollback
Запись: `{id:'TX-104xxx', ts, userId, user, role, cat, k, p, node, old, nw, undo, rb}`. `cat`: `AUTH PWD_RESET RBAC RELAY PINN THRESHOLD PLUGIN CONFIG ROLLBACK`. Текст события — `I18N.t(k, p)` при отрисовке (отсюда мгновенная смена языка). Откат: `undo = {kind, data}`, обработчик регистрируется `Store.audit.registerUndo(kind, fn)` (виды `setpoint node plugin pluginParams rbac sensor`); нужен `CAN_ROLLBACK_LOGS`; откат пишет `ROLLBACK`, а исходная запись получает `rb:true`. Лимит 500 записей.

### 2.9 i18n: как добавить или изменить текст
1. Правь `tools/i18n/dict.psv` (строка `ключ|ru|en|zh|kk|be|uk`, все 6 колонок обязательны; `|` внутри текста нельзя).
2. `python3 tools/i18n/build.py` — валидирует (пустые колонки, лишние и отсутствующие ключи, плейсхолдеры `{n}`) и пересобирает `scripts/core/i18n.js`; `--check` только проверяет.
3. В коде `T('ключ', {n: 1})`, в разметке `data-i18n="ключ"`. Динамический текст перерисовывай по `abai:lang`. Не вшивай русский текст в JS.

### 2.10 Как тестировать
Сервер: `cd` в корень проекта, `python3 -m http.server 8765 --bind 127.0.0.1` (если `curl http://127.0.0.1:8765/index.html` не даёт 200 — перезапусти). Прогон: `NODE_PATH=$(npm root -g) node tests/e2e-stage2-app.js` (≈ 6–8 мин) и `tests/e2e-stage1.js`, `tests/e2e-stage1-extra.js`; код выхода 0 = всё зелёное. Выборочно: `ABAI_ONLY=6,7 … node tests/e2e-stage2-app.js` (номера блоков 1–16). Блок 16 — чистота консоли и сети за весь прогон. Хелперы: `ok() section() fresh() loginAs() openProfile() logout() auditTop() waitFor() nodePos()`. Playwright + Chromium уже установлены; `deviceScaleFactor: 2` для скриншотов, которые смотрит человек.

## 3. ПЛАН СЛЕДУЮЩЕГО ШАГА (ЭТАП 3: финальная полировка `#auth`)
1. **Визуал `#auth`**: довести стеклянную карточку, иней по краям, конденсат и капли (физика, чистые следы, поведение на телефоне) до уровня `#app`; правила STEP 0 (никакого AI-slop) действуют и здесь. Файлы: `styles/auth/*`, `scripts/auth/frost-*.js`, при необходимости `index.html` (только блок `#auth`).
2. **Переключатель языка на экране входа** (компактный, 6 языков, без `<select>`, через `Store.set('lang', …)`), проверить длинные строки ZH / KK / BE / UK на карточке и в drawer.
3. Выборочная вычитка переводов владельцем (хвост 3); при желании — реальные пакеты `unslop` / `shadcn`, если в новом чате включена сеть (хвост 2).
4. Регрессия: все три набора тестов зелёные (94 + 24 + 196, при изменении числа проверок обнови цифры здесь), консоль 0 ошибок / 0 предупреждений / 0 404. Контракты `abai:*`, `UsersDB`, `Store`, `I18N` и DOM-хуки из §2.6 не менять без нужды; `#app` трогать только при баге.
5. Обнови этот файл и выдай ответ в 4 блока.
