/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/app/pinn-simulator.js  (физическое ядро стенда, БЕЗ DOM)
   «Живая» подстанция: ток / напряжение (S = √3·U·I), болтовой стык по Хольму (R_k = K / √F · film), температура с тепловой инерцией,
   RUL = RUL0·exp(−c·(R_k/R0 − 1)), вибрация проводов, буфер LTO + ДГУ, автоматический ввод резерва (АВР).
   Фильтр «PINN Kirchhoff Guard»: сравнивает ИК-температуру с физической оценкой при неизменном токе; нефизичный скачок помечается SPOOF FILTERED.
   Три испытания стенда: heat (нагрев стыка → авария → АВР на Ввод 2), spoof (помеха пурги), blackout (0 В → LTO → ДГУ) + reset.
   Работает только между входом и выходом из системы (abai:auth). Частота телеметрии — Store.get('tele') Гц; на экране значения плавно «скользят» (UI рисует спарклайны 60 FPS).
   Плагины влияют на физику: PINN-KIRCHHOFF-GUARD, LWIR-BLIZZARD-FILTER, ATS-AUTO-TRANSFER, LTO-DGU-STARTER, IEC61850-RX-TAP; пользовательские JS-плагины исполняются каждый такт.
   События (window): abai:sim (каждый такт, detail = state), abai:alarm {kind, active, ...}, abai:ats {to, auto, reason}, abai:scenario {name, phase},
   abai:spoof {raw, filtered}, abai:dgu {state, auto}, abai:plugin-alarm {id, note}, abai:plugin-error {id, message}.
   API: window.PINN. Python-плагины здесь НЕ исполняются (Phase 2: сервер FastAPI). */
(function (g) {
'use strict';
const C = { U0: 110.2, I0: 780, T0: 42.4, TEND: 85, TAMB: -18, R0: 14.2, REND: 95, F0: 31.5, FEND: 12, RUL0: 4200, RULEND: 15, FREQ0: 3.2, ACC0: 0.18, SOC0: 98, LTOT: -18.4, HEAT_DUR: 18, SPOOF_DUR: 14 };
C.K = C.R0 * Math.sqrt(C.F0);                                             // 79.7 µΩ·√kN
C.FILM = C.REND / (C.K / Math.sqrt(C.FEND));                              // 4.129: при F = 12 кН и пленке 4.13 → R_k = 95 µΩ
C.RULC = Math.log(C.RUL0 / C.RULEND) / (C.REND / C.R0 - 1);               // RUL(95 µΩ) = 15 мин
const SQ3 = Math.sqrt(3), SPAN = 120;                                     // хранение истории, с
const rnd = Math.random, gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const lerpk = (cur, tgt, dt, tau) => cur + (tgt - cur) * (1 - Math.exp(-dt / tau));
const emit = (n, d) => g.dispatchEvent(new CustomEvent(n, { detail: d }));
const ST = () => g.Store, plugOn = id => !!(ST() && ST().plugins.enabled(id)), plugP = id => { const p = ST() && ST().plugins.get(id); return (p && p.params) || {}; };

/* ---------- топология для графа ---------- */
const TOPO = {
  nodes: [
    { id: 'in1', kind: 'source', k: 'node.in1', r: 17 }, { id: 'in2', kind: 'source', k: 'node.in2', r: 17, res: true },
    { id: 'ats', kind: 'breaker', k: 'node.ats', r: 14, res: true }, { id: 'bus1', kind: 'bus', k: 'node.bus1', r: 15 }, { id: 'bus2', kind: 'bus', k: 'node.bus2', r: 15 },
    { id: 'joint', kind: 'joint', k: 'node.joint', r: 19, crit: true }, { id: 's_ir', kind: 'sensor', k: 'node.s_ir', r: 9, sensor: 'MLX90614-IR-01' },
    { id: 's_cur', kind: 'sensor', k: 'node.s_cur', r: 9, sensor: 'INA219-CUR-01' }, { id: 's_vib', kind: 'sensor', k: 'node.s_vib', r: 9, sensor: 'MPU6050-VIB-01' },
    { id: 'core', kind: 'core', k: 'node.core', r: 20 }, { id: 'lto', kind: 'backup', k: 'node.lto', r: 14, res: true, sensor: 'LTO-BAT-BUF' }, { id: 'dgu', kind: 'backup', k: 'node.dgu', r: 14, res: true }
  ],
  edges: [
    { id: 'e_in1_joint', a: 'in1', b: 'joint', t: 'power', fx: 'I = I₁' }, { id: 'e_joint_bus1', a: 'joint', b: 'bus1', t: 'power', fx: 'ΔU = I · R_k' },
    { id: 'e_in2_bus2', a: 'in2', b: 'bus2', t: 'power', res: true }, { id: 'e_bus2_ats', a: 'bus2', b: 'ats', t: 'power', res: true }, { id: 'e_ats_bus1', a: 'ats', b: 'bus1', t: 'power', res: true, fx: 'ΣI = 0' },
    { id: 'e_ir_joint', a: 's_ir', b: 'joint', t: 'sensor', fx: 'R_k = ΔP / I²' }, { id: 'e_cur_bus1', a: 's_cur', b: 'bus1', t: 'sensor', fx: 'S = √3·U·I' }, { id: 'e_vib_bus1', a: 's_vib', b: 'bus1', t: 'sensor', fx: 'a_rms' },
    { id: 'e_ir_core', a: 's_ir', b: 'core', t: 'tele' }, { id: 'e_cur_core', a: 's_cur', b: 'core', t: 'tele' }, { id: 'e_vib_core', a: 's_vib', b: 'core', t: 'tele' },
    { id: 'e_core_ats', a: 'core', b: 'ats', t: 'cmd', res: true, fx: 'RUL ≤ RUL_min → ATS' },
    { id: 'e_lto_core', a: 'lto', b: 'core', t: 'backup', res: true }, { id: 'e_lto_ats', a: 'lto', b: 'ats', t: 'backup', res: true }, { id: 'e_dgu_lto', a: 'dgu', b: 'lto', t: 'backup', res: true }, { id: 'e_dgu_bus1', a: 'dgu', b: 'bus1', t: 'backup', res: true }
  ]
};

/* ---------- состояние ---------- */
const S = {};
const series = {};                                                        // имя → {t:[мс], v:[], r:[сырое]}
let packets = [], timer = 0, last = 0, wanderP = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
let sp = { next: 0, until: 0, off: 0, first: true };
let pluginCache = {}, pluginErr = {}, pluginAlarm = {};
let sinceBlackout = 0;

function fresh() {
  Object.assign(S, {
    running: false, ts: Date.now(), scenario: 'none', scenT: 0, h: 0, hT: 0,
    U: C.U0, I: C.I0, S: SQ3 * C.U0 * C.I0 / 1000, mU: C.U0, mI: C.I0, mS: SQ3 * C.U0 * C.I0 / 1000, Tt: C.T0, Traw: C.T0, T: C.T0, Rk: C.R0, F: C.F0, P: C.I0 * C.I0 * C.R0 * 1e-6, rul: C.RUL0,
    freq: C.FREQ0, acc: C.ACC0, vdc: 220.4, soc: C.SOC0, ltoT: C.LTOT,
    in1: 'closed', in2: 'closed', ats: 'open', dgu: 'standby', src: 'IN1',
    guard: { active: false, until: 0, raw: 0, est: C.T0 }, link: { ina: true }, spoofSeen: false,
    alarm: { active: false, kind: '', since: 0, acked: false }, status: {}, vibState: 'ok', ltoState: 'standby', cmdUntil: 0
  });
  Object.keys(series).forEach(k => delete series[k]);
  ['temp', 'cur', 'acc', 'vdc', 'rk', 'volt'].forEach(k => { series[k] = { t: [], v: [], r: [] }; });
  packets = []; sp = { next: 0, until: 0, off: 0, first: true }; pluginAlarm = {}; sinceBlackout = 0;
}
const wander = (t, a, b, i) => Math.sin(t / 37.3 + wanderP[i]) * a + Math.sin(t / 11.1 + wanderP[(i + 1) % 4]) * b;
const jointI = () => (S.in1 === 'closed' && S.U > 5 ? S.I : 0);
const rulOf = rk => C.RUL0 * Math.exp(-C.RULC * (rk / C.R0 - 1));

/* ---------- пользовательские JS-плагины (демо-режим: НЕ песочница безопасности) ---------- */
function runPlugins(pk) {
  const list = ST().plugins.list();
  list.forEach(p => {
    if (p.builtin || !p.on || p.lang !== 'js') return;
    const key = p.id + '#' + (p.code || '').length + (p.code || '').slice(0, 24);
    let fn = pluginCache[p.id] && pluginCache[p.id].key === key ? pluginCache[p.id].fn : null;
    if (!fn) {
      try { fn = new Function('plugin', 'window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest', 'Store', 'UsersDB', '"use strict";\n' + p.code); pluginCache[p.id] = { key, fn }; delete pluginErr[p.id]; }
      catch (e) { if (pluginErr[p.id] !== e.message) { pluginErr[p.id] = e.message; emit('abai:plugin-error', { id: p.id, message: e.message }); } return; }
    }
    try {
      const r = fn({ packet: pk, params: p.params || {}, state: { src: S.src, ats: S.ats, scenario: S.scenario } });
      const on = !!(r && r.alarm);
      if (on && !pluginAlarm[p.id]) emit('abai:plugin-alarm', { id: p.id, note: (r && r.note) || '' });
      pluginAlarm[p.id] = on; delete pluginErr[p.id];
    } catch (e) { if (pluginErr[p.id] !== e.message) { pluginErr[p.id] = e.message; emit('abai:plugin-error', { id: p.id, message: e.message }); } }
  });
}

/* ---------- один такт физики ---------- */
function step(dt, at, quiet) {
  const now = at || Date.now(), thr = ST().thr.all(), tSec = now / 1000;
  const blackout = S.scenario === 'blackout';
  /* сценарии */
  if (S.scenario !== 'none') {
    S.scenT += dt;
    if (S.scenario === 'heat') S.hT = smooth(S.scenT / C.HEAT_DUR);
    if (S.scenario === 'spoof' && S.scenT > C.SPOOF_DUR) endScenario();
    if (S.scenario === 'heat' && S.scenT > 55) endScenario();
  } else S.hT = 0;
  const energized = S.in1 === 'closed' && S.U > 5;
  if (energized) { if (S.h < S.hT) S.h = S.hT; else if (S.h > S.hT) S.h = Math.max(S.hT, S.h - 0.8 * dt); }   // дефектный стык деградирует только под током

  /* электрика */
  const Ut = blackout ? 0 : C.U0 + wander(tSec, 0.05, 0.03, 0), It = blackout ? 0 : C.I0 + wander(tSec, 4, 2.5, 1);
  S.U = Math.max(0, lerpk(S.U, Ut, dt, Ut < S.U ? 0.35 : 1.4) + gauss() * 0.012);
  S.I = Math.max(0, lerpk(S.I, It, dt, 0.3) + gauss() * 0.9);
  if (blackout && S.U < 0.3) { S.U = 0; S.I = Math.min(S.I, 0.4) * 0; }
  S.S = SQ3 * S.U * S.I / 1000;
  S.link.ina = plugOn('IEC61850-RX-TAP');                                      // без шлюза МЭК 61850 измерения INA219 «замирают» (LINK LOST)
  if (S.link.ina) { S.mU = S.U; S.mI = S.I; S.mS = S.S; }
  /* стык: Хольм + тепловая инерция */
  S.F = C.F0 + (C.FEND - C.F0) * S.h;
  const film = 1 + (C.FILM - 1) * Math.pow(S.h, 1.4);
  S.Rk = C.K / Math.sqrt(S.F) * film + gauss() * 0.03;
  S.rul = rulOf(S.Rk);
  const Ij = jointI(), Tload = C.T0 + (C.TEND - C.T0) * S.h, Tss = C.TAMB + (Tload - C.TAMB) * Math.pow(Ij / C.I0, 2);
  S.Tt = lerpk(S.Tt, Tss, dt, Tss < S.Tt ? 9 : (S.scenario === 'heat' ? 0.8 : 2.2));
  S.P = Ij * Ij * S.Rk * 1e-6;
  /* ИК-датчик + помеха пурги */
  const sigma = plugOn('LWIR-BLIZZARD-FILTER') ? 0.10 : 0.45;
  if (S.scenario === 'spoof') {
    if (now >= sp.next) {                                                  // новый всплеск: нефизичный скачок ИК при неизменном токе
      sp.off = sp.first ? 49.3 : 28 + rnd() * 24; sp.until = now + (sp.first ? 1500 : 500 + rnd() * 1100); sp.next = sp.until + 1100 + rnd() * 1700; sp.first = false;
    }
  }
  const spoof = now < sp.until ? sp.off : 0;
  if (!spoof) sp.off = 0;
  S.Traw = S.Tt + gauss() * sigma + spoof;
  const est = S.Tt + gauss() * 0.06, gp = plugP('PINN-KIRCHHOFF-GUARD'), hold = (+gp.hold_s || 6) * 1000, tol = 6;
  const gOn = plugOn('PINN-KIRCHHOFF-GUARD'), flagged = gOn && Math.abs(S.Traw - est) > tol;   // скачок ИК без изменения тока нефизичен
  S.guard.est = est;
  if (flagged) {
    S.guard.until = now + hold; S.guard.raw = Math.max(S.guard.raw, S.Traw);
    if (!S.spoofSeen && !quiet) { S.spoofSeen = true; emit('abai:spoof', { raw: S.Traw, filtered: est }); }
  }
  S.guard.active = gOn && now < S.guard.until;
  if (!S.guard.active) S.guard.raw = 0;
  S.T = flagged ? est : S.Traw;
  /* вибрация */
  S.freq = C.FREQ0 + wander(tSec, 0.06, 0.03, 2) + gauss() * 0.012;
  S.acc = Math.max(0.01, C.ACC0 + wander(tSec, 0.016, 0.008, 3) + gauss() * 0.004);
  /* LTO + ДГУ */
  if (blackout) {
    sinceBlackout += dt;
    const delay = +plugP('LTO-DGU-STARTER').start_delay_s || 3;
    if (plugOn('LTO-DGU-STARTER') && S.dgu === 'standby' && sinceBlackout > delay) { S.dgu = 'starting'; emit('abai:dgu', { state: 'starting', auto: true }); }
    if (S.dgu === 'starting' && sinceBlackout > delay + 3) { S.dgu = 'active'; emit('abai:dgu', { state: 'active', auto: true }); }
  }
  const carrying = S.U < 5;
  S.soc = Math.max(1, Math.min(100, S.soc + (S.dgu === 'active' ? 0.03 : carrying ? -0.06 : (C.SOC0 - S.soc) * 0.05) * dt));
  S.vdc = 198 + 0.2286 * S.soc - (carrying ? 2.6 : 0) + gauss() * 0.05;
  S.ltoT = C.LTOT + wander(tSec, 0.25, 0.1, 1) + gauss() * 0.03;
  S.ltoState = carrying && S.dgu !== 'active' ? 'discharge' : S.dgu === 'active' ? 'charge' : 'standby';
  S.src = S.U < 5 ? (S.dgu === 'active' ? 'DGU' : 'LTO') : (S.in1 === 'closed' ? 'IN1' : 'IN2');
  S.vibState = S.acc >= thr.A_max ? 'err' : S.acc >= 0.75 * thr.A_max ? 'warn' : 'ok';

  /* тревоги и АВР */
  const rulMin = +plugP('ATS-AUTO-TRANSFER').rul_min || C.RULEND;
  const heat = S.T >= thr.T_max || (energized && S.rul <= rulMin + 0.001);
  if (S.alarm.active && S.alarm.acked && (S.alarm.kind === 'heat' || S.alarm.kind === 'false') && !heat && S.T < thr.T_max - 6) clearAlarm();   // защёлка: снимается после квитирования и устранения причины
  if (!S.alarm.active && heat && S.U > 5) {
    const real = S.Tt >= thr.T_max - 3 || S.rul <= rulMin + 0.001;
    raiseAlarm(real ? 'heat' : 'false');
    if (plugOn('ATS-AUTO-TRANSFER') && S.in1 === 'closed' && S.ats === 'open') transfer(true, real ? 'heat' : 'false');
  }
  if (blackout && !S.alarm.active) raiseAlarm('blackout');
  if (!blackout && S.alarm.active && S.alarm.kind === 'blackout') clearAlarm();

  /* статусы датчиков */
  const r = (v, lim) => (v >= lim ? 'err' : v >= 0.9 * lim ? 'warn' : 'ok');
  S.status = {
    'MLX90614-IR-01': S.alarm.active && (S.alarm.kind === 'heat' || S.alarm.kind === 'false') && S.T >= thr.T_max ? 'err' : (S.guard.active || S.Rk > 40 || r(S.T, thr.T_max) === 'warn' ? 'warn' : 'ok'),
    'INA219-CUR-01': !S.link.ina ? 'warn' : (blackout ? 'warn' : r(S.I, thr.I_max)),
    'MPU6050-VIB-01': S.vibState,
    'LTO-BAT-BUF': S.vdc < thr.U_min ? 'err' : (carrying || S.vdc < thr.U_min + 6 ? 'warn' : 'ok')
  };
  S.ts = now;

  /* история для спарклайнов */
  const push = (k, v, raw) => { const s = series[k]; s.t.push(now); s.v.push(v); s.r.push(raw == null ? v : raw); const cut = now - SPAN * 1000; while (s.t.length && s.t[0] < cut) { s.t.shift(); s.v.shift(); s.r.shift(); } };
  push('temp', S.T, S.Traw); push('cur', S.mI); push('acc', S.acc); push('vdc', S.vdc); push('rk', S.Rk); push('volt', S.mU);
  const pk = { t: now, U: +S.mU.toFixed(2), I: +S.mI.toFixed(1), T: +S.T.toFixed(2), Traw: +S.Traw.toFixed(2), Rk: +S.Rk.toFixed(2), F: +S.F.toFixed(2), f: +S.freq.toFixed(2), a: +S.acc.toFixed(3), Vdc: +S.vdc.toFixed(2), src: S.src, ats: S.ats, guard: S.guard.active };
  packets.push(pk); if (packets.length > 5) packets.shift();
  if (quiet) return;
  runPlugins({ temp: S.T, cur: S.mI, volt: S.mU, vib: S.acc, vdc: S.vdc });
  emit('abai:sim', S);
}

function raiseAlarm(kind) { S.alarm = { active: true, kind, since: Date.now(), acked: false }; emit('abai:alarm', { kind, active: true, T: S.T, rul: S.rul }); }
function clearAlarm() { const k = S.alarm.kind; S.alarm = { active: false, kind: '', since: 0, acked: false }; emit('abai:alarm', { kind: k, active: false }); }
function ack() { if (!S.alarm.active || S.alarm.acked) return false; S.alarm.acked = true; emit('abai:alarm', { kind: S.alarm.kind, active: true, acked: true }); return true; }
function transfer(auto, reason) {
  if (S.in1 !== 'closed' || S.ats !== 'open') return false;
  S.in1 = 'open'; S.ats = 'closed'; S.src = 'IN2'; S.cmdUntil = Date.now() + 3500; emit('abai:ats', { to: 'IN2', auto: !!auto, reason: reason || 'manual' }); return true;
}
function endScenario() { const n = S.scenario; S.scenario = 'none'; S.scenT = 0; S.hT = 0; emit('abai:scenario', { name: n, phase: 'end' }); }
function ret() {
  if (S.in1 === 'closed' && S.ats === 'open') return false;
  S.in1 = 'closed'; S.ats = 'open'; S.src = 'IN1'; emit('abai:ats', { to: 'IN1', auto: false, reason: 'manual' }); return true;
}

/* ---------- публичное управление ---------- */
function reset(silent) {
  const was = S.scenario;
  S.scenario = 'none'; S.scenT = 0; S.hT = 0; S.h = 0; S.in1 = 'closed'; S.ats = 'open'; S.dgu = 'standby'; S.src = 'IN1'; S.guard.until = 0; S.guard.active = false; S.spoofSeen = false;   // S.h = 0: стык «ремонтируется» сразу, без кратковременного перегрева после сброса
  sp = { next: 0, until: 0, off: 0, first: true }; sinceBlackout = 0; pluginAlarm = {};
  if (S.alarm.active) clearAlarm();
  if (!silent) emit('abai:scenario', { name: was === 'none' ? 'reset' : was, phase: 'reset' });
  if (silent) S.Tt = Math.max(S.Tt, C.TAMB);
  else { S.Tt = S.T = S.Traw = C.T0; S.guard.est = C.T0; }                  // явный «Сброс стенда»: тепловое состояние сразу штатное (без долгого остывания)
}
function scenario(name) {
  if (!S.running) return false;
  if (name === 'reset') { reset(false); return true; }
  if (['heat', 'spoof', 'blackout'].indexOf(name) < 0) return false;
  reset(true); S.scenario = name; S.scenT = 0; S.spoofSeen = false; sp = { next: Date.now() + 900, until: 0, off: 0, first: true };
  emit('abai:scenario', { name, phase: 'start' }); return true;
}
function act(name) {
  if (!S.running) return { ok: false, reason: 'OFF' };
  if (name === 'transfer') return transfer(false, 'manual') ? { ok: true, to: 'IN2' } : { ok: false, reason: 'STATE' };
  if (name === 'return') return ret() ? { ok: true, to: 'IN1' } : { ok: false, reason: 'STATE' };
  if (name === 'dgu.start') { if (S.dgu !== 'standby') return { ok: false, reason: 'STATE' }; S.dgu = 'starting'; emit('abai:dgu', { state: 'starting', auto: false }); setTimeout(() => { if (S.running && S.dgu === 'starting') { S.dgu = 'active'; emit('abai:dgu', { state: 'active', auto: false }); } }, 3000); return { ok: true }; }
  if (name === 'dgu.stop') { if (S.dgu === 'standby') return { ok: false, reason: 'STATE' }; S.dgu = 'standby'; emit('abai:dgu', { state: 'standby', auto: false }); return { ok: true }; }
  return { ok: false, reason: 'NAME' };
}
function loop() { const now = Date.now(); let dt = (now - last) / 1000; last = now; if (dt <= 0) return; step(Math.min(dt, 0.6)); }
function restartTimer() { clearInterval(timer); if (S.running) timer = setInterval(loop, Math.round(1000 / (ST().get('tele') || 4))); }
function start() { if (S.running) return; fresh(); S.running = true; last = Date.now(); const n = 260; for (let i = n; i > 0; i--) step(0.25, last - i * 250, true); restartTimer(); }
function stop() { clearInterval(timer); timer = 0; S.running = false; fresh(); }

/* ---------- потоки энергии / данных по рёбрам графа (0…1, знак = направление a→b) ---------- */
function flows() {
  const live = S.U > 5, f = {}, via2 = live && S.in1 === 'open' && S.ats === 'closed', p1 = live && S.in1 === 'closed', dgu = S.dgu === 'active', blk = S.U < 5, ina = S.link.ina;
  f.e_in1_joint = p1 ? 1 : 0; f.e_joint_bus1 = p1 ? 1 : 0;
  f.e_in2_bus2 = live ? (via2 ? 1 : 0.14) : 0; f.e_bus2_ats = via2 ? 1 : 0; f.e_ats_bus1 = via2 ? 1 : 0;
  f.e_ir_joint = 0.4; f.e_cur_bus1 = ina ? 0.4 : 0; f.e_vib_bus1 = 0.35;
  f.e_ir_core = 0.55; f.e_cur_core = ina ? 0.55 : 0; f.e_vib_core = 0.5;
  f.e_core_ats = Date.now() < S.cmdUntil ? 1 : 0.05;
  f.e_lto_core = blk ? 1 : 0.12; f.e_lto_ats = blk ? 0.6 : 0; f.e_dgu_lto = dgu ? 1 : (S.dgu === 'starting' ? 0.4 : 0); f.e_dgu_bus1 = dgu ? 0.8 : 0;
  return f;
}
const alarmNode = () => (S.alarm.active ? (S.alarm.kind === 'blackout' ? 'bus1' : 'joint') : '');
const wipe = () => { S.guard.until = 0; };
fresh();

g.addEventListener('abai:auth', e => { if (e.detail && e.detail.type === 'login') start(); else if (e.detail && e.detail.type === 'logout') stop(); });
g.addEventListener('abai:settings', e => { if (e.detail && e.detail.key === 'tele') restartTimer(); });
g.addEventListener('abai:plugins', () => { pluginCache = {}; });
g.PINN = { C, TOPO, state: () => S, series: k => series[k] || { t: [], v: [], r: [] }, packets: () => packets.slice(), flows, alarmNode, pluginErrors: () => pluginErr,
  start, stop, ack, reset: () => reset(false), scenario, act, transfer: () => act('transfer'), rulOf, wipe, isRunning: () => S.running };
})(window);
