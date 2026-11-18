/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/qr-encoder.js
   Автономный генератор QR-кода (ISO/IEC 18004): байтовый режим UTF-8, версии 1–10, уровни коррекции L/M/Q/H,
   код Рида-Соломона над GF(256), все 8 масок со штрафами, информация о формате и версии (BCH).
   Без внешних библиотек. Публичный API: window.QREncoder.encode(text, {ecc, minVersion, maxVersion, mask}) */
(function (g) {
'use strict';

const ECC_CW = { L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18], M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24], H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28] };      // ECC-кодовых слов на блок
const ECC_BLK = { L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4], M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8], H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8] };                        // число блоков
const FMT = { L: 1, M: 0, Q: 3, H: 2 };                                                         // индикатор уровня в формате
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const MAX_VERSION = 10;

const bit = (v, i) => (v >>> i) & 1;
const sizeOf = ver => 17 + 4 * ver;

/* число модулей данных (без служебных) → кодовых слов */
function rawCodewords(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
  return r >> 3;
}
const dataCodewords = (ver, ecc) => rawCodewords(ver) - ECC_CW[ecc][ver - 1] * ECC_BLK[ecc][ver - 1];
const capacityBytes = (ver, ecc) => Math.floor((dataCodewords(ver, ecc) * 8 - 4 - (ver >= 10 ? 16 : 8)) / 8);

/* ---------- GF(256), полином 0x11D ---------- */
function gmul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; }
function rsDivisor(deg) {
  const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
  for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { r[j] = gmul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; } root = gmul(root, 2); }
  return r;
}
function rsRemainder(data, div) {
  const r = div.map(() => 0);
  data.forEach(b => { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gmul(c, f); }); });
  return r;
}

/* ---------- UTF-8 ---------- */
function utf8(s) {
  if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(s));
  const o = []; const e = unescape(encodeURIComponent(s)); for (let i = 0; i < e.length; i++) o.push(e.charCodeAt(i)); return o;
}

/* ---------- сборка потока данных ---------- */
function buildData(bytes, ver, ecc) {
  const bits = [], put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4); put(bytes.length, ver >= 10 ? 16 : 8); bytes.forEach(b => put(b, 8));
  const cap = dataCodewords(ver, ecc) * 8;
  put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
  const cw = []; for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k]; cw.push(v); }
  for (let pad = 0xEC; cw.length < cap / 8; pad ^= 0xEC ^ 0x11) cw.push(pad);
  return cw;
}
function interleave(data, ver, ecc) {
  const nb = ECC_BLK[ecc][ver - 1], el = ECC_CW[ecc][ver - 1], raw = rawCodewords(ver);
  const shortN = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(el), blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - el + (i < shortN ? 0 : 1)); k += dat.length;
    const e = rsRemainder(dat, div); if (i < shortN) dat.push(0); blocks.push(dat.concat(e));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - el || j >= shortN) out.push(b[i]); });
  return out;
}

/* ---------- матрица ---------- */
function makeMatrix(ver, ecc, codewords, maskWanted) {
  const S = sizeOf(ver), m = Array.from({ length: S }, () => new Uint8Array(S)), fn = Array.from({ length: S }, () => new Uint8Array(S));
  const setFn = (x, y, v) => { m[y][x] = v ? 1 : 0; fn[y][x] = 1; };
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy)); if (x >= 0 && x < S && y >= 0 && y < S) setFn(x, y, d !== 2 && d !== 4); } };
  const align = (cx, cy) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); };
  const formatBits = mask => {
    const data = FMT[ecc] << 3 | mask; let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = (data << 10 | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(b, i));
    setFn(8, 7, bit(b, 6)); setFn(8, 8, bit(b, 7)); setFn(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) setFn(S - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) setFn(8, S - 15 + i, bit(b, i));
    setFn(8, S - 8, 1);
  };
  for (let i = 0; i < S; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  finder(3, 3); finder(S - 4, 3); finder(3, S - 4);
  const ap = ALIGN[ver - 1], n = ap.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (!(i === 0 && j === 0 || i === 0 && j === n - 1 || i === n - 1 && j === 0)) align(ap[i], ap[j]);
  formatBits(0);
  if (ver >= 7) {
    let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const b = ver << 12 | rem;
    for (let i = 0; i < 18; i++) { const a = S - 11 + i % 3, c = Math.floor(i / 3); setFn(a, c, bit(b, i)); setFn(c, a, bit(b, i)); }
  }
  /* змейка данных */
  for (let i = 0, right = S - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < S; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? S - 1 - v : v;
      if (!fn[y][x] && i < codewords.length * 8) { m[y][x] = bit(codewords[i >>> 3], 7 - (i & 7)); i++; }
    }
  }
  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  const applyMask = k => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (!fn[y][x] && MASKS[k](x, y)) m[y][x] ^= 1; };
  let best = maskWanted;
  if (best < 0) {
    let bp = Infinity;
    for (let k = 0; k < 8; k++) { applyMask(k); formatBits(k); const p = penalty(m, S); if (p < bp) { bp = p; best = k; } applyMask(k); }
  }
  applyMask(best); formatBits(best);
  return { modules: m, isFunction: fn, mask: best, size: S };
}

/* штрафы по ISO 18004 (N1 = 3, N2 = 3, N3 = 40, N4 = 10) */
function penalty(m, S) {
  let p = 0, dark = 0;
  const FP = [1, 0, 1, 1, 1, 0, 1], LIGHT4 = [0, 0, 0, 0];
  const scan = line => {
    let run = 1;
    for (let i = 1; i < S; i++) { if (line[i] === line[i - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
    for (let i = 0; i + 7 <= S; i++) {
      if (FP.every((v, k) => line[i + k] === v)) {
        if (i >= 4 && LIGHT4.every((v, k) => line[i - 4 + k] === v)) p += 40;
        if (i + 11 <= S && LIGHT4.every((v, k) => line[i + 7 + k] === v)) p += 40;
      }
    }
  };
  for (let y = 0; y < S; y++) { scan(m[y]); const col = new Uint8Array(S); for (let x = 0; x < S; x++) { col[x] = m[x][y]; dark += m[y][x]; } scan(col); }
  for (let y = 0; y < S - 1; y++) for (let x = 0; x < S - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
  p += Math.floor(Math.abs(dark * 20 - S * S * 10) / (S * S)) * 10;
  return p;
}

/* ---------- публичный API ---------- */
function encode(text, opt) {
  opt = opt || {};
  const ecc = ECC_CW[opt.ecc] ? opt.ecc : 'Q', bytes = utf8(String(text));
  let ver = Math.max(1, opt.minVersion | 0 || 1);
  const maxV = Math.min(MAX_VERSION, opt.maxVersion | 0 || MAX_VERSION);
  while (ver <= maxV && capacityBytes(ver, ecc) < bytes.length) ver++;
  if (ver > maxV) throw new Error('QR: текст слишком длинный (' + bytes.length + ' байт) для уровня ' + ecc + ' версии ≤ ' + maxV);
  const cw = interleave(buildData(bytes, ver, ecc), ver, ecc);
  const r = makeMatrix(ver, ecc, cw, opt.mask == null ? -1 : opt.mask | 0);
  const S = r.size, fn = r.isFunction;
  const isFinder = (x, y) => (x < 8 && y < 8) || (x >= S - 8 && y < 8) || (x < 8 && y >= S - 8);
  return { version: ver, ecc, mask: r.mask, size: S, bytes: bytes.length, modules: r.modules, isFunction: fn, isFinder,
    get: (x, y) => (x >= 0 && y >= 0 && x < S && y < S ? r.modules[y][x] : 0) };
}

g.QREncoder = { encode, capacityBytes, MAX_VERSION };
if (typeof module !== 'undefined' && module.exports) module.exports = g.QREncoder;
})(typeof window !== 'undefined' ? window : globalThis);
