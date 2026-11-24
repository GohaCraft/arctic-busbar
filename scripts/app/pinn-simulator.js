/* ARCTIC BUSBAR AI v2.4.0-prod: scripts/app/pinn-simulator.js  (физическое ядро стенда, БЕЗ DOM)
   «Живая» подстанция: ток / напряжение (S = √3·U·I), болтовой стык по Хольму (R_k = K / √F · film), температура с тепловой инерцией,
   RUL = RUL0·exp(−c·(R_k/R0 − 1)), вибрация проводов, буфер LTO + ДГУ, автоматический ввод резерва (АВР).
   Фильтр «PINN Kirchhoff Guard»: сравнивает ИК-температуру с физической оценкой при неизменном токе; нефизичный скачок помечается SPOOF FILTERED.
   Три испытания стенда: heat (нагрев стыка → авария → АВР на Ввод 2), spoof (помеха пурги), blackout (0 В → LTO → ДГУ) + reset.
   Работает только между входом и выходом из системы (abai:auth). Частота телеметрии — Store.get('tele') Гц; на экране значения плавно «скользят» (UI рисует спарклайны 60 FPS).

   ЭТАП 3: ИСТОЧНИК ДАННЫХ.  S.source:  'sim'  — симулятор (только DEMO_MODE=true, пока нет живого оборудования);
                                        'hw'   — настоящие пакеты HardwareLink (событие abai:hw → ingest): физика не выдумывает ничего,
                                                 R_k и RUL считаются из измерений (R_k = ΔP / I², ΔP = (T − T_возд) / R_тепл), а чего датчик не прислал — не показывается;
                                        'none' — боевой режим без оборудования: OFFLINE, данные «—», тревог нет, симуляции нет.
   S.have = {T, Ta, I, U, S, acc, freq, vdc, soc, ltoT, Rk, F, rul, sw}: какие величины реально есть (UI рисует «—» там, где false).
   Нет пакетов 5 с (abai:hw stale) → DEMO: возврат к симулятору, боевой режим: OFFLINE.  Пользовательские JS-плагины исполняет PluginHost (Web Worker), не этот файл.
   События (window): abai:sim (каждый такт, detail = state), abai:source {source, prev}, abai:alarm {kind, active, ...}, abai:ats {to, auto, reason}, abai:scenario {name, phase},
   abai:spoof {raw, filtered}, abai:dgu {state, auto}, abai:plugin-alarm {id, note}, abai:plugin-error {id, message}, abai:cmdfail {name}.
   API: window.PINN. Python-плагины здесь НЕ исполняются (Phase 2: сервер FastAPI). */
(function (g) {
'use strict';
const C = { U0: 110.2, I0: 780, T0: 42.4, TEND: 85, TAMB: -18, R0: 14.2, REND: 95, F0: 31.5, FEND: 12, RUL0: 4200, RULEND: 15, FREQ0: 3.2, ACC0: 0.18, SOC0: 98, LTOT: -18.4, HEAT_DUR: 18, SPOOF_DUR: 14 };
C.K = C.R0 * Math.sqrt(C.F0);                                             // 79.7 µΩ·√kN
C.FILM = C.REND / (C.K / Math.sqrt(C.FEND));                              // 4.129: при F = 12 кН и пленке 4.13 → R_k = 95 µΩ
C.RULC = Math.log(C.RUL0 / C.RULEND) / (C.REND / C.R0 - 1);               // RUL(95 µΩ) = 15 мин
C.RTH = (C.T0 - C.TAMB) / (C.I0 * C.I0 * C.R0 * 1e-6);                    // 6.99 К/Вт: тепловое сопротивление стыка стенда (для R_k = ΔP / I² по измерениям)
const SQ3 = Math.sqrt(3), SPAN = 120;                                     // хранение истории, с
const rnd = Math.random, gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const lerpk = (cur, tgt, dt, tau) => cur + (tgt - cur) * (1 - Math.exp(-dt / tau));
const emit = (n, d) => g.dispatchEvent(new CustomEvent(n, { detail: d }));
const ST = () => g.Store, plugOn = id => !!(ST() && ST().plugins.enabled(id)), plugP = id => { const p = ST() && ST().plugins.get(id); return (p && p.params) || {}; };
const DEMO = () => !!(g.ABAI_CONFIG && g.ABAI_CONFIG.DEMO_MODE === true);
const HWL = () => g.HardwareLink || null, PH = () => g.PluginHost || null;
const HAVE_KEYS = ['T', 'Ta', 'I', 'U', 'S', 'acc', 'freq', 'vdc', 'soc', 'ltoT', 'Rk', 'F', 'rul'];
const allHave = v => { const o = { sw: false }; HAVE_KEYS.forEach(k => { o[k] = v; }); return o; };

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
let pluginErr = {}, pluginAlarm = {};
let sinceBlackout = 0, hw = { last: 0, lastEmit: 0, est: null, lastT: null, lastI: null, rk: null }, hbAt = 0;

function fresh() {
  Object.assign(S, {
    running: false, source: 'none', have: allHave(false), live: false, Ta: C.TAMB, ts: Date.now(), scenario: 'none', scenT: 0, h: 0, hT: 0,
    U: C.U0, I: C.I0, S: SQ3 * C.U0 * C.I0 / 1000, mU: C.U0, mI: C.I0, mS: SQ3 * C.U0 * C.I0 / 1000, Tt: C.T0, Traw: C.T0, T: C.T0, Rk: C.R0, F: C.F0, P: C.I0 * C.I0 * C.R0 * 1e-6, rul: C.RUL0,
    freq: C.FREQ0, acc: C.ACC0, vdc: 220.4, soc: C.SOC0, ltoT: C.LTOT,
    in1: 'closed', in2: 'closed', ats: 'open', dgu: 'standby', src: 'IN1',
    guard: { active: false, until: 0, raw: 0, est: C.T0 }, link: { ina: true }, spoofSeen: false,
    alarm: { active: false, kind: '', since: 0, acked: false }, status: {}, vibState: 'ok', ltoState: 'standby', cmdUntil: 0
  });
  Object.keys(series).forEach(k => delete series[k]);
  ['temp', 'cur', 'acc', 'vdc', 'rk', 'volt'].forEach(k => { series[k] = { t: [], v: [], r: [] }; });
  packets = []; sp = { next: 0, until: 0, off: 0, first: true }; pluginAlarm = {}; sinceBlackout = 0;
  hw = { last: 0, lastEmit: 0, est: null, lastT: null, lastI: null, rk: null };
}
const wander = (t, a, b, i) => Math.sin(t / 37.3 + wanderP[i]) * a + Math.sin(t / 11.1 + wanderP[(i + 1) % 4]) * b;
const jointI = () => (S.in1 === 'closed' && S.U > 5 ? S.I : 0);
const rulOf = rk => C.RUL0 * Math.exp(-C.RULC * (rk / C.R0 - 1));

/* ---------- пользовательские JS-плагины: исполняет PluginHost (Web Worker); здесь только вызов и разбор ответов ---------- */
function runPlugins(pk) { const H = PH(); if (H) H.tick({ packet: pk, state: { src: S.src, ats: S.ats, scenario: S.scenario } }); }
function onPluginResult(r) {
  if (!S.running || !r) return;
  if (r.ok) {
    const on = !!r.alarm;
    if (on && !pluginAlarm[r.id]) emit('abai:plugin-alarm', { id: r.id, note: r.note || '' });
    pluginAlarm[r.id] = on; delete pluginErr[r.id];
  } else {
    const m = r.message || 'ERROR';
    if (pluginErr[r.id] !== m) { pluginErr[r.id] = m; emit('abai:plugin-error', { id: r.id, message: m, disabled: !!r.disabled }); }
  }
}
const syncPlugins = () => { const H = PH(); if (H && ST()) H.sync(ST().plugins.list()); };

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
  S.S = SQ3 * S.U * S.I / 1000; S.live = S.U > 5;
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

  publish(now, quiet);
}

/* история для спарклайнов, последние 5 пакетов, плагины, событие abai:sim. В режиме hw в историю идут только реально пришедшие величины. */
function publish(now, quiet) {
  const H = S.have, push = (k, v, raw) => { const s = series[k]; s.t.push(now); s.v.push(v); s.r.push(raw == null ? v : raw); const cut = now - SPAN * 1000; while (s.t.length && s.t[0] < cut) { s.t.shift(); s.v.shift(); s.r.shift(); } };
  if (H.T) push('temp', S.T, S.Traw); if (H.I) push('cur', S.mI); if (H.acc) push('acc', S.acc); if (H.vdc) push('vdc', S.vdc); if (H.Rk) push('rk', S.Rk); if (H.U) push('volt', S.mU);
  const n = (v, d) => +v.toFixed(d);
  const pk = { t: now, U: H.U ? n(S.mU, 2) : null, I: H.I ? n(S.mI, 1) : null, T: H.T ? n(S.T, 2) : null, Traw: H.T ? n(S.Traw, 2) : null, Rk: H.Rk ? n(S.Rk, 2) : null, F: H.F ? n(S.F, 2) : null, f: H.freq ? n(S.freq, 2) : null, a: H.acc ? n(S.acc, 3) : null, Vdc: H.vdc ? n(S.vdc, 2) : null, src: S.src, ats: S.ats, guard: S.guard.active };
  packets.push(pk); if (packets.length > 5) packets.shift();
  if (quiet) return;
  runPlugins({ temp: H.T ? S.T : null, cur: H.I ? S.mI : null, volt: H.U ? S.mU : null, vib: H.acc ? S.acc : null, vdc: H.vdc ? S.vdc : null });
  emit('abai:sim', S);
}

function raiseAlarm(kind) { S.alarm = { active: true, kind, since: Date.now(), acked: false }; emit('abai:alarm', { kind, active: true, T: S.T, rul: S.rul }); }
function clearAlarm() { const k = S.alarm.kind; S.alarm = { active: false, kind: '', since: 0, acked: false }; emit('abai:alarm', { kind: k, active: false }); }
function ack() { if (!S.alarm.active || S.alarm.acked) return false; S.alarm.acked = true; emit('abai:alarm', { kind: S.alarm.kind, active: true, acked: true }); return true; }

/* команда в сторону оборудования (режим hw): коммутации и ДГУ уходят в ESP32 / шлюз; сбой отправки — событие abai:cmdfail */
const HW_CMD = { transfer: { cmd: 'ats', to: 2 }, 'return': { cmd: 'ats', to: 1 }, 'dgu.start': { cmd: 'dgu', on: 1 }, 'dgu.stop': { cmd: 'dgu', on: 0 } };
function hwCmd(name) {
  if (S.source !== 'hw' || !HWL() || !HW_CMD[name]) return;
  HWL().send(HW_CMD[name]).then(ok => { if (!ok) emit('abai:cmdfail', { name }); }, () => emit('abai:cmdfail', { name }));
}
function transfer(auto, reason) {
  if (S.in1 !== 'closed' || S.ats !== 'open') return false;
  S.in1 = 'open'; S.ats = 'closed'; S.src = 'IN2'; S.cmdUntil = Date.now() + 3500; emit('abai:ats', { to: 'IN2', auto: !!auto, reason: reason || 'manual' }); hwCmd('transfer'); return true;
}
function endScenario() { const n = S.scenario; S.scenario = 'none'; S.scenT = 0; S.hT = 0; emit('abai:scenario', { name: n, phase: 'end' }); }
function ret() {
  if (S.in1 === 'closed' && S.ats === 'open') return false;
  S.in1 = 'closed'; S.ats = 'open'; S.src = 'IN1'; emit('abai:ats', { to: 'IN1', auto: false, reason: 'manual' }); hwCmd('return'); return true;
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
  if (!S.running || S.source !== 'sim') return false;                          // испытания стенда существуют только у симулятора (DEMO_MODE)
  if (name === 'reset') { reset(false); return true; }
  if (['heat', 'spoof', 'blackout'].indexOf(name) < 0) return false;
  reset(true); S.scenario = name; S.scenT = 0; S.spoofSeen = false; sp = { next: Date.now() + 900, until: 0, off: 0, first: true };
  emit('abai:scenario', { name, phase: 'start' }); return true;
}
function act(name) {
  if (!S.running) return { ok: false, reason: 'OFF' };
  if (S.source === 'none') return { ok: false, reason: 'OFFLINE' };            // без связи с оборудованием команд нет
  if (name === 'transfer') return transfer(false, 'manual') ? { ok: true, to: 'IN2' } : { ok: false, reason: 'STATE' };
  if (name === 'return') return ret() ? { ok: true, to: 'IN1' } : { ok: false, reason: 'STATE' };
  if (name === 'dgu.start') {
    if (S.dgu !== 'standby') return { ok: false, reason: 'STATE' };
    S.dgu = 'starting'; emit('abai:dgu', { state: 'starting', auto: false }); hwCmd('dgu.start');
    setTimeout(() => { if (S.running && S.dgu === 'starting' && !S.have.sw) { S.dgu = 'active'; emit('abai:dgu', { state: 'active', auto: false }); } }, 3000);   // если оборудование присылает состояние ДГУ — ждём его
    return { ok: true };
  }
  if (name === 'dgu.stop') { if (S.dgu === 'standby') return { ok: false, reason: 'STATE' }; S.dgu = 'standby'; emit('abai:dgu', { state: 'standby', auto: false }); hwCmd('dgu.stop'); return { ok: true }; }
  return { ok: false, reason: 'NAME' };
}

/* ---------- источник данных ---------- */
function setSource(src) {
  if (S.source === src) return;
  const prev = S.source; S.source = src; S.have = allHave(src === 'sim');
  Object.keys(series).forEach(k => { series[k] = { t: [], v: [], r: [] }; }); packets = [];                 // историю разных источников не смешиваем
  emit('abai:source', { source: src, prev });
}
function startSim(prev) {                                                     // новый прогон симулятора (с «прогретой» историей)
  fresh(); S.running = true; S.source = 'sim'; S.have = allHave(true); last = Date.now();
  const n = 260; for (let i = n; i > 0; i--) step(0.25, last - i * 250, true);
  emit('abai:source', { source: 'sim', prev: prev || 'none' });
}
function toHw(now) {                                                          // первый живой пакет: симуляция и её тревоги отбрасываются
  if (S.source === 'sim') reset(true);
  S.in1 = 'closed'; S.ats = 'open'; S.dgu = 'standby'; S.src = 'IN1'; S.scenario = 'none';
  hw = { last: now, lastEmit: 0, est: null, lastT: null, lastI: null, rk: null };
  setSource('hw'); S.have.sw = false;
}
function lostHw() {
  if (S.source !== 'hw' || !S.running) return;
  if (DEMO()) { startSim('hw'); emit('abai:sim', S); return; }              // демо продолжается на симуляторе
  setSource('none'); S.guard.active = false; S.guard.until = 0; S.spoofSeen = false; emit('abai:sim', S);
}
const isLive = () => (S.source === 'sim' ? S.U > 5 : S.source === 'hw' ? (S.have.U ? S.U > 5 : (S.have.I ? S.I > 5 : false)) : false);

/* Один пакет от оборудования (HardwareLink.sample) → состояние. Вызывается из abai:hw; не чаще tele Гц обновляет экран. */
function ingest(sm) {
  if (!S.running || !sm || typeof sm !== 'object') return false;
  const now = sm.ts || Date.now();
  if (S.source !== 'hw') toHw(now);
  const thr = ST().thr.all(), H = S.have, dt = Math.min(Math.max((now - hw.last) / 1000, 0.01), 2); hw.last = now;
  if (sm.Ta !== undefined) { S.Ta = sm.Ta; H.Ta = true; }
  if (sm.I !== undefined) { S.I = S.mI = sm.I; H.I = true; }
  if (sm.U !== undefined) { S.U = S.mU = sm.U; H.U = true; }
  if (sm.acc !== undefined) { S.acc = sm.acc; H.acc = true; }
  if (sm.vdc !== undefined) { S.vdc = sm.vdc; H.vdc = true; }
  if (sm.soc !== undefined) { S.soc = sm.soc; H.soc = true; }
  H.S = H.U && H.I; S.S = S.mS = H.S ? SQ3 * S.U * S.I / 1000 : 0;
  if (sm.ats === 1 || sm.ats === 2) { S.in1 = sm.ats === 1 ? 'closed' : 'open'; S.ats = sm.ats === 2 ? 'closed' : 'open'; H.sw = true; }
  if (typeof sm.in1 === 'boolean') { S.in1 = sm.in1 ? 'closed' : 'open'; H.sw = true; }
  if (typeof sm.dgu === 'boolean') { S.dgu = sm.dgu ? 'active' : 'standby'; H.sw = true; }
  S.live = isLive(); S.link.ina = H.I;
  /* температура + фильтр Кирхгофа: одиночный скачок ИК при неизменном токе нефизичен → держим оценку hold_s секунд */
  if (sm.T !== undefined) {
    const raw = sm.T, gOn = plugOn('PINN-KIRCHHOFF-GUARD'), gp = plugP('PINN-KIRCHHOFF-GUARD'), hold = (+gp.hold_s || 6) * 1000, tol = 6;
    H.T = true; S.Traw = raw; if (hw.est === null) hw.est = raw;
    const steady = !H.I || hw.lastI === null || Math.abs(S.I - hw.lastI) <= 0.1 * Math.max(S.I, 50);
    const jump = hw.lastT !== null && Math.abs(raw - hw.lastT) > tol && Math.abs(raw - hw.est) > tol;
    if (gOn && steady && jump) {
      S.guard.until = now + hold; S.guard.raw = Math.max(S.guard.raw, raw);
      if (!S.spoofSeen) { S.spoofSeen = true; emit('abai:spoof', { raw, filtered: hw.est }); }
    }
    hw.lastT = raw; hw.lastI = H.I ? S.I : null;
    S.guard.active = gOn && now < S.guard.until; if (!S.guard.active) { S.guard.raw = 0; if (now - S.guard.until > 30000) S.spoofSeen = false; hw.est = lerpk(hw.est, raw, dt, 1.5); }
    S.guard.est = hw.est; S.Tt = hw.est; S.T = S.guard.active ? hw.est : raw;
  }
  /* R_k и RUL — из измерений: ΔP = (T − T_возд) / R_тепл,  R_k = ΔP / I² */
  H.Rk = H.rul = false;
  if (H.T && H.I && S.I >= 150) {
    const rk = Math.max(0, (S.T - (H.Ta ? S.Ta : C.TAMB)) / C.RTH) / (S.I * S.I) * 1e6;
    hw.rk = hw.rk === null ? rk : lerpk(hw.rk, rk, dt, 20); S.Rk = hw.rk; S.rul = rulOf(S.Rk); S.P = S.I * S.I * S.Rk * 1e-6; H.Rk = H.rul = true;
  }
  /* тревоги и АВР — те же правила, что у симулятора, но только по реальным данным */
  const energized = S.live, rulMin = +plugP('ATS-AUTO-TRANSFER').rul_min || C.RULEND;
  const heat = H.T && (S.T >= thr.T_max || (energized && H.Rk && S.rul <= rulMin + 0.001));
  if (S.alarm.active && S.alarm.acked && (S.alarm.kind === 'heat' || S.alarm.kind === 'false') && !heat && (!H.T || S.T < thr.T_max - 6)) clearAlarm();
  if (!S.alarm.active && heat && energized) {
    raiseAlarm('heat');                                                        // скачки ИК отсеял фильтр (S.T = оценка), значит устойчивое превышение — настоящее
    if (plugOn('ATS-AUTO-TRANSFER') && S.in1 === 'closed' && S.ats === 'open') transfer(true, 'heat');
  }
  const blackout = H.U && S.U < 5, carrying = blackout;
  if (blackout && !S.alarm.active) raiseAlarm('blackout');
  if (!blackout && S.alarm.active && S.alarm.kind === 'blackout') clearAlarm();
  S.src = blackout ? (S.dgu === 'active' ? 'DGU' : 'LTO') : (S.in1 === 'closed' ? 'IN1' : 'IN2');
  S.vibState = !H.acc ? 'off' : S.acc >= thr.A_max ? 'err' : S.acc >= 0.75 * thr.A_max ? 'warn' : 'ok';
  S.ltoState = carrying && S.dgu !== 'active' ? 'discharge' : S.dgu === 'active' ? 'charge' : 'standby';
  const r = (v, lim) => (v >= lim ? 'err' : v >= 0.9 * lim ? 'warn' : 'ok');
  S.status = {
    'MLX90614-IR-01': !H.T ? 'off' : (S.alarm.active && (S.alarm.kind === 'heat' || S.alarm.kind === 'false') && S.T >= thr.T_max ? 'err' : (S.guard.active || (H.Rk && S.Rk > 40) || r(S.T, thr.T_max) === 'warn' ? 'warn' : 'ok')),
    'INA219-CUR-01': !H.I ? 'off' : (blackout ? 'warn' : r(S.I, thr.I_max)),
    'MPU6050-VIB-01': S.vibState,
    'LTO-BAT-BUF': !H.vdc ? 'off' : (S.vdc < thr.U_min ? 'err' : (carrying || S.vdc < thr.U_min + 6 ? 'warn' : 'ok'))
  };
  S.ts = now;
  const gap = 1000 / (ST().get('tele') || 4) - 8;
  if (now - hw.lastEmit < gap) return true;                                    // экран обновляем с частотой tele, пакеты могут идти чаще
  hw.lastEmit = now; publish(now, false); return true;
}

function loop() {
  const now = Date.now(); let dt = (now - last) / 1000; last = now; if (dt <= 0) return;
  if (S.source === 'sim') step(Math.min(dt, 0.6));
  else if (S.source === 'none' && now - hbAt >= 1000) { hbAt = now; S.ts = now; emit('abai:sim', S); }     // OFFLINE: раз в секунду подтверждаем «нет данных»
}
function restartTimer() { clearInterval(timer); if (S.running) timer = setInterval(loop, Math.round(1000 / (ST().get('tele') || 4))); }
function start() {
  if (S.running) return;
  const live = !!(HWL() && HWL().isFresh && HWL().isFresh());
  fresh(); S.running = true; last = Date.now(); syncPlugins();
  if (live) { S.source = 'hw'; S.have = allHave(false); }
  else if (DEMO()) startSim('none');
  else { S.source = 'none'; S.have = allHave(false); }
  emit('abai:source', { source: S.source, prev: 'none' });
  restartTimer();
}
function stop() { clearInterval(timer); timer = 0; S.running = false; const H = PH(); if (H) H.stop(); pluginErr = {}; fresh(); }

/* ---------- потоки энергии / данных по рёбрам графа (0…1, знак = направление a→b) ---------- */
function flows() {
  const f = {};
  if (S.source === 'none') { TOPO.edges.forEach(e => { f[e.id] = 0; }); return f; }                     // OFFLINE: по линиям ничего не течёт
  const live = isLive(), via2 = live && S.in1 === 'open' && S.ats === 'closed', p1 = live && S.in1 === 'closed', dgu = S.dgu === 'active', blk = S.have.U ? S.U < 5 : false, ina = S.link.ina;
  f.e_in1_joint = p1 ? 1 : 0; f.e_joint_bus1 = p1 ? 1 : 0;
  f.e_in2_bus2 = live ? (via2 ? 1 : 0.14) : 0; f.e_bus2_ats = via2 ? 1 : 0; f.e_ats_bus1 = via2 ? 1 : 0;
  f.e_ir_joint = S.have.T ? 0.4 : 0; f.e_cur_bus1 = ina ? 0.4 : 0; f.e_vib_bus1 = S.have.acc ? 0.35 : 0;
  f.e_ir_core = S.have.T ? 0.55 : 0; f.e_cur_core = ina ? 0.55 : 0; f.e_vib_core = S.have.acc ? 0.5 : 0;
  f.e_core_ats = Date.now() < S.cmdUntil ? 1 : 0.05;
  f.e_lto_core = blk ? 1 : 0.12; f.e_lto_ats = blk ? 0.6 : 0; f.e_dgu_lto = dgu ? 1 : (S.dgu === 'starting' ? 0.4 : 0); f.e_dgu_bus1 = dgu ? 0.8 : 0;
  return f;
}
const alarmNode = () => (S.alarm.active ? (S.alarm.kind === 'blackout' ? 'bus1' : 'joint') : '');
const wipe = () => { S.guard.until = 0; };
fresh();

g.addEventListener('abai:auth', e => { if (e.detail && e.detail.type === 'login') start(); else if (e.detail && e.detail.type === 'logout') stop(); });
g.addEventListener('abai:settings', e => { if (e.detail && e.detail.key === 'tele') restartTimer(); });
g.addEventListener('abai:plugins', () => { if (S.running) syncPlugins(); });
g.addEventListener('abai:hw', e => {
  const d = e.detail || {}; if (!S.running) return;
  if (d.type === 'sample') ingest(d.sample);
  else if (d.type === 'stale') lostHw();
  else if (d.type === 'state' && (d.state === 'idle' || d.state === 'error')) lostHw();
});
if (PH()) PH().onResult(onPluginResult);
g.PINN = { C, TOPO, state: () => S, series: k => series[k] || { t: [], v: [], r: [] }, packets: () => packets.slice(), flows, alarmNode, pluginErrors: () => pluginErr,
  start, stop, ack, reset: () => reset(false), scenario, act, transfer: () => act('transfer'), rulOf, wipe, isRunning: () => S.running, source: () => S.source, ingest, isLive };
})(window);
