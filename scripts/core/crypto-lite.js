/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/core/crypto-lite.js  (криптопримитивы на чистом JS, БЕЗ UI и БЕЗ зависимостей)
   SHA-256, HMAC-SHA256, PBKDF2-HMAC-SHA256, TOTP/HOTP, JWT-образные токены (HS256), base64url, сравнение за постоянное время.

   Зачем свой SHA-256, если есть crypto.subtle: WebCrypto доступен ТОЛЬКО в «безопасном контексте» (https:// или localhost).
   Стенд жюри и телефон открывают страницу по http://192.168.4.1:8000 — там crypto.subtle == undefined. Поэтому проверка токенов,
   которую должен уметь и ПК, и телефон, написана на чистом JS (проверена на тест-векторах NIST/RFC 4231/RFC 7914 и против Python hashlib).
   crypto.getRandomValues доступен в любом контексте, его и берём для случайности.

   ВАЖНО (честная модель угроз): любой секрет, лежащий в клиентском JS, — не секрет. Поэтому здесь ТОЛЬКО мок:
   формат токенов, хеши и проверки такие же, как будут на сервере, но ключ подписи — демонстрационный.
   Phase 2: подпись и проверка переезжают в FastAPI (ключ только на сервере, jti гасится в Redis, refresh-токены в httpOnly-cookie),
   а этот файл остаётся для вычисления отпечатков и офлайн-проверки форматов.
   API: window.CryptoLite = { sha256, hmac, pbkdf2, hashPassword, verifyPassword, hotp, totp, signToken, verifyToken, decodeToken,
                              b64u, utf8, hex, randomBytes, randomId, timingSafeEqual, ab64 } */
(function (g) {
'use strict';

/* ---------- константы SHA-256: дробные части корней первых простых чисел (как в спецификации FIPS 180-4) ---------- */
const H0 = new Uint32Array(8), KK = new Uint32Array(64);
(function () {
  const two32 = Math.pow(2, 32), comp = {}; let n = 0;
  for (let c = 2; n < 64; c++) {
    if (comp[c]) continue;
    for (let i = c * c; i < 400; i += c) comp[i] = 1;
    if (n < 8) H0[n] = Math.pow(c, .5) * two32;
    KK[n++] = Math.pow(c, 1 / 3) * two32;
  }
})();

function compress(h, w) {                               // h: Uint32Array(8) — состояние; w: Uint32Array(64), слова 0..15 заполнены
  for (let i = 16; i < 64; i++) {
    const a = w[i - 15], b = w[i - 2];
    w[i] = (w[i - 16] + (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + w[i - 7] + (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10))) | 0;
  }
  let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], gg = h[6], hh = h[7];
  for (let i = 0; i < 64; i++) {
    const t1 = (hh + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & gg)) + KK[i] + w[i]) | 0;
    const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    hh = gg; gg = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
  h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + gg) | 0; h[7] = (h[7] + hh) | 0;
}
function loadBlock(bytes, off, w) { for (let i = 0; i < 16; i++) { const o = off + i * 4; w[i] = (bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]; } }
function words2bytes(h) { const o = new Uint8Array(32); for (let i = 0; i < 8; i++) { o[i * 4] = h[i] >>> 24; o[i * 4 + 1] = h[i] >>> 16; o[i * 4 + 2] = h[i] >>> 8; o[i * 4 + 3] = h[i]; } return o; }

/* продолжить хеш с состояния h (после prefixLen байт, кратных 64) над сообщением msg; вернуть дайджест */
function finish(h0, msg, prefixLen) {
  const h = h0.slice(), w = new Uint32Array(64), len = msg.length, total = ((len + 9 + 63) >> 6) << 6, buf = new Uint8Array(total);
  buf.set(msg); buf[len] = 0x80;
  const bits = (prefixLen + len) * 8, hi = Math.floor(bits / 4294967296), lo = bits >>> 0;
  buf[total - 8] = hi >>> 24; buf[total - 7] = hi >>> 16; buf[total - 6] = hi >>> 8; buf[total - 5] = hi;
  buf[total - 4] = lo >>> 24; buf[total - 3] = lo >>> 16; buf[total - 2] = lo >>> 8; buf[total - 1] = lo;
  for (let o = 0; o < total; o += 64) { loadBlock(buf, o, w); compress(h, w); }
  return words2bytes(h);
}

const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
function utf8(s) {
  if (s instanceof Uint8Array) return s;
  s = String(s == null ? '' : s);
  if (enc) return enc.encode(s);
  const u = unescape(encodeURIComponent(s)), o = new Uint8Array(u.length); for (let i = 0; i < u.length; i++) o[i] = u.charCodeAt(i); return o;
}
const sha256 = msg => finish(H0, utf8(msg), 0);

/* ---------- HMAC-SHA256 ---------- */
function padKey(key) { key = utf8(key); if (key.length > 64) key = sha256(key); const k = new Uint8Array(64); k.set(key); return k; }
function hmacStates(key) {                                       // состояния хеша после ipad / opad (ускоряет PBKDF2 вдвое)
  const k = padKey(key), ip = new Uint8Array(64), op = new Uint8Array(64), w = new Uint32Array(64), hi = H0.slice(), ho = H0.slice();
  for (let i = 0; i < 64; i++) { ip[i] = k[i] ^ 0x36; op[i] = k[i] ^ 0x5c; }
  loadBlock(ip, 0, w); compress(hi, w); loadBlock(op, 0, w); compress(ho, w);
  return { hi, ho };
}
function hmac(key, msg) { const s = hmacStates(key); return finish(s.ho, finish(s.hi, utf8(msg), 64), 64); }

/* ---------- PBKDF2-HMAC-SHA256 (RFC 8018) ---------- */
function pbkdf2(password, salt, iterations, dkLen) {
  iterations = Math.max(1, iterations | 0); dkLen = dkLen || 32;
  const s = hmacStates(password), salt0 = utf8(salt), blocks = Math.ceil(dkLen / 32), out = new Uint8Array(blocks * 32);
  const w = new Uint32Array(64), st = new Uint32Array(8), U = new Uint32Array(8), T = new Uint32Array(8);
  for (let b = 1; b <= blocks; b++) {
    const m = new Uint8Array(salt0.length + 4); m.set(salt0); m[m.length - 4] = b >>> 24; m[m.length - 3] = b >>> 16; m[m.length - 2] = b >>> 8; m[m.length - 1] = b;
    const u1 = finish(s.ho, finish(s.hi, m, 64), 64);
    for (let i = 0; i < 8; i++) { U[i] = (u1[i * 4] << 24) | (u1[i * 4 + 1] << 16) | (u1[i * 4 + 2] << 8) | u1[i * 4 + 3]; T[i] = U[i]; }
    w[8] = 0x80000000; for (let i = 9; i < 15; i++) w[i] = 0; w[15] = 768;          // дайджест (32 б) + паддинг, длина (64+32)*8 бит
    for (let it = 1; it < iterations; it++) {
      for (let i = 0; i < 8; i++) w[i] = U[i];
      st.set(s.hi); compress(st, w);
      for (let i = 0; i < 8; i++) w[i] = st[i];
      st.set(s.ho); compress(st, w);
      for (let i = 0; i < 8; i++) { U[i] = st[i]; T[i] ^= st[i]; }
    }
    out.set(words2bytes(T), (b - 1) * 32);
  }
  return out.slice(0, dkLen);
}

/* ---------- кодировки ---------- */
const hex = bytes => Array.prototype.map.call(bytes, x => (x < 16 ? '0' : '') + x.toString(16)).join('');
function b64enc(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return g.btoa(s); }
function b64dec(str) { const s = g.atob(str), o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
const b64u = {
  enc: bytes => b64enc(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: str => { str = String(str).replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; return b64dec(str); },
  str: s => b64u.enc(utf8(s)),
  unstr: s => new TextDecoder().decode(b64u.dec(s))
};
const ab64 = { enc: bytes => b64enc(bytes).replace(/\+/g, '.').replace(/=+$/, ''), dec: str => { str = String(str).replace(/\./g, '+'); while (str.length % 4) str += '='; return b64dec(str); } };   // «adapted base64» passlib

function timingSafeEqual(a, b) {
  a = utf8(a); b = utf8(b); let d = a.length ^ b.length;
  const n = Math.max(a.length, b.length); for (let i = 0; i < n; i++) d |= (a[i % (a.length || 1)] ^ b[i % (b.length || 1)]);
  return d === 0;
}
function randomBytes(n) {
  const o = new Uint8Array(n), c = g.crypto || g.msCrypto;
  if (c && c.getRandomValues) c.getRandomValues(o); else for (let i = 0; i < n; i++) o[i] = Math.floor(Math.random() * 256);     // запасной путь: только очень старые браузеры
  return o;
}
const randomId = (n) => b64u.enc(randomBytes(n || 12));

/* ---------- пароли: формат passlib «$pbkdf2-sha256$rounds$salt$checksum» (FastAPI/passlib принимает как есть) ----------
   Phase 2: на сервере тот же пароль хранится как bcrypt/argon2id; клиент хешей не видит вообще. */
const PBKDF2_ROUNDS = 29000;
function hashPassword(password, saltBytes, rounds) {
  rounds = rounds || PBKDF2_ROUNDS; saltBytes = saltBytes || randomBytes(16);
  return '$pbkdf2-sha256$' + rounds + '$' + ab64.enc(saltBytes) + '$' + ab64.enc(pbkdf2(password, saltBytes, rounds, 32));
}
function verifyPassword(password, stored) {
  const m = /^\$pbkdf2-sha256\$(\d{3,7})\$([A-Za-z0-9./]+)\$([A-Za-z0-9./]+)$/.exec(String(stored || ''));
  if (!m) return false;
  let salt, want; try { salt = ab64.dec(m[2]); want = ab64.dec(m[3]); } catch (e) { return false; }
  return timingSafeEqual(pbkdf2(String(password), salt, +m[1], want.length), want);
}

/* ---------- одноразовые коды (HOTP/TOTP по RFC 4226/6238, HMAC-SHA256) ---------- */
function hotp(secret, counter, digits) {
  const c = new Uint8Array(8); let n = Math.floor(counter); for (let i = 7; i >= 0; i--) { c[i] = n % 256; n = Math.floor(n / 256); }
  const h = hmac(secret, c), o = h[31] & 15, v = ((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) >>> 0;
  return String(v % Math.pow(10, digits || 6)).padStart(digits || 6, '0');
}
const totp = (secret, stepMs, now, digits) => hotp(secret, Math.floor((now == null ? Date.now() : now) / stepMs), digits);

/* ---------- JWT-образные токены: base64url(header).base64url(payload).base64url(HMAC-SHA256) ---------- */
function signToken(payload, key, kid) {
  const h = b64u.str(JSON.stringify({ alg: 'HS256', typ: 'ABAI', kid: kid || 'mock-1' })), p = b64u.str(JSON.stringify(payload));
  return h + '.' + p + '.' + b64u.enc(hmac(key, h + '.' + p));
}
function decodeToken(tok) {                                      // БЕЗ проверки подписи: только для показа / диагностики
  try { const a = String(tok).split('.'); return a.length === 3 ? { header: JSON.parse(b64u.unstr(a[0])), payload: JSON.parse(b64u.unstr(a[1])) } : null; } catch (e) { return null; }
}
/* opts: {now (мс), typ, aud, leeway (с)}; результат {ok, payload} | {ok:false, reason: FORMAT|ALG|SIGNATURE|EXPIRED|NOT_YET|TYPE|AUDIENCE} */
function verifyToken(tok, key, opts) {
  opts = opts || {};
  if (typeof tok !== 'string' || tok.length > 4096) return { ok: false, reason: 'FORMAT' };
  const a = tok.split('.'); if (a.length !== 3) return { ok: false, reason: 'FORMAT' };
  let head, pl, sig;
  try { head = JSON.parse(b64u.unstr(a[0])); pl = JSON.parse(b64u.unstr(a[1])); sig = b64u.dec(a[2]); } catch (e) { return { ok: false, reason: 'FORMAT' }; }
  if (!head || head.alg !== 'HS256') return { ok: false, reason: 'ALG' };                      // alg=none и подмена алгоритма отвергаются жёстко
  if (!timingSafeEqual(hmac(key, a[0] + '.' + a[1]), sig)) return { ok: false, reason: 'SIGNATURE' };
  if (!pl || typeof pl !== 'object') return { ok: false, reason: 'FORMAT' };
  const now = Math.floor((opts.now == null ? Date.now() : opts.now) / 1000), leeway = opts.leeway == null ? 5 : opts.leeway;
  if (typeof pl.exp !== 'number' || now > pl.exp + leeway) return { ok: false, reason: 'EXPIRED' };
  if (typeof pl.nbf === 'number' && now + leeway < pl.nbf) return { ok: false, reason: 'NOT_YET' };
  if (opts.typ && pl.typ !== opts.typ) return { ok: false, reason: 'TYPE' };
  if (opts.aud && pl.aud !== opts.aud) return { ok: false, reason: 'AUDIENCE' };
  return { ok: true, payload: pl, header: head };
}

g.CryptoLite = Object.freeze({ sha256, hmac, pbkdf2, hashPassword, verifyPassword, hotp, totp, signToken, verifyToken, decodeToken,
  b64u: Object.freeze(b64u), ab64: Object.freeze(ab64), utf8, hex, randomBytes, randomId, timingSafeEqual, PBKDF2_ROUNDS });
})(window);
