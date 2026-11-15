/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/users-db.js
   Аккаунты + RBAC + сброс пароля (1 запрос / 24 ч) + QR и 6-значный код жюри + 3D-фон с пружинной физикой + рабочий вход.
   Подключается ПЕРЕД остальными скриптами. Демо-данные; в Phase 2 пароли заменяются bcrypt-хешами FastAPI. */
(function (g) {
'use strict';

/* ---------- настройки предприятия ---------- */
const ENTERPRISE_ADMIN_EMAIL = "security-rza@nornickel-arctic.ru";
const MAIL_TEMPLATE = { subject: "ARCTIC BUSBAR AI: запрос на смену пароля", body: "Здравствуйте, {who} забыл пароль, измените пароль." };
const RESET_LIMIT_MS = 864e5;                                   // 24 часа
const JURY_QR_URL = "http://192.168.4.1:8000/?qr_auth=jury_session";
const JURY_SECRET = "ARCTIC-JURY-2026", JURY_UNIVERSAL_PIN = "261126", CODE_WINDOW_MS = 3e4;
const K = { last: "abai.pwd_last", req: "abai.pwd_requests", pass: "abai.pass_override", perms: "abai.perms_override", dev: "abai.jury_devices" };
const PERMS = ["CAN_SWITCH_RELAY", "CAN_EDIT_PINN", "CAN_ROLLBACK_LOGS", "CAN_MANAGE_PLUGINS"];
const none = { CAN_SWITCH_RELAY: false, CAN_EDIT_PINN: false, CAN_ROLLBACK_LOGS: false, CAN_MANAGE_PLUGINS: false };
const USERS = [
  { id: "1073819", login: "eng.rza", code: "1073819", fio: "Левицкий А.Р.", pass: "admin123", role: "admin", roleLabel: "Главный Инженер РЗА (Admin)",
    perms: { CAN_SWITCH_RELAY: true, CAN_EDIT_PINN: true, CAN_ROLLBACK_LOGS: true, CAN_MANAGE_PLUGINS: true } },
  { id: "1073820", login: "disp.smena", code: "1073820", fio: "Соколов И.В.", pass: "operator123", role: "operator", roleLabel: "Диспетчер смены (Operator)", perms: none },
  { id: "1073821", login: "jury.qr", code: "1073821", fio: "Эксперт Жюри", pass: "jury123", role: "jury", roleLabel: "Эксперт Жюри (Observer)", perms: none }
];

/* ---------- хранилище ---------- */
const load = (k, d) => { try { const v = g.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const save = (k, v) => { try { g.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage недоступен */ } };

/* ---------- поиск, вход, RBAC ---------- */
const norm = s => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[^a-z0-9а-я]/g, "");
function find(q) {
  const n = norm(q); if (!n) return null;
  return USERS.find(u => norm(u.login) === n || norm(u.code) === n || norm(u.fio) === n || (n.length >= 5 && norm(u.fio).startsWith(n))) || null;
}
const passOf = u => load(K.pass, {})[u.id] || u.pass;
const permsOf = u => Object.assign({}, u.perms, load(K.perms, {})[u.id] || {});
const pub = u => ({ id: u.id, login: u.login, code: u.code, fio: u.fio, role: u.role, roleLabel: u.roleLabel, perms: permsOf(u) });
function authenticate(query, password) {
  const u = find(query);
  if (!u) return { ok: false, reason: "NO_USER" };
  if (String(password) !== passOf(u)) return { ok: false, reason: "BAD_PASS", userId: u.id };
  return { ok: true, user: pub(u) };
}
function setPerm(userId, perm, value) {
  const u = USERS.find(x => x.id === userId);
  if (!u || PERMS.indexOf(perm) < 0 || u.role === "jury") return { ok: false };
  const all = load(K.perms, {}), old = permsOf(u)[perm];
  all[userId] = Object.assign(all[userId] || {}, { [perm]: !!value }); save(K.perms, all);
  return { ok: true, userId, perm, old, value: !!value };
}

/* ---------- сброс пароля: 1 раз в 24 часа на аккаунт ---------- */
const fmtLeft = ms => { const m = Math.max(1, Math.ceil(ms / 6e4)); return Math.floor(m / 60) + " ч. " + (m % 60) + " мин."; };
const leftMs = id => { const l = load(K.last, {})[id] || 0; return l ? Math.max(0, RESET_LIMIT_MS - (Date.now() - l)) : 0; };
function requestReset(query) {
  const u = find(query);
  if (!u) return { ok: false, reason: "NO_USER", text: "Сотрудник не найден. Проверьте логин, табельный код или ФИО." };
  const left = leftMs(u.id);
  if (left > 0) return { ok: false, reason: "LIMIT", remainingMs: left, text: "Запрос на смену пароля для этого аккаунта уже отправлялся. Повторный запрос возможен через " + fmtLeft(left) + "." };
  const ts = Date.now(), body = MAIL_TEMPLATE.body.replace("{who}", u.fio || u.code);
  const mailto = "mailto:" + ENTERPRISE_ADMIN_EMAIL + "?subject=" + encodeURIComponent(MAIL_TEMPLATE.subject) + "&body=" + encodeURIComponent(body);
  const req = { id: "PW-" + ts.toString(36).toUpperCase(), ts, userId: u.id, login: u.login, code: u.code, fio: u.fio, text: body, to: ENTERPRISE_ADMIN_EMAIL, status: "PENDING" };
  const last = load(K.last, {}); last[u.id] = ts; save(K.last, last);
  const list = load(K.req, []); list.push(req); save(K.req, list);
  g.dispatchEvent(new CustomEvent("abai:pwdrequest", { detail: req }));   // store.js пишет PWD_RESET в журнал аудита
  return { ok: true, request: req, to: ENTERPRISE_ADMIN_EMAIL, subject: MAIL_TEMPLATE.subject, body, mailto };
}
const allRequests = () => load(K.req, []);
const pending = () => allRequests().filter(r => r.status === "PENDING");
function resolve(id, approve, by) {
  const list = allRequests(), r = list.find(x => x.id === id && x.status === "PENDING");
  if (!r) return { ok: false };
  r.status = approve ? "APPROVED" : "REJECTED"; r.by = by || ""; r.resolvedTs = Date.now();
  let tmp = null;
  if (approve) { tmp = "Tmp-" + Math.random().toString(36).slice(2, 8); const o = load(K.pass, {}); o[r.userId] = tmp; save(K.pass, o); }
  save(K.req, list);
  g.dispatchEvent(new CustomEvent("abai:pwdresolved", { detail: { request: r, tempPassword: tmp } }));
  return { ok: true, request: r, tempPassword: tmp };
}

/* ---------- код жюри: 6 цифр, окно 30 с (+ универсальный пин) ---------- */
const h32 = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 13; h = Math.imul(h, 1540483477); h ^= h >>> 15; return h >>> 0; };
const win = () => Math.floor(Date.now() / CODE_WINDOW_MS);
const codeAt = w => String(h32(JURY_SECRET + ":" + w) % 1e6).padStart(6, "0");
const jury = { win, code: () => codeAt(win()), left: () => 1 - (Date.now() % CODE_WINDOW_MS) / CODE_WINDOW_MS,
  verify: c => { c = String(c || ""); return c === JURY_UNIVERSAL_PIN || c === codeAt(win()) || c === codeAt(win() - 1); } };
const devices = () => load(K.dev, 0);
const countDevice = () => save(K.dev, devices() + 1);

/* ---------- QR: версия 4 (33×33), коррекция M, байтовый режим, ≤ 62 символов ---------- */
const QR = (() => {
  const S = 33, DC = 64, EC = 18;
  const MK = [(x, y) => (x + y) % 2 == 0, (x, y) => y % 2 == 0, (x, y) => x % 3 == 0, (x, y) => (x + y) % 3 == 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 == 0, (x, y) => x * y % 2 + x * y % 3 == 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 == 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 == 0];
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 285); z ^= ((y >>> i) & 1) * x; } return z; };
  const rs = d => {
    const v = Array(EC - 1).fill(0).concat(1); let r = 1;
    for (let i = 0; i < EC; i++) { for (let j = 0; j < v.length; j++) { v[j] = mul(v[j], r); if (j + 1 < v.length) v[j] ^= v[j + 1]; } r = mul(r, 2); }
    const o = Array(EC).fill(0);
    d.forEach(b => { const f = b ^ o.shift(); o.push(0); v.forEach((c, i) => o[i] ^= mul(c, f)); });
    return o;
  };
  const pen = m => {
    let p = 0;
    for (let a = 0; a < 2; a++) for (let i = 0; i < S; i++) { let n = 1;
      for (let j = 1; j < S; j++) { const c = a ? m[j][i] : m[i][j], q = a ? m[j - 1][i] : m[i][j - 1]; if (c === q) { n++; if (n == 5) p += 3; else if (n > 5) p++; } else n = 1; } }
    return p;
  };
  return text => {
    const d = [...text].map(c => c.charCodeAt(0) & 255);
    if (d.length > 62) throw new Error("QR: слишком длинная строка");
    const b = [], p = (v, n) => { for (let i = n - 1; i >= 0; i--) b.push((v >>> i) & 1); };
    p(4, 4); p(d.length, 8); d.forEach(x => p(x, 8)); p(0, Math.min(4, DC * 8 - b.length)); while (b.length % 8) b.push(0);
    const cw = []; for (let i = 0; i < b.length; i += 8) cw.push(parseInt(b.slice(i, i + 8).join(""), 2));
    for (let x = 236; cw.length < DC; x ^= 253) cw.push(x);
    const bl = [cw.slice(0, 32), cw.slice(32)], ec = bl.map(rs), all = [];
    for (let i = 0; i < 32; i++) bl.forEach(x => all.push(x[i]));
    for (let i = 0; i < EC; i++) ec.forEach(x => all.push(x[i]));
    let m = Array.from({ length: S }, () => Array(S).fill(0)); const f = m.map(r => r.slice());
    const set = (x, y, v) => { m[y][x] = +v; f[y][x] = 1; };
    const fmt = k => {                                              // формат: ECC M (00) + маска, BCH(15,5)
      let r = k; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const bits = (k << 10 | r) ^ 0x5412, g1 = i => (bits >>> i) & 1;
      for (let i = 0; i <= 5; i++) set(8, i, g1(i)); set(8, 7, g1(6)); set(8, 8, g1(7)); set(7, 8, g1(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, g1(i));
      for (let i = 0; i < 8; i++) set(S - 1 - i, 8, g1(i));
      for (let i = 8; i < 15; i++) set(8, S - 15 + i, g1(i));
      set(8, S - 8, 1);
    };
    for (let i = 0; i < S; i++) { set(6, i, i % 2 == 0); set(i, 6, i % 2 == 0); }              // тайминг-паттерн
    [[3, 3], [S - 4, 3], [3, S - 4]].forEach(([cx, cy]) => {                                      // позиционные квадраты
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, r = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < S && y >= 0 && y < S) set(x, y, r != 2 && r != 4);
      }
    });
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(26 + dx, 26 + dy, Math.max(Math.abs(dx), Math.abs(dy)) != 1); // выравнивающий
    fmt(0);
    let i = 0;
    for (let r = S - 1; r >= 1; r -= 2) {
      if (r == 6) r = 5;
      for (let v = 0; v < S; v++) for (let j = 0; j < 2; j++) {
        const x = r - j, y = ((r + 1) & 2) == 0 ? S - 1 - v : v;
        if (!f[y][x] && i < all.length * 8) { m[y][x] = (all[i >>> 3] >>> (7 - (i & 7))) & 1; i++; }
      }
    }
    const base = m; let best, bp = 1e9;
    for (let k = 0; k < 8; k++) {
      m = base.map(r => r.slice());
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (!f[y][x] && MK[k](x, y)) m[y][x] ^= 1;
      fmt(k); const s = pen(m); if (s < bp) { bp = s; best = m; }
    }
    return best;
  };
})();
function drawQR(cv, text) {
  const q = QR(text), S = q.length, c = cv.getContext("2d"), w = cv.width, mp = Math.floor(w / (S + 8)), o = (w - S * mp) >> 1;
  c.fillStyle = "#fff"; c.fillRect(0, 0, w, w); c.fillStyle = "#07090D";
  q.forEach((r, y) => r.forEach((v, x) => { if (v) c.fillRect(o + x * mp, o + y * mp, mp, mp); }));
  const L = o + 15 * mp, cx = L + 1.5 * mp, cy = cx;                                              // логотип 3×3 модуля в центре
  c.fillStyle = "#fff"; c.fillRect(L, L, 3 * mp, 3 * mp);
  c.fillStyle = "#0284C7"; c.beginPath();
  [[2, -7], [-4, 1], [0, 1], [-2, 7], [4, -1], [0, -1]].forEach(([x, y], n) => n ? c.lineTo(cx + x, cy + y) : c.moveTo(cx + x, cy + y));
  c.closePath(); c.fill();
}

/* ---------- публичный API ---------- */
g.UsersDB = { ENTERPRISE_ADMIN_EMAIL, MAIL_TEMPLATE, RESET_LIMIT_MS, JURY_QR_URL, PERMS, jury, devices, countDevice, drawQR,
  list: () => USERS.map(pub), find: q => { const u = find(q); return u ? pub(u) : null; },
  juryUser: () => pub(USERS.find(u => u.role === "jury")), authenticate,
  permsOf: id => { const u = USERS.find(x => x.id === id); return u ? permsOf(u) : null; }, setPerm,
  remainingMs: leftMs, formatRemaining: fmtLeft, requestReset, pending, allRequests, resolve };

/* ================== UI-КОНТРОЛЛЕР ================== */
function run() {
const $ = i => document.getElementById(i), qa = (s, r) => [...(r || document).querySelectorAll(s)], B = document.body;
const TZ = { utc3: 3, utc7: 7, utc8: 8, utc0: 0 }, card = $("card"), dock = document.querySelector(".dock");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let me = null, t0 = 0;

/* --- 60 FPS canvas-фон: перспективная сетка, узлы, импульсы, маска-прожектор, пружина Гука --- */
const bg = (() => {
  const cv = $("bgCanvas"), c = cv.getContext("2d"), of = document.createElement("canvas"), o = of.getContext("2d"), mk = document.createElement("canvas"), m = mk.getContext("2d");
  const KS = 0.08, DM = 0.82, still0 = g.matchMedia("(prefers-reduced-motion: reduce)");
  const L = [0.3, 0.65, 1].map(d => ({ d, x: 0, y: 0, vx: 0, vy: 0 })), cd = { x: 0, y: 0, vx: 0, vy: 0 };
  const N = [[.12, .30, 0, "110kV"], [.28, .62, 1, ""], [.20, .82, 2, "LTO-55C"], [.42, .22, 1, ""], [.58, .16, 0, "PINN-CORE"], [.72, .34, 2, ""],
    [.86, .26, 1, "MLX-IR"], [.90, .70, 0, ""], [.70, .84, 1, ""], [.48, .78, 2, ""], [.06, .58, 1, ""], [.34, .42, 2, ""]];
  const E = [[0, 1], [1, 2], [0, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 2], [3, 11], [11, 1], [5, 8], [10, 1], [10, 0], [4, 6]];
  const P = Array.from({ length: 20 }, (_, i) => ({ e: i % E.length, t: Math.random(), s: .004 + Math.random() * .004 }));
  let W = 0, H = 0, dpr = 1, raf = 0, last = 0, mx = 0, my = 0, cx = -1, cy = -1, still = false;
  const frozen = () => B.classList.contains("no-animations") || still0.matches;
  const imp = v => Math.max(-8, Math.min(8, v * 0.1));
  const kickL = (dx, dy) => L.forEach(l => { l.vx += imp(dx) * (.3 + .5 * l.d); l.vy += imp(dy) * (.3 + .5 * l.d); });
  const size = () => {
    dpr = Math.min(g.devicePixelRatio || 1, 1.5); W = g.innerWidth; H = g.innerHeight;
    [cv, of].forEach(k => { k.width = W * dpr; k.height = H * dpr; });
    c.setTransform(dpr, 0, 0, dpr, 0, 0); o.setTransform(dpr, 0, 0, dpr, 0, 0);
    mk.width = Math.ceil(W / 4); mk.height = Math.ceil(H / 4); still = false;
  };
  const spot = (x, y, r, a) => {
    const s = mk.width / W, gr = m.createRadialGradient(x * s, y * s, 0, x * s, y * s, r * s);
    gr.addColorStop(0, "rgba(0,0,0," + a + ")"); gr.addColorStop(1, "rgba(0,0,0,0)"); m.fillStyle = gr; m.fillRect(0, 0, mk.width, mk.height);
  };
  const seg = (x0, y0, x1, y1) => { o.beginPath(); o.moveTo(x0, y0); o.lineTo(x1, y1); o.stroke(); };
  function draw(t) {
    o.clearRect(0, 0, W, H);
    const gx = W / 2 + L[0].x * .8, gy = H * .42 + L[0].y * .4;                                  // перспективный пол
    o.lineWidth = 1; o.strokeStyle = "rgba(110,150,200,.6)"; o.beginPath();
    for (let i = -12; i <= 12; i++) { o.moveTo(gx, gy); o.lineTo(gx + i * W / 9, H); }
    for (let k = 1; k <= 14; k++) { const y = gy + (H - gy) * Math.pow(k / 14, 2.3); o.moveTo(0, y); o.lineTo(W, y); }
    o.stroke();
    const pos = N.map(n => [n[0] * W + L[n[2]].x + Math.sin(t / 1800 + n[0] * 9) * 5, n[1] * H + L[n[2]].y + Math.cos(t / 2100 + n[1] * 9) * 5]);
    o.strokeStyle = "rgba(120,165,215,.55)"; o.beginPath();
    E.forEach(([a, b]) => { o.moveTo(pos[a][0], pos[a][1]); o.lineTo(pos[b][0], pos[b][1]); }); o.stroke();
    P.forEach(p => {                                                                              // световые импульсы
      if (!frozen()) p.t += p.s;
      if (p.t > 1) { p.t = 0; p.e = (Math.random() * E.length) | 0; }
      const A = pos[E[p.e][0]], Z = pos[E[p.e][1]], t1 = p.t, t0 = Math.max(0, t1 - .09);
      const x1 = A[0] + (Z[0] - A[0]) * t1, y1 = A[1] + (Z[1] - A[1]) * t1, x0 = A[0] + (Z[0] - A[0]) * t0, y0 = A[1] + (Z[1] - A[1]) * t0;
      o.lineCap = "round"; o.lineWidth = 5; o.strokeStyle = "rgba(56,189,248,.35)"; seg(x0, y0, x1, y1);
      o.lineWidth = 1.6; o.strokeStyle = "#7DD3FC"; seg(x0, y0, x1, y1);
    });
    o.font = "10px JetBrains Mono,Consolas,monospace"; o.lineWidth = 1.2;
    N.forEach((n, i) => {
      const [x, y] = pos[i]; o.fillStyle = "#0B1220"; o.strokeStyle = "#38BDF8"; o.beginPath(); o.rect(x - 4, y - 4, 8, 8); o.fill(); o.stroke();
      if (n[3]) { o.fillStyle = "rgba(190,215,245,.95)"; o.fillText(n[3], x + 9, y + 3); }
    });
    const bgr = c.createRadialGradient(W / 2, H * .42, 0, W / 2, H * .42, H * .85); bgr.addColorStop(0, "#0E1626"); bgr.addColorStop(1, "#06080C");
    c.fillStyle = bgr; c.fillRect(0, 0, W, H);
    c.globalAlpha = .13; c.drawImage(of, 0, 0, W, H); c.globalAlpha = 1;                         // тусклый базовый слой
    m.clearRect(0, 0, mk.width, mk.height);                                                       // маска-прожектор: карточка + курсор
    const cr = card.getBoundingClientRect(); spot(cr.left + cr.width / 2, cr.top + cr.height / 2, Math.max(W, H) * .34, .85); if (cx >= 0) spot(cx, cy, 260, 1);
    o.globalCompositeOperation = "destination-in"; o.drawImage(mk, 0, 0, W, H); o.globalCompositeOperation = "source-over";
    c.drawImage(of, 0, 0, W, H);
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (frozen()) { dock.style.transform = ""; if (still) return; still = true; }
    else {
      still = false; const n = Math.min(3, Math.max(1, Math.round((t - last) / 16.7)));
      for (let s = 0; s < n; s++) {                                                               // F = -k·x, затухание 0.82
        L.forEach(l => { l.vx = (l.vx + (-mx * 34 * l.d - l.x) * KS) * DM; l.vy = (l.vy + (-my * 22 * l.d - l.y) * KS) * DM; l.x += l.vx; l.y += l.vy; });
        cd.vx = (cd.vx + (mx * 6 - cd.x) * KS) * DM; cd.vy = (cd.vy + (my * 4 - cd.y) * KS) * DM; cd.x += cd.vx; cd.y += cd.vy;
      }
      dock.style.transform = "translate3d(" + cd.x.toFixed(2) + "px," + cd.y.toFixed(2) + "px,0)";
    }
    last = t; draw(t);
  }
  g.addEventListener("resize", size); size();
  g.addEventListener("pointermove", e => {
    mx = e.clientX / W * 2 - 1; my = e.clientY / H * 2 - 1; cx = e.clientX; cy = e.clientY;
    if (Math.hypot(e.movementX || 0, e.movementY || 0) > 40) kickL(e.movementX, e.movementY);     // резкий рывок мыши
  });
  g.addEventListener("pointerdown", () => { if (g.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === "function") DeviceMotionEvent.requestPermission().catch(() => {}); }, { once: true });
  let pa = null;
  g.addEventListener("devicemotion", e => {                                                       // тряска смартфона
    const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
    if (pa) { const dx = a.x - pa.x, dy = a.y - pa.y; if (Math.abs(dx) + Math.abs(dy) > 9) kickL(dx * 8, -dy * 8); }
    pa = { x: a.x, y: a.y };
  });
  return { start() { if (!raf) raf = requestAnimationFrame(frame); }, stop() { cancelAnimationFrame(raf); raf = 0; },
    kick(dx) { cd.vx += dx; kickL(dx * 10, 0); } };
})();
bg.start();

/* --- часы, профиль, вход --- */
const tzv = () => $("selTz").value, clock = z => new Date(Date.now() + TZ[z] * 36e5).toISOString().slice(11, 19);
const prof = () => { const v = (qa(".view.on")[0] || {}).id; return [me.id, $("selLang").value, document.documentElement.dataset.theme, v === "view-graph" ? "graph" : "grid", tzv(), $("chkAnim").checked ? "anim1" : "anim0"].join("_"); };
const cfg = () => { if (me) $("cfgString").textContent = prof(); };
const tick = () => {
  $("authClock").textContent = "UTC+7 " + clock("utc7");
  if (!me) return;
  const z = tzv(); $("tClock").textContent = clock(z); $("tzLabel").textContent = "UTC" + (TZ[z] >= 0 ? "+" : "") + TZ[z];
  const s = Math.floor((Date.now() - t0) / 1e3); $("empSess").textContent = [s / 3600, s / 60 % 60, s % 60].map(v => String(Math.floor(v)).padStart(2, "0")).join(":");
};
setInterval(tick, 1000); tick();

function fail(text, el) {
  const m = el || $("authMsg"); m.textContent = text; m.className = "msg err"; m.hidden = false;
  card.classList.add("err"); setTimeout(() => card.classList.remove("err"), 700); bg.kick(4);
}
function fill() {
  $("empName").textContent = me.fio; $("empId").textContent = me.id; $("empRole").textContent = me.roleLabel;
  $("empAva").textContent = me.fio.split(/[\s.]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join("").toUpperCase();
  B.dataset.role = me.role; qa("[data-perm=admin]").forEach(b => { b.hidden = me.role !== "admin"; });
  show(me.role === "admin" ? "grid" : "grid"); renderPwd(); cfg();
}
function grant(u) {
  if (me) return; me = u; t0 = Date.now();
  $("grantMsg").textContent = "// ЗАГРУЗКА ПРОФИЛЯ " + prof(); $("grant").hidden = false;
  setTimeout(() => { B.classList.remove("locked"); $("grant").hidden = true; bg.stop(); fill(); tick(); }, 1300);
}
$("loginForm").addEventListener("submit", e => {
  e.preventDefault();
  const r = UsersDB.authenticate($("loginUser").value.trim(), $("loginPass").value);
  if (r.ok) return grant(r.user);
  fail(r.reason === "NO_USER" ? "Сотрудник не найден. Проверьте логин, табельный код или ФИО." : "Неверный пароль. Проверьте раскладку и Caps Lock.");
});
$("btnLogout").onclick = () => {
  me = null; B.classList.add("locked"); $("loginPass").value = ""; $("authMsg").hidden = true; $("qrToggle").checked = false; $("rcvToggle").checked = false; bg.start(); $("loginUser").focus();
};
$("eyeBtn").onclick = () => { const i = $("loginPass"), s = i.type === "password"; i.type = s ? "text" : "password"; $("eyeBtn").setAttribute("aria-pressed", s); };

/* --- шпаргалка [?] с автозаполнением --- */
const pop = $("acctPop"), hb = $("helpBtn");
hb.onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; hb.setAttribute("aria-expanded", !pop.hidden); };
pop.onclick = e => {
  const a = e.target.closest(".acct"); if (!a) return;
  $("loginUser").value = a.dataset.u; $("loginPass").value = a.dataset.p; pop.hidden = true; hb.setAttribute("aria-expanded", "false"); qa(".go", $("loginForm"))[0].focus();
};
document.addEventListener("click", e => { if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true; });
document.addEventListener("keydown", e => { if (e.key === "Escape") { pop.hidden = true; $("qrToggle").checked = false; } });

/* --- «Забыли пароль?»: 1 запрос / 24 ч, письмо, заявка в таблицу администратора --- */
const tmpMap = {};
function renderPwd() {
  const L = UsersDB.allRequests().slice().reverse(), z = TZ[tzv()];
  $("pwdBody").innerHTML = L.map(r => "<tr><td>" + r.id + "</td><td>" + new Date(r.ts + z * 36e5).toISOString().replace("T", " ").slice(0, 19) + "</td><td>" + esc(r.fio) + "</td><td>" + r.code + "</td><td>" + esc(r.text) + "</td><td>" + r.status + (tmpMap[r.id] ? " · " + tmpMap[r.id] : "") + "</td><td>" +
    (r.status === "PENDING" ? '<button class="btn primary" data-res="1" data-id="' + r.id + '">Одобрить</button> <button class="btn" data-res="0" data-id="' + r.id + '">Отклонить</button>' : "—") + "</td></tr>").join("");
  const n = UsersDB.pending().length; $("cPwd").textContent = n; $("cPwd").classList.toggle("hot", n > 0);
}
$("pwdBody").onclick = e => {
  const a = e.target.closest("[data-res]"); if (!a) return;
  const r = UsersDB.resolve(a.dataset.id, a.dataset.res === "1", me && me.fio); if (r.tempPassword) tmpMap[a.dataset.id] = r.tempPassword; renderPwd();
};
$("rcvForm").addEventListener("submit", e => {
  e.preventDefault(); const m = $("rcvMsg"), r = UsersDB.requestReset($("rcvUser").value); $("rcvSent").hidden = true;
  if (!r.ok) return fail(r.text, m);
  m.hidden = true; $("sentTo").textContent = r.to; $("sentSubj").textContent = r.subject; $("sentBody").textContent = r.body; $("sentMailto").href = r.mailto; $("rcvSent").hidden = false; renderPwd();
});

/* --- QR + 6-значный код: обновление каждые 30 с --- */
let qw = -1;
function qrTick() {
  const w = UsersDB.jury.win();
  if (w !== qw) {
    qw = w; const code = UsersDB.jury.code(), url = JURY_QR_URL + "&code=" + code;
    qa("[data-qr]").forEach(cv => drawQR(cv, url)); qa("[data-qr-url]").forEach(x => { x.textContent = url; });
    qa("[data-code]").forEach(bx => qa("b", bx).forEach((b, i) => { b.textContent = code[i]; }));
  }
  qa("[data-qr-timer]").forEach(i => { i.style.transform = "scaleX(" + UsersDB.jury.left().toFixed(3) + ")"; });
  qa("[data-qr-devices]").forEach(x => { x.textContent = UsersDB.devices(); });
}
setInterval(() => { if ($("qrToggle").checked || !$("mQr").hidden) qrTick(); }, 250); qrTick();
const setTab = t => { $("drawer").dataset.tab = t; qa(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === t)); };
qa(".tabs button").forEach(b => { b.onclick = () => setTab(b.dataset.tab); });
if (g.matchMedia("(max-width:820px)").matches) { setTab("phone"); $("qrToggle").checked = true; }
const qmsg = (cls, t) => { const m = $("qrMsg"); m.textContent = t; m.className = "msg " + cls; m.hidden = false; };
const jury = () => { UsersDB.countDevice(); grant(UsersDB.juryUser()); };
$("qrJury").onclick = jury;
const cells = qa(".otp input");
function otp() {
  const v = cells.map(c => c.value).join("");
  if (UsersDB.jury.verify(v)) { qmsg("ok", "Код принят: сессия Жюри"); jury(); }
  else { qmsg("err", "Неверный или устаревший код"); cells.forEach(c => { c.value = ""; }); cells[0].focus(); bg.kick(4); }
}
cells.forEach((c, i) => {
  c.addEventListener("input", () => { c.value = c.value.replace(/\D/g, "").slice(-1); if (c.value && cells[i + 1]) cells[i + 1].focus(); if (cells.every(x => x.value)) otp(); });
  c.addEventListener("keydown", e => { if (e.key === "Backspace" && !c.value && cells[i - 1]) { cells[i - 1].focus(); cells[i - 1].value = ""; } });
  c.addEventListener("paste", e => {
    const d = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6); if (!d) return; e.preventDefault();
    [...d].forEach((ch, j) => { cells[j].value = ch; }); cells[Math.min(d.length, 5)].focus(); if (d.length === 6) otp();
  });
});

/* --- камера смартфона: сканер QR (BarcodeDetector, нужен HTTPS/localhost) --- */
let stream = null, det = null;
const closeCam = () => { $("cam").hidden = true; if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
function got(txt) {
  try { const u = new URL(txt); if (u.searchParams.get("qr_auth") === "jury_session" && UsersDB.jury.verify(u.searchParams.get("code"))) { closeCam(); jury(); return true; } } catch (e) { /* не наш QR */ }
  return false;
}
async function scan(once) {
  if ($("cam").hidden || !det) return;
  try { const r = await det.detect($("camVideo")); if (r[0] && got(r[0].rawValue)) return; if (once) $("camMsg").textContent = "QR не распознан, повторите"; } catch (e) { /* кадр не готов */ }
  if (!once) setTimeout(scan, 250);
}
$("camBtn").onclick = async () => {
  $("cam").hidden = false; $("camMsg").textContent = "Наведите камеру на QR-код на экране ПК";
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); $("camVideo").srcObject = stream; await $("camVideo").play();
    if ("BarcodeDetector" in g) { det = new BarcodeDetector({ formats: ["qr_code"] }); scan(); } else $("camMsg").textContent = "Автоопределение QR недоступно в этом браузере: введите 6 цифр вручную";
  } catch (e) { $("camMsg").textContent = "Камера недоступна: нужны HTTPS или localhost и разрешение на доступ"; }
};
$("camShot").onclick = () => scan(true); $("camClose").onclick = closeCam;
const sp = new URLSearchParams(g.location.search);
if (sp.get("qr_auth") === "jury_session" && UsersDB.jury.verify(sp.get("code"))) jury();

/* --- каркас приложения: навигация, быстрые переключатели, модальные окна --- */
function show(v) {
  qa(".view").forEach(x => x.classList.toggle("on", x.id === "view-" + v)); qa("#side nav button").forEach(x => x.classList.toggle("on", x.dataset.view === v)); cfg();
}
qa("#side nav button").forEach(b => { b.onclick = () => show(b.dataset.view); });
$("selTheme").onchange = e => { document.documentElement.dataset.theme = e.target.value; cfg(); };
$("selTz").onchange = () => { tick(); cfg(); renderPwd(); }; $("selLang").onchange = cfg;
$("chkAnim").onchange = e => { B.classList.toggle("no-animations", !e.target.checked); cfg(); };
$("inpAccent").oninput = e => document.documentElement.style.setProperty("--acc", e.target.value);
qa(".seg[data-set]").forEach(s => { s.onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  const sel = $({ lang: "selLang", theme: "selTheme", tz: "selTz" }[s.dataset.set]); sel.value = b.dataset.val; sel.dispatchEvent(new Event("change"));
  qa("button", s).forEach(x => x.classList.toggle("on", x === b));
}; });
qa("[data-act=qr]").forEach(b => { b.onclick = () => { $("mQr").hidden = false; qw = -1; qrTick(); }; });
qa("[data-close]").forEach(b => { b.onclick = () => { b.closest(".overlay").hidden = true; }; });
}
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", run) : run();
})(window);
