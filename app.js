'use strict';
/* ============================================================
 * Pomodoro · London Christmas — app.js
 *
 * สารบัญ
 *   1) ตัวช่วยพื้นฐาน + การเก็บข้อมูลในเครื่อง (localStorage)
 *   2) สถิติ
 *   3) เสียงกระดิ่ง (Web Audio API)
 *   4) ตัวจับเวลา Pomodoro
 *   5) เครื่องเล่นเพลง (IndexedDB + <audio>)
 *   6) ฉากหลัง (หิมะ ไฟประดับ ตึก นาฬิกา)
 *   7) หน้าตั้งค่า + PWA
 *   8) เริ่มต้นการทำงาน
 * ============================================================ */

/* ---------- 1) ตัวช่วยพื้นฐาน ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const pad2 = (n) => String(n).padStart(2, '0');
const rand = (a, b) => a + Math.random() * (b - a);

const KEY = { settings: 'pomo.settings', stats: 'pomo.stats', session: 'pomo.session', player: 'pomo.player', order: 'pomo.order' };

// อ่าน/เขียน JSON ใน localStorage แบบปลอดภัย (บางโหมดส่วนตัวของเบราว์เซอร์จะ throw error)
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch (_) { /* ใช้ค่าเริ่มต้น */ }
  return { ...fallback };
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* เก็บไม่ได้ก็ข้ามไป */ }
}

// ข้อความแจ้งเตือนเล็ก ๆ ด้านล่างจอ
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ---------- ค่าตั้งต้น ---------- */
const DEFAULTS = {
  focus: 25, short: 5, long: 15,   // นาที
  every: 4,                        // พักยาวทุกกี่รอบ
  autoNext: false,                 // เริ่มช่วงถัดไปเองหรือไม่
  autoMusic: true,                 // เล่นเพลงตอนโฟกัส หยุดตอนพัก
  bell: true,                      // เสียงกระดิ่งเมื่อจบรอบ
  wake: true,                      // กันหน้าจอดับตอนจับเวลา
  motion: null,                    // null = ตามระบบ, true/false = ผู้ใช้เลือกเอง
  scene: 'london',                 // ฉากหลัง: london | window | shop | fireplace | lights
  glass: 45                        // ความโปร่งใสของแผง 0–80 (%) ยิ่งมากยิ่งเห็นฉากหลังชัด
};
const settings = loadJSON(KEY.settings, DEFAULTS);
function sanitizeSettings() {
  const num = (v, d, lo, hi) => clamp(Math.round(Number(v)) || d, lo, hi);
  settings.focus = num(settings.focus, 25, 1, 180);
  settings.short = num(settings.short, 5, 1, 60);
  settings.long = num(settings.long, 15, 1, 120);
  settings.every = num(settings.every, 4, 2, 8);
  settings.glass = clamp(Math.round(Number(settings.glass)), 0, 80);
  if (Number.isNaN(settings.glass)) settings.glass = DEFAULTS.glass;
}
sanitizeSettings();

/* ---------- 2) สถิติ ---------- */
// โครงสร้าง: { days: { '2026-11-24': { rounds: 3, minutes: 75 } } }
const stats = loadJSON(KEY.stats, { days: {} });
if (!stats.days || typeof stats.days !== 'object') stats.days = {};

const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const WEEKDAY = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

function addRound(minutes) {
  const k = dayKey();
  const day = stats.days[k] || (stats.days[k] = { rounds: 0, minutes: 0 });
  day.rounds += 1;
  day.minutes += minutes;
  // เก็บย้อนหลังไม่เกิน 400 วัน
  const keys = Object.keys(stats.days).sort();
  while (keys.length > 400) delete stats.days[keys.shift()];
  saveJSON(KEY.stats, stats);
  renderStats();
}

function fmtMinutes(m) {
  if (m < 60) return `${m}`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}:${pad2(r)} ชม.` : `${h} ชม.`;
}

// จำนวนวันที่ทำต่อเนื่อง (ถ้าวันนี้ยังไม่ได้ทำ จะนับถึงเมื่อวาน)
function streakDays() {
  const d = new Date();
  if (!(stats.days[dayKey(d)] && stats.days[dayKey(d)].rounds)) d.setDate(d.getDate() - 1);
  let n = 0;
  while (stats.days[dayKey(d)] && stats.days[dayKey(d)].rounds) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function renderStats() {
  const today = stats.days[dayKey()] || { rounds: 0, minutes: 0 };
  $('#statRounds').textContent = today.rounds;
  $('#statMinutes').textContent = fmtMinutes(today.minutes);
  $('#statStreak').textContent = streakDays();
  const total = Object.values(stats.days).reduce((s, d) => s + (d.rounds || 0), 0);
  $('#statTotal').textContent = total ? `ทั้งหมด ${total} รอบ` : '';

  // กราฟแท่ง 7 วันล่าสุด
  const box = $('#bars');
  box.textContent = '';
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push({ d, rounds: (stats.days[dayKey(d)] || {}).rounds || 0, today: i === 0 });
  }
  const max = Math.max(4, ...days.map((x) => x.rounds));
  for (const x of days) {
    const bar = document.createElement('div');
    bar.className = 'bar' + (x.today ? ' today' : '');
    bar.title = `${x.rounds} รอบ`;
    const num = document.createElement('span'); num.className = 'num'; num.textContent = x.rounds || '';
    const fill = document.createElement('div'); fill.className = 'fill'; fill.style.height = `${(x.rounds / max) * 72}%`;
    const lab = document.createElement('span'); lab.textContent = WEEKDAY[x.d.getDay()];
    bar.append(num, fill, lab);
    box.append(bar);
  }
}

/* ---------- 3) เสียงกระดิ่ง (สังเคราะห์ด้วย Web Audio API ไม่มีไฟล์เสียง) ---------- */
let actx = null;

// เบราว์เซอร์ (โดยเฉพาะ iOS) อนุญาตให้เล่นเสียงได้หลังผู้ใช้แตะหน้าจอเท่านั้น
// จึงเรียกฟังก์ชันนี้ตอนกดปุ่ม "เริ่ม" เพื่อ "ปลดล็อก" ระบบเสียงไว้ก่อน
function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = actx || new AC();
    if (actx.state === 'suspended') actx.resume();
  } catch (_) { /* ไม่รองรับก็ข้าม */ }
}

// เสียงระฆังจริงมีส่วนประกอบหลายความถี่ (partials) ที่ไม่เป็นจำนวนเต็มเท่า — ใส่ลงไปให้ได้เสียง "กริ๊ง"
const BELL_PARTIALS = [ // [อัตราส่วนความถี่, ความดัง, เวลาจาง (วินาที)]
  [1.00, 1.00, 2.8], [2.01, 0.45, 2.0], [2.76, 0.32, 1.4], [4.07, 0.16, 0.9], [5.40, 0.10, 0.6]
];
function strike(freq, when, vol, out) {
  for (const [ratio, amp, decay] of BELL_PARTIALS) {
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol * amp, when + 0.006);          // ตีปุ๊บดังทันที
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);        // แล้วค่อย ๆ จางหาย
    osc.connect(g).connect(out);
    osc.start(when);
    osc.stop(when + decay + 0.05);
  }
}
function ringBell(force = false) {
  if (!settings.bell && !force) return;
  unlockAudio();
  if (!actx) return;
  const master = actx.createGain();
  master.gain.value = 0.32;
  master.connect(actx.destination);
  const t = actx.currentTime + 0.03;
  // อาร์เพจจิโอคอร์ดซอลเมเจอร์ G5 B5 D6 G6 — กระดิ่งสั้น ๆ สดใส
  [784, 987.8, 1174.7, 1568].forEach((f, i) => strike(f, t + i * 0.17, i === 3 ? 0.9 : 0.6, master));
  duckMusic(2600);
}

/* ---------- 4) ตัวจับเวลา Pomodoro ---------- */
const MODES = ['focus', 'short', 'long'];
const MODE_LABEL = { focus: 'โฟกัส', short: 'พักสั้น', long: 'พักยาว' };
const PHASE_TEXT = { focus: 'ช่วงโฟกัส', short: 'พักสั้น · ยืดเส้นยืดสาย', long: 'พักยาว · จิบโกโก้ร้อน ๆ' };
const durMs = (mode) => settings[mode] * 60000;

// สถานะของตัวจับเวลา
//  - ขณะเดินอยู่ เก็บ "เวลาสิ้นสุด" (endAt) แล้วคำนวณเวลาที่เหลือจากนาฬิกาจริงทุกครั้ง
//    ทำให้เวลาไม่เพี้ยนแม้แท็บอยู่เบื้องหลังหรือจอดับ
const T = { mode: 'focus', cycle: 0, running: false, endAt: 0, remaining: 0 };
(function restoreSession() {
  const s = loadJSON(KEY.session, {});
  T.mode = MODES.includes(s.mode) ? s.mode : 'focus';
  T.cycle = clamp(Math.floor(+s.cycle) || 0, 0, settings.every);
  const full = durMs(T.mode);
  T.remaining = s.remaining > 0 ? Math.min(s.remaining, full) : full;
  if (s.running && s.endAt > Date.now()) {       // ปิดแอปตอนที่ยังเดินอยู่ → เดินต่อ
    T.running = true;
    T.endAt = s.endAt;
    T.remaining = Math.min(s.endAt - Date.now(), full);
  } else if (s.running) {                        // ครบเวลาไปตอนที่แอปปิดอยู่ → เริ่มช่วงนั้นใหม่แบบหยุดไว้
    T.remaining = full;
  }
})();

let ticker = null;
const el = {
  time: $('#time'), phase: $('#phaseLabel'), round: $('#roundLabel'), pips: $('#pips'),
  prog: $('#ringProg'), head: $('#ringHead'), start: $('#btnStart'), startLabel: $('#startLabel')
};
const CIRC = 2 * Math.PI * Number(el.prog.getAttribute('r'));
el.prog.style.strokeDasharray = String(CIRC);

function persist() {
  saveJSON(KEY.session, { mode: T.mode, cycle: T.cycle, running: T.running, endAt: T.endAt, remaining: T.remaining });
}

function render() {
  const total = durMs(T.mode);
  const rem = clamp(T.remaining, 0, total);
  const secs = Math.ceil(rem / 1000);
  const text = `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`;
  el.time.textContent = text;
  document.title = `${text} · ${MODE_LABEL[T.mode]} — Pomodoro ลอนดอน`;

  // วงแหวนความคืบหน้า: เต็มตอนเริ่ม แล้วค่อย ๆ หมดไปตามเวลา
  const p = total ? rem / total : 0;
  el.prog.style.strokeDashoffset = String(CIRC * (1 - p));
  el.head.style.transform = `rotate(${360 * p}deg)`;
  el.head.style.opacity = p > 0.004 ? '1' : '0';

  document.body.dataset.mode = T.mode;
  document.body.dataset.running = String(T.running);
  document.querySelectorAll('.mode-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === T.mode)));

  el.phase.textContent = PHASE_TEXT[T.mode];
  if (T.mode === 'focus') el.round.textContent = `รอบที่ ${Math.min(T.cycle + 1, settings.every)} จาก ${settings.every}`;
  else if (T.mode === 'short') el.round.textContent = `เก่งมาก! ทำไปแล้ว ${T.cycle} รอบ`;
  else el.round.textContent = `ครบ ${settings.every} รอบแล้ว เก่งมาก!`;

  // จุดแสดงรอบ (●●○○)
  if (el.pips.children.length !== settings.every) {
    el.pips.textContent = '';
    for (let i = 0; i < settings.every; i++) { const d = document.createElement('i'); d.className = 'pip'; el.pips.append(d); }
  }
  [...el.pips.children].forEach((d, i) => {
    d.classList.toggle('done', i < T.cycle);
    d.classList.toggle('now', T.mode === 'focus' && i === T.cycle);
  });

  // ปุ่มเริ่ม/หยุด
  const icon = el.start.querySelector('use');
  if (T.running) { icon.setAttribute('href', '#i-pause'); el.startLabel.textContent = 'หยุด'; }
  else { icon.setAttribute('href', '#i-play'); el.startLabel.textContent = rem < total ? 'ต่อ' : 'เริ่ม'; }
}

function tick() {
  if (!T.running) return;
  T.remaining = T.endAt - Date.now();
  if (T.remaining <= 0) { T.remaining = 0; render(); finishPhase(true); return; }
  render();
}

function startTimer() {
  unlockAudio();                                   // ปลดล็อกเสียงตอนผู้ใช้กดปุ่ม
  if (T.remaining <= 0) T.remaining = durMs(T.mode);
  T.running = true;
  T.endAt = Date.now() + T.remaining;
  if (!ticker) ticker = setInterval(tick, 250);
  render(); persist(); syncMusic(); updateWake();
}

function pauseTimer() {
  if (!T.running) return;
  T.remaining = Math.max(0, T.endAt - Date.now());
  T.running = false;
  clearInterval(ticker); ticker = null;
  render(); persist(); syncMusic(); updateWake();
}

function toggleTimer() { T.running ? pauseTimer() : startTimer(); }

function resetTimer() {
  pauseTimer();
  T.remaining = durMs(T.mode);
  render(); persist();
}

function setMode(mode) {
  pauseTimer();
  T.mode = mode;
  T.remaining = durMs(mode);
  render(); persist(); syncMusic();
}

// จบช่วงปัจจุบัน แล้วไปช่วงถัดไป
//  natural = true  → ครบเวลาจริง (นับรอบ/เล่นเสียงกระดิ่ง)
//  natural = false → ผู้ใช้กด "ข้าม" (ไม่นับรอบ)
function finishPhase(natural) {
  const prev = T.mode;
  if (natural) {
    if (prev === 'focus') { T.cycle += 1; addRound(settings.focus); }
    ringBell();
    if (navigator.vibrate) navigator.vibrate([220, 120, 220]);
  }
  let next;
  if (prev === 'focus') next = natural && T.cycle >= settings.every ? 'long' : 'short';
  else { next = 'focus'; if (prev === 'long') T.cycle = 0; }

  if (natural) toast(next === 'focus' ? 'พักเสร็จแล้ว กลับมาโฟกัสกัน!' : prev === 'focus' ? 'จบรอบโฟกัส เยี่ยมมาก! พักสักครู่' : 'พักเสร็จแล้ว');

  T.mode = next;
  T.remaining = durMs(next);
  T.running = false;
  clearInterval(ticker); ticker = null;

  if (natural && settings.autoNext) { startTimer(); return; }
  render(); persist(); syncMusic(); updateWake();
}

// กันหน้าจอดับขณะจับเวลา (Screen Wake Lock) — ช่วยให้ได้ยินเสียงกระดิ่งบนมือถือ
let wakeLock = null;
async function updateWake() {
  try {
    const want = settings.wake && T.running && document.visibilityState === 'visible' && 'wakeLock' in navigator;
    if (want && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      const w = wakeLock; wakeLock = null; await w.release();
    }
  } catch (_) { wakeLock = null; }
}

// ผูกเพลงกับตัวจับเวลา: ถ้าเปิดตัวเลือกไว้ → เล่นเฉพาะตอนกำลังโฟกัสและนาฬิกาเดินอยู่
function syncMusic() {
  if (!settings.autoMusic) return;
  if (T.running && T.mode === 'focus') playMusic();
  else pauseMusic();
}

/* ---------- 5) เครื่องเล่นเพลง ---------- */
const audio = $('#audio');
const P = { tracks: [], currentId: null, shuffle: false, loop: 'all', history: [], seen: new Set(), url: null, seeking: false, errorStreak: 0 };
const pref = loadJSON(KEY.player, { volume: 0.8, shuffle: false, loop: 'all', last: null });
P.shuffle = !!pref.shuffle;
P.loop = ['all', 'one', 'off'].includes(pref.loop) ? pref.loop : 'all';
pref.volume = clamp(Number(pref.volume), 0, 1);
if (Number.isNaN(pref.volume)) pref.volume = 0.8;
audio.volume = pref.volume;

/* --- 5.1 IndexedDB: เก็บไฟล์เพลง (Blob) ไว้ในเครื่อง เล่นออฟไลน์ได้ --- */
const dbp = new Promise((resolve, reject) => {
  if (!('indexedDB' in window)) { reject(new Error('IndexedDB ไม่พร้อมใช้งาน')); return; }
  const req = indexedDB.open('pomodoro-london', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
dbp.catch(() => {});

// ช่วยรันคำสั่งกับ object store แล้วคืนผลลัพธ์เมื่อ transaction สำเร็จ
function dbRun(mode, fn) {
  return dbp.then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('tracks', mode);
    const req = fn(tx.objectStore('tracks'));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = tx.onabort = () => reject(tx.error);
  }));
}

// ลำดับเพลงเก็บแยกใน localStorage (เป็นรายการ id) เพื่อไม่ต้องเขียนไฟล์เพลงลง DB ซ้ำทุกครั้งที่สลับลำดับ
function getOrder() {
  try { const a = JSON.parse(localStorage.getItem(KEY.order)); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}
function saveOrder() {
  try { localStorage.setItem(KEY.order, JSON.stringify(P.tracks.map((t) => t.id))); } catch (_) { /* ข้าม */ }
}

async function loadTracks() {
  try {
    const rows = await dbRun('readonly', (s) => s.getAll());
    const order = getOrder();
    const pos = (id) => { const i = order.indexOf(id); return i < 0 ? 1e9 + id : i; };
    rows.sort((a, b) => pos(a.id) - pos(b.id));
    P.tracks = rows;
    saveOrder();
  } catch (_) {
    P.tracks = [];
    toast('เปิดที่เก็บเพลงในเครื่องไม่ได้ (อาจอยู่ในโหมดส่วนตัว)');
  }
  if (pref.last != null && idxOf(pref.last) >= 0) loadTrack(pref.last);
  else if (P.tracks.length) loadTrack(P.tracks[0].id);
  renderPlaylist();
  updateNow();
}

/* --- 5.2 ชื่อไฟล์/ชนิดไฟล์ --- */
const AUDIO_EXT = /\.(mp3|m4a|wav|aac|ogg|oga|opus|flac|webm)$/i;
const isAudioFile = (f) => (f.type && f.type.startsWith('audio/')) || AUDIO_EXT.test(f.name);
function guessType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ({ mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
            opus: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm' })[ext] || 'audio/mpeg';
}
// ตัดนามสกุลออก + normalize เป็น NFC เพื่อให้สระ/วรรณยุกต์ไทยจากไฟล์ที่มาจาก macOS แสดงถูกต้อง
const cleanName = (n) => n.replace(/\.[^.]+$/, '').normalize('NFC').trim() || 'ไม่มีชื่อ';
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtTime = (s) => (Number.isFinite(s) && s >= 0 ? `${Math.floor(s / 60)}:${pad2(Math.floor(s % 60))}` : '0:00');
const idxOf = (id) => P.tracks.findIndex((t) => t.id === id);

/* --- 5.3 เพิ่ม/ลบ/เรียงเพลง --- */
async function addFiles(fileList) {
  const files = [...fileList];
  let added = 0, skipped = 0;
  for (const f of files) {
    if (!isAudioFile(f)) { skipped++; continue; }
    const name = cleanName(f.name);
    if (P.tracks.some((t) => t.size === f.size && t.name === name)) { skipped++; continue; }
    try {
      const type = f.type || guessType(f.name);
      const rec = { name, type, size: f.size, added: Date.now(), blob: f.type ? f : new Blob([f], { type }) };
      rec.id = await dbRun('readwrite', (s) => s.add(rec));
      P.tracks.push(rec);
      added++;
    } catch (e) {
      toast(e && e.name === 'QuotaExceededError' ? 'พื้นที่เก็บข้อมูลเต็ม เพิ่มเพลงไม่ได้' : 'เพิ่มเพลงบางไฟล์ไม่สำเร็จ');
      break;
    }
  }
  saveOrder();
  if (added && P.currentId == null) loadTrack(P.tracks[0].id);
  renderPlaylist(); updateNow();
  if (added) {
    toast(`เพิ่มเพลงแล้ว ${added} เพลง` + (skipped ? ` (ข้าม ${skipped} ไฟล์)` : ''));
    // ขอให้เบราว์เซอร์ "เก็บถาวร" ไม่ลบไฟล์เพลงเมื่อพื้นที่ในเครื่องเหลือน้อย
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } else if (skipped) toast('ไม่มีไฟล์เพลงใหม่ที่เพิ่มได้ (ซ้ำ หรือไม่ใช่ไฟล์เสียง)');
}

async function removeTrack(id) {
  const t = P.tracks[idxOf(id)];
  if (!t || !confirm(`ลบเพลง “${t.name}” ออกจากเครื่องเล่น?`)) return;
  try { await dbRun('readwrite', (s) => s.delete(id)); } catch (_) { toast('ลบเพลงไม่สำเร็จ'); return; }
  if (id === P.currentId) {
    audio.pause();
    audio.removeAttribute('src'); audio.load();
    if (P.url) { URL.revokeObjectURL(P.url); P.url = null; }
    P.currentId = null;
  }
  P.tracks.splice(idxOf(id), 1);
  P.history = P.history.filter((h) => h !== id);
  saveOrder();
  if (P.currentId == null && P.tracks.length) loadTrack(P.tracks[0].id);
  renderPlaylist(); updateNow();
}

function moveTrack(id, dir) {
  const i = idxOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= P.tracks.length) return;
  [P.tracks[i], P.tracks[j]] = [P.tracks[j], P.tracks[i]];
  saveOrder();
  renderPlaylist();
}

/* --- 5.4 การเล่น --- */
function loadTrack(id) {
  const t = P.tracks[idxOf(id)];
  if (!t) return false;
  if (P.url) URL.revokeObjectURL(P.url);
  P.url = URL.createObjectURL(t.blob);
  audio.src = P.url;
  audio.loop = P.loop === 'one';
  P.currentId = id;
  pref.last = id; saveJSON(KEY.player, pref);
  updateNow(); renderPlaylist();
  return true;
}

function playTrack(id) {
  if (id !== P.currentId || !audio.getAttribute('src')) { if (!loadTrack(id)) return Promise.resolve(false); }
  P.seen.add(id);
  return audio.play().then(() => true, () => false);
}

// เล่น (ต่อ) เพลงปัจจุบัน — ถ้ายังไม่ได้เลือกเพลงจะเริ่มจากเพลงแรก (หรือสุ่มถ้าเปิดสลับสุ่ม)
function playMusic() {
  if (!P.tracks.length) return Promise.resolve(false);
  if (P.currentId == null || idxOf(P.currentId) < 0) {
    const id = P.shuffle ? P.tracks[Math.floor(Math.random() * P.tracks.length)].id : P.tracks[0].id;
    return playTrack(id);
  }
  if (!audio.getAttribute('src')) loadTrack(P.currentId);
  P.seen.add(P.currentId);
  return audio.play().then(() => true, () => false);
}
function pauseMusic() { if (!audio.paused) audio.pause(); }

// เลือกเพลงถัดไป/ก่อนหน้า
function pickNext(dir, auto) {
  const n = P.tracks.length;
  if (!n) return null;
  const cur = idxOf(P.currentId);
  if (P.shuffle && n > 1) {
    let pool = P.tracks.filter((t) => t.id !== P.currentId);
    if (auto && P.loop === 'off') {                    // สุ่มแบบเล่นครบทุกเพลงแล้วหยุด
      pool = pool.filter((t) => !P.seen.has(t.id));
      if (!pool.length) return null;
    }
    return pool[Math.floor(Math.random() * pool.length)].id;
  }
  if (cur < 0) return P.tracks[dir > 0 ? 0 : n - 1].id;
  const i = cur + dir;
  if (i >= n || i < 0) {
    if (auto && P.loop === 'off' && dir > 0) return null;   // จบลิสต์ → หยุด
    return P.tracks[i < 0 ? n - 1 : 0].id;
  }
  return P.tracks[i].id;
}

function nextTrack(auto = false) {
  const id = pickNext(1, auto);
  if (id == null) { audio.pause(); audio.currentTime = 0; P.seen.clear(); return; }
  if (P.currentId != null) { P.history.push(P.currentId); if (P.history.length > 50) P.history.shift(); }
  playTrack(id);
}
function prevTrack() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let id = null;
  while (P.history.length && id == null) { const h = P.history.pop(); if (idxOf(h) >= 0) id = h; }
  if (id == null) id = pickNext(-1, false);
  if (id != null) playTrack(id);
}

// ลดเสียงเพลงลงชั่วคราวตอนกระดิ่งดัง (บน iOS ปรับ volume ของ <audio> ไม่ได้ จะไม่มีผล)
let duckTimer;
function duckMusic(ms) {
  if (audio.paused) return;
  audio.volume = pref.volume * 0.3;
  clearTimeout(duckTimer);
  duckTimer = setTimeout(() => { audio.volume = pref.volume; }, ms);
}

/* --- 5.5 แสดงผลเครื่องเล่น --- */
const ui = {
  nowTitle: $('#nowTitle'), cur: $('#curTime'), dur: $('#durTime'), seek: $('#seek'), vol: $('#volume'),
  play: $('#btnPlay'), shuffle: $('#btnShuffle'), loop: $('#btnLoop'), list: $('#playlist')
};
const setIcon = (btn, id) => btn.querySelector('use').setAttribute('href', `#${id}`);
const fillRange = (input) => input.style.setProperty('--fill', `${(input.value - input.min) / (input.max - input.min) * 100}%`);

function updateNow() {
  const t = P.tracks[idxOf(P.currentId)];
  ui.nowTitle.textContent = t ? t.name : (P.tracks.length ? 'แตะเพลงเพื่อเริ่มเล่น' : 'ยังไม่ได้เลือกเพลง');
  ui.nowTitle.title = t ? t.name : '';
  setIcon(ui.play, audio.paused ? 'i-play' : 'i-pause');
  document.body.dataset.playing = String(!audio.paused);
  ui.shuffle.setAttribute('aria-pressed', String(P.shuffle));
  ui.loop.setAttribute('aria-pressed', String(P.loop !== 'off'));
  setIcon(ui.loop, P.loop === 'one' ? 'i-loop1' : 'i-loop');
  ui.loop.setAttribute('aria-label', { all: 'เล่นวนทั้งลิสต์', one: 'เล่นวนเพลงเดียว', off: 'ไม่เล่นวน' }[P.loop]);
  if ('mediaSession' in navigator && t) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.name, artist: 'Pomodoro · London Christmas',
        artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }]
      });
    } catch (_) { /* ข้าม */ }
  }
}

function renderPlaylist() {
  const ul = ui.list;
  ul.textContent = '';
  $('#emptyList').hidden = P.tracks.length > 0;
  $('#trackCount').textContent = P.tracks.length ? `· ${P.tracks.length} เพลง` : '';
  const mini = (act, icon, label, disabled, extra = '') => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `mini ${extra}`.trim(); b.dataset.act = act; b.disabled = !!disabled;
    b.setAttribute('aria-label', label);
    b.innerHTML = `<svg class="ic"><use href="#${icon}"/></svg>`;   // ข้อความคงที่ ไม่มีข้อมูลจากผู้ใช้
    return b;
  };
  P.tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'track' + (t.id === P.currentId ? ' active' : '');
    li.dataset.id = t.id;

    const main = document.createElement('button');
    main.type = 'button'; main.className = 'track-main'; main.dataset.act = 'play';
    main.setAttribute('aria-label', `เล่น ${t.name}`);
    const idx = document.createElement('span'); idx.className = 'track-idx'; idx.textContent = i + 1;
    const eq = document.createElement('span'); eq.className = 'eq'; eq.innerHTML = '<i></i><i></i><i></i>';
    const text = document.createElement('span'); text.className = 'track-text';
    const name = document.createElement('span'); name.className = 'track-name'; name.textContent = t.name;   // textContent กัน XSS จากชื่อไฟล์
    const size = document.createElement('span'); size.className = 'track-size'; size.textContent = fmtSize(t.size);
    text.append(name, size);
    main.append(idx, eq, text);

    li.append(main,
      mini('up', 'i-up', 'เลื่อนขึ้น', i === 0),
      mini('down', 'i-down', 'เลื่อนลง', i === P.tracks.length - 1),
      mini('del', 'i-trash', `ลบ ${t.name}`, false, 'del'));
    ul.append(li);
  });
}

ui.list.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  const li = e.target.closest('li.track');
  if (!btn || !li) return;
  const id = Number(li.dataset.id);
  if (btn.dataset.act === 'play') {
    if (id === P.currentId && !audio.paused) audio.pause(); else playTrack(id);
  } else if (btn.dataset.act === 'up') moveTrack(id, -1);
  else if (btn.dataset.act === 'down') moveTrack(id, 1);
  else if (btn.dataset.act === 'del') removeTrack(id);
});

$('#btnAdd').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', (e) => { addFiles(e.target.files).finally(() => { e.target.value = ''; }); });

ui.play.addEventListener('click', () => { if (audio.paused) { playMusic().then((ok) => { if (!ok && P.tracks.length) toast('เล่นเพลงไม่ได้ ลองแตะอีกครั้ง'); }); } else audio.pause(); });
$('#btnNext').addEventListener('click', () => nextTrack(false));
$('#btnPrev').addEventListener('click', prevTrack);
ui.shuffle.addEventListener('click', () => { P.shuffle = !P.shuffle; P.seen.clear(); pref.shuffle = P.shuffle; saveJSON(KEY.player, pref); updateNow(); toast(P.shuffle ? 'สลับสุ่ม: เปิด' : 'สลับสุ่ม: ปิด'); });
ui.loop.addEventListener('click', () => {
  P.loop = { all: 'one', one: 'off', off: 'all' }[P.loop];
  audio.loop = P.loop === 'one';
  pref.loop = P.loop; saveJSON(KEY.player, pref);
  updateNow();
  toast({ all: 'เล่นวนทั้งลิสต์', one: 'เล่นวนเพลงเดียว', off: 'ไม่เล่นวน' }[P.loop]);
});

ui.vol.value = Math.round(pref.volume * 100); fillRange(ui.vol);
ui.vol.addEventListener('input', () => {
  pref.volume = ui.vol.value / 100; audio.volume = pref.volume; fillRange(ui.vol); saveJSON(KEY.player, pref);
});

// แถบเลื่อนตำแหน่งเพลง
ui.seek.addEventListener('input', () => { P.seeking = true; fillRange(ui.seek); if (Number.isFinite(audio.duration)) ui.cur.textContent = fmtTime(ui.seek.value / 1000 * audio.duration); });
ui.seek.addEventListener('change', () => { if (Number.isFinite(audio.duration)) audio.currentTime = ui.seek.value / 1000 * audio.duration; P.seeking = false; });

audio.addEventListener('timeupdate', () => {
  if (P.seeking) return;
  const d = audio.duration;
  ui.cur.textContent = fmtTime(audio.currentTime);
  if (Number.isFinite(d) && d > 0) { ui.seek.value = Math.round(audio.currentTime / d * 1000); } else ui.seek.value = 0;
  fillRange(ui.seek);
});
audio.addEventListener('loadedmetadata', () => { ui.dur.textContent = fmtTime(audio.duration); });
audio.addEventListener('durationchange', () => { ui.dur.textContent = fmtTime(audio.duration); });
audio.addEventListener('play', updateNow);
audio.addEventListener('pause', updateNow);
audio.addEventListener('playing', () => { P.errorStreak = 0; updateNow(); });
audio.addEventListener('ended', () => nextTrack(true));
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src')) return;
  const t = P.tracks[idxOf(P.currentId)];
  P.errorStreak += 1;
  toast(`เล่นไฟล์นี้ไม่ได้: ${t ? t.name : ''}`);
  if (P.errorStreak < P.tracks.length) nextTrack(true);
});

if ('mediaSession' in navigator) {
  const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch (_) { /* ไม่รองรับ */ } };
  set('play', () => playMusic());
  set('pause', () => audio.pause());
  set('nexttrack', () => nextTrack(false));
  set('previoustrack', prevTrack);
}

/* ---------- 6) ฉากหลัง ---------- */
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs, parent) => {
  const e = document.createElementNS(SVG_NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.append(e);
  return e;
};
// ตัวสุ่มแบบกำหนด seed ได้ ทำให้ตึก/หน้าต่างหน้าตาเหมือนเดิมทุกครั้งที่เปิดแอป
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// เกล็ดหิมะ: JS สร้าง <i> พร้อมตัวแปร CSS สุ่ม ส่วนการเคลื่อนไหวเป็น CSS animation ล้วน
function buildSnow() {
  const box = $('#snow');
  const n = window.innerWidth < 600 ? 38 : 70;
  for (let i = 0; i < n; i++) {
    const s = rand(2.5, 8);
    const f = document.createElement('i');
    f.style.cssText = `--x:${rand(0, 100).toFixed(1)}vw;--s:${s.toFixed(1)}px;--d:${(26 - s * 1.7 + rand(0, 6)).toFixed(1)}s;` +
      `--dl:${(-rand(0, 24)).toFixed(1)}s;--sw:${rand(-60, 60).toFixed(0)}px;--o:${rand(0.45, 0.95).toFixed(2)}`;
    box.append(f);
  }
}

// สายไฟประดับด้านบน
function buildLights() {
  const svg = $('#lights');
  const colors = ['#ffd36b', '#ff5a6e', '#fff3c4', '#ffb347', '#7be0b0'];
  for (let k = 0; k < 6; k++) {
    for (let j = 1; j <= 5; j++) {
      const t = j / 6;
      const x = -20 + 240 * k + 240 * t;
      const y = 12 + 124 * t * (1 - t);                // ตำแหน่งบนเส้นโค้งของสายไฟ
      const c = colors[Math.floor(Math.random() * colors.length)];
      const delay = `${(-rand(0, 3)).toFixed(2)}s`, dur = `${rand(1.8, 3.6).toFixed(2)}s`;
      const g = svgEl('g', { class: 'bulb', style: `animation-delay:${delay};animation-duration:${dur}` }, svg);
      svgEl('circle', { cx: x.toFixed(1), cy: (y + 4).toFixed(1), r: 9, fill: c, opacity: 0.22 }, g);
      svgEl('circle', { cx: x.toFixed(1), cy: (y + 4).toFixed(1), r: 3.8, fill: c }, g);
    }
  }
}

// แนวตึกสองชั้น (ไกล/ใกล้) พร้อมหน้าต่างไฟส้ม หลังคาจั่ว และปล่องไฟมีหิมะ
function buildSkyline() {
  const svg = $('#skyline');
  const rnd = mulberry32(2025);
  const layers = [
    { color: '#18235a', lit: 0.16, win: '#c9a35a', op: 0.9, snow: false,
      b: [[0, 90, 130], [80, 70, 170], [150, 100, 120], [250, 60, 150], [310, 110, 110], [420, 70, 160], [490, 90, 125],
          [580, 60, 175], [640, 100, 115], [740, 80, 150], [820, 110, 130], [930, 70, 165], [1000, 100, 120], [1100, 100, 150]] },
    { color: '#0c1433', lit: 0.32, win: '#ffd58a', op: 1, snow: true,
      b: [[0, 120, 90], [120, 80, 112], [200, 140, 80], [340, 70, 122], [410, 130, 95], [540, 90, 116], [630, 120, 86],
          [750, 80, 106], [830, 140, 92], [970, 90, 120], [1060, 140, 88]] }
  ];
  for (const L of layers) {
    const g = svgEl('g', { opacity: L.op }, svg);
    for (const [x, w, h] of L.b) {
      const top = 240 - h;
      svgEl('rect', { x, y: top, width: w, height: h + 2, fill: L.color }, g);
      if (L.snow) {
        if (rnd() < 0.5) {                                               // หลังคาจั่ว
          svgEl('polygon', { points: `${x - 2},${top} ${x + w / 2},${top - 16} ${x + w + 2},${top}`, fill: L.color }, g);
          svgEl('polygon', { points: `${x + w * 0.2},${top - 3} ${x + w / 2},${top - 16} ${x + w * 0.8},${top - 3} ${x + w / 2},${top - 7}`, fill: '#e6eeff', opacity: 0.85 }, g);
        } else svgEl('rect', { x: x - 1, y: top - 3, width: w + 2, height: 4, rx: 2, fill: '#e6eeff', opacity: 0.85 }, g);
        if (rnd() < 0.55) {                                              // ปล่องไฟ
          const cx = x + 8 + rnd() * (w - 24);
          svgEl('rect', { x: cx, y: top - 22, width: 8, height: 22, fill: L.color }, g);
          svgEl('rect', { x: cx - 1, y: top - 25, width: 10, height: 4, rx: 2, fill: '#e6eeff', opacity: 0.85 }, g);
        }
      }
      const cols = Math.floor((w - 10) / 14), rows = Math.floor((h - 14) / 20);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (rnd() < L.lit) svgEl('rect', { x: x + 6 + c * 14, y: top + 10 + r * 20, width: 7, height: 10, fill: L.win, opacity: (0.55 + rnd() * 0.45).toFixed(2) }, g);
      }
    }
  }
}

// เข็มนาฬิกาบนหอ เดินตามเวลาจริงของเครื่อง
function updateClock() {
  const now = new Date();
  const m = now.getMinutes() + now.getSeconds() / 60;
  const h = (now.getHours() % 12) + m / 60;
  $('#hHand').setAttribute('transform', `rotate(${(h * 30).toFixed(1)} 60 114)`);
  $('#mHand').setAttribute('transform', `rotate(${(m * 6).toFixed(1)} 60 114)`);
}

// เปิด/ปิดแอนิเมชัน: ถ้าผู้ใช้ไม่ได้เลือกเอง ให้ตามค่า prefers-reduced-motion ของระบบ
function motionOff() {
  return settings.motion === null ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : !settings.motion;
}
// ความโปร่งใสของแผง: ยิ่งโปร่ง ยิ่งลดการเบลอลงด้วย เพื่อให้เห็นรายละเอียดของฉากหลัง
function applyGlass() {
  const alpha = 0.7 * (1 - settings.glass / 100);
  const root = document.documentElement.style;
  root.setProperty('--glass-a', alpha.toFixed(3));
  root.setProperty('--blur', `${(4 + alpha * 28).toFixed(0)}px`);
  const input = $('#setGlass');
  input.value = settings.glass; fillRange(input);
  $('#glassVal').textContent = `${settings.glass}%`;
}
function applyMotion() { document.documentElement.dataset.motion = motionOff() ? 'off' : 'on'; }


/* ---------- ฉากหลังที่เลือกได้ ----------
 * ทุกฉากวาดด้วย SVG/CSS เอง (ไม่ใช้รูปถ่าย) — ส่วนที่ซ้ำ ๆ เช่น หลอดไฟ หน้าต่างตึก
 * ลูกแก้ว ให้ JS สร้างตอนเปิดฉากนั้นครั้งแรก เพื่อไม่ให้หน้าเว็บหนักโดยไม่จำเป็น */
const SCENES = [
  { id: 'london', name: 'ถนนลอนดอน', swatch: 'linear-gradient(180deg,#101e4c,#5b3f6e 68%,#a45a52)' },
  { id: 'window', name: 'หน้าต่างหิมะ', swatch: 'linear-gradient(120deg,#8d6a43 0,#8d6a43 30%,#d4dde8 31%,#8296ab 70%,#46665f)' },
  { id: 'shop', name: 'หน้าต่างร้านค้า', swatch: 'radial-gradient(circle at 50% 45%,#c8102e 0,#6a1a10 30%,#06080d 78%)' },
  { id: 'fireplace', name: 'เตาผิง', swatch: 'radial-gradient(circle at 50% 78%,#ffb347 0,#8a3a26 36%,#2a1814 80%)' },
  { id: 'lights', name: 'ลูกบอลไฟ', swatch: 'radial-gradient(circle at 30% 42%,#ffd98a 0,#4d7799 46%,#1f3d62 92%)' }
];
const builtScenes = new Set();

// จุดบนเส้นโค้ง Bezier ลูกบาศก์ (p = 4 จุดควบคุม) และเส้นโค้งกำลังสอง
function bez(p, t) {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]);
}
function quadPt(a, c, b, t) {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * a[k] + 2 * u * t * c[k] + t * t * b[k]);
}
const bezPath = (p) => `M${p[0][0]} ${p[0][1]}C${p[1][0]} ${p[1][1]} ${p[2][0]} ${p[2][1]} ${p[3][0]} ${p[3][1]}`;

// หลอดไฟดวงเดียว: วงแสงจาง ๆ + แกนสว่าง (กะพริบได้)
function addBulb(parent, x, y, color, rnd, r = 4, animate = true) {
  const g = svgEl('g', animate
    ? { class: 'bulb', style: `animation-delay:${(-rnd() * 3).toFixed(2)}s;animation-duration:${(1.8 + rnd() * 2.2).toFixed(2)}s` }
    : {}, parent);
  svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: (r * 2.5).toFixed(1), fill: color, opacity: 0.2 }, g);
  svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r, fill: color }, g);
}
function bulbsAlong(parent, p, n, colors, rnd, r = 4) {
  for (let i = 0; i < n; i++) {
    const [x, y] = bez(p, (i + 0.5) / n);
    addBulb(parent, x, y, colors[Math.floor(rnd() * colors.length)], rnd, r, rnd() < 0.7);
  }
}

// แสงโบเก้: วงกลมแสงฟุ้ง ๆ สุ่มตำแหน่ง ขยับช้า ๆ
function buildBokeh(box, rnd) {
  const palettes = { warm: ['255,196,102', '255,150,70', '255,224,160', '255,120,80'], gold: ['255,217,138', '255,236,190', '255,190,100', '255,130,120'] };
  const pal = palettes[box.dataset.palette] || palettes.warm;
  const n = Number(box.dataset.n) || 12;
  for (let i = 0; i < n; i++) {
    const b = document.createElement('i');
    const s = 36 + rnd() * 120;
    b.style.cssText = `--x:${(rnd() * 100).toFixed(1)}%;--y:${(rnd() * 100).toFixed(1)}%;--s:${s.toFixed(0)}px;` +
      `--c:${pal[Math.floor(rnd() * pal.length)]};--o:${(0.18 + rnd() * 0.4).toFixed(2)};--d:${(3 + rnd() * 5).toFixed(1)}s;animation-delay:${(-rnd() * 6).toFixed(1)}s`;
    box.append(b);
  }
}

function buildWindowScene(rnd) {
  // ชั้นหนังสือ: ไล่วางสันหนังสือสีต่าง ๆ ความสูงไม่เท่ากันบนชั้น 3 ชั้น
  const books = $('#w-books');
  const cols = ['#3b2a22', '#5a3326', '#2f3b34', '#6b4a2e', '#7a2f2a', '#2b2f45', '#8b7355', '#c9b48f', '#4a3a2a'];
  for (const base of [170, 340, 510]) {
    let x = 4;
    while (x < 290) {
      const w = 14 + rnd() * 16, h = 90 + rnd() * 55;
      svgEl('rect', { x: x.toFixed(1), y: (base - h).toFixed(1), width: w.toFixed(1), height: h.toFixed(1), fill: cols[Math.floor(rnd() * cols.length)], rx: 1.5 }, books);
      svgEl('rect', { x: (x + 2).toFixed(1), y: (base - h + 14).toFixed(1), width: (w - 4).toFixed(1), height: 3, fill: '#e8d6a8', opacity: 0.5 }, books);
      x += w + 1.5;
    }
  }
  // สายไฟประดับห้อยตามผนัง
  const g = $('#w-lights');
  const strands = [[[310, -10], [360, 150], [290, 330], [340, 560]], [[255, -10], [210, 130], [285, 270], [240, 440]]];
  strands.forEach((p, i) => {
    svgEl('path', { d: bezPath(p), fill: 'none', stroke: '#3a2a1c', 'stroke-width': 2 }, g);
    bulbsAlong(g, p, i ? 12 : 16, ['#ffe3a1', '#ffd36b', '#fff3c4'], rnd, 4.2);
  });
}

function buildShopScene(rnd) {
  // แสงโบเก้ภายในร้าน
  const bk = $('#s-bokeh');
  for (let i = 0; i < 46; i++) {
    const x = 456 + rnd() * 688, y = 96 + rnd() * 678, r = 5 + rnd() * 26, red = rnd() < 0.18;
    svgEl('circle', { cx: x.toFixed(0), cy: y.toFixed(0), r: (r * 2.2).toFixed(0), fill: `url(#${red ? 's-glowR' : 's-glow'})`, opacity: (0.25 + rnd() * 0.5).toFixed(2) }, bk);
    svgEl('circle', { cx: x.toFixed(0), cy: y.toFixed(0), r: (r * 0.5).toFixed(0), fill: red ? '#ff8a7a' : '#ffe3a1', opacity: (0.25 + rnd() * 0.3).toFixed(2) }, bk);
  }
  // ลูกแก้ว + ไฟบนพวงมาลัยด้านบน
  const gt = $('#s-garland-top');
  [0.08, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.92].forEach((t, i) => {
    const [x, y] = quadPt([440, 140], [800, 240], [1160, 140], t);
    svgEl('circle', { cx: x.toFixed(0), cy: (y + 4).toFixed(0), r: 12, fill: i % 2 ? 'url(#s-orb)' : 'url(#s-red)' }, gt);
    svgEl('circle', { cx: (x - 4).toFixed(0), cy: (y).toFixed(0), r: 3, fill: '#fff', opacity: 0.6 }, gt);
  });
  [0.14, 0.26, 0.38, 0.5, 0.62, 0.74, 0.86].forEach((t) => {
    const [x, y] = quadPt([440, 140], [800, 240], [1160, 140], t);
    addBulb(gt, x, y - 6, '#fff3c4', rnd, 3.5);
  });
  // กล่องปลูกต้นไม้ด้านล่าง: ผลเบอร์รีแดง หิมะ และไฟ
  const gb = $('#s-garland-bottom');
  for (let i = 0; i < 16; i++) {
    svgEl('ellipse', { cx: (410 + rnd() * 780).toFixed(0), cy: (798 + rnd() * 14).toFixed(0), rx: (14 + rnd() * 18).toFixed(0), ry: (5 + rnd() * 5).toFixed(0), fill: '#eef3fb', opacity: 0.92 }, gb);
  }
  for (let i = 0; i < 38; i++) {
    const x = 400 + rnd() * 800, y = 800 + rnd() * 40;
    svgEl('circle', { cx: x.toFixed(0), cy: y.toFixed(0), r: (4 + rnd() * 3).toFixed(1), fill: '#d3122e' }, gb);
    svgEl('circle', { cx: (x - 1.5).toFixed(1), cy: (y - 1.5).toFixed(1), r: 1.3, fill: '#fff', opacity: 0.6 }, gb);
  }
  for (let i = 0; i < 12; i++) addBulb(gb, 410 + rnd() * 780, 806 + rnd() * 36, '#ffe3a1', rnd, 3.2);
}

function buildFireplaceScene(rnd) {
  // ไฟประดับบนพวงมาลัยหิ้งเตาผิง
  const g = $('#f-garland');
  for (let i = 0; i < 26; i++) {
    const [x, y] = quadPt([470, 492], [800, 548], [1130, 492], (i + 0.5) / 26);
    addBulb(g, x, y - 4 + rnd() * 8, rnd() < 0.2 ? '#ffb347' : '#fff3c4', rnd, 4, rnd() < 0.6);
  }
  // ไฟประดับต้นคริสต์มาส: สุ่มจุดภายในรูปทรงต้นไม้
  const tl = $('#f-treeLights');
  const tiers = [[170, 380, 80], [290, 520, 110], [420, 680, 140], [550, 830, 170], [690, 962, 210]];
  for (let i = 0; i < 110; i++) {
    const [top, bottom, hw] = tiers[Math.floor(rnd() * tiers.length)];
    const y = top + (0.2 + rnd() * 0.8) * (bottom - top);
    const half = hw * (y - top) / (bottom - top);
    addBulb(tl, 1330 + (rnd() * 2 - 1) * half * 0.88, y, rnd() < 0.15 ? '#ffd36b' : '#fff3c4', rnd, 3.1, rnd() < 0.5);
  }
}

function buildLightsScene(rnd) {
  // ผนังตึกหินครีม: บัวคาดชั้น + หน้าต่าง (บางบานเปิดไฟ) + สายไฟตามบัว
  const f = $('#l-facade');
  const bands = [190, 410, 630, 850];
  for (const by of bands) {
    svgEl('rect', { x: -40, y: by, width: 1160, height: 30, fill: '#f0dfbf' }, f);
    svgEl('rect', { x: -40, y: by + 30, width: 1160, height: 8, fill: '#8f7752', opacity: 0.45 }, f);
    if (by === 850) continue;
    for (let c = 0; c < 8; c++) {
      const x = 30 + c * 135, y = by + 74, w = 78, h = 120;
      svgEl('rect', { x: x - 9, y: y - 9, width: w + 18, height: h + 18, rx: 6, fill: '#f3e6cc' }, f);
      const lit = rnd() < 0.42;
      svgEl('rect', { x, y, width: w, height: h, rx: 3, fill: lit ? '#ffcf7a' : 'url(#l-glass)', opacity: lit ? 0.9 : 1 }, f);
      if (!lit) svgEl('polygon', { points: `${x},${y} ${x + w * 0.55},${y} ${x},${y + h * 0.6}`, fill: '#cfe3f2', opacity: 0.18 }, f);
      svgEl('path', { d: `M${x + w / 2} ${y}V${y + h}M${x} ${y + h * 0.45}H${x + w}`, stroke: lit ? '#d9a950' : '#e8d9b6', 'stroke-width': 4, fill: 'none' }, f);
    }
    for (let x = -10; x < 1110; x += 30) addBulb(f, x, by + 46, rnd() < 0.2 ? '#ffb347' : '#ffe3a1', rnd, 3.4, rnd() < 0.5);
  }
  // กิ่งไม้เปลือย + หลอดไฟพันกิ่ง
  const br = $('#l-branches');
  const limbs = [
    { w: 34, p: [[-30, -30], [60, 140], [120, 260], [140, 430]] }, { w: 20, p: [[84, 170], [260, 150], [420, 200], [600, 110]] },
    { w: 15, p: [[600, 110], [660, 80], [720, 90], [820, 30]] }, { w: 18, p: [[120, 330], [280, 300], [420, 340], [640, 300]] },
    { w: 12, p: [[300, 170], [330, 100], [350, 50], [380, -10]] }, { w: 12, p: [[480, 200], [520, 260], [560, 300], [640, 300]] },
    { w: 22, p: [[1000, -20], [1030, 60], [1090, 120], [1180, 150]] }, { w: 14, p: [[1180, 150], [1260, 170], [1330, 160], [1440, 220]] },
    { w: 12, p: [[1090, 120], [1120, 200], [1110, 260], [1160, 320]] }
  ];
  for (const L of limbs) svgEl('path', { d: bezPath(L.p), stroke: '#2a1c15', 'stroke-width': L.w }, br);
  for (const L of limbs) bulbsAlong(br, L.p, L.w > 16 ? 11 : 7, ['#ffe3a1', '#ffd36b', '#fff3c4'], rnd, 3.6);
}

function buildScene(id) {
  if (builtScenes.has(id)) return;
  builtScenes.add(id);
  const set = document.querySelector(`.set-${id}`);
  if (!set) return;
  const rnd = mulberry32(id.length * 977 + id.charCodeAt(0));
  const bokeh = set.querySelector('.bokeh');
  if (bokeh) buildBokeh(bokeh, rnd);
  const fn = { window: buildWindowScene, shop: buildShopScene, fireplace: buildFireplaceScene, lights: buildLightsScene }[id];
  if (fn) fn(rnd);
}

// จอแนวตั้ง (มือถือ) เห็นภาพแค่แถบแคบ ๆ ตรงกลาง — เลื่อนไปทางขวาที่เป็นจุดเด่นของฉาก
const portraitMQ = window.matchMedia('(max-aspect-ratio: 1/1)');
function fitArt() {
  document.querySelectorAll('.set .art').forEach((svg) => {
    svg.setAttribute('preserveAspectRatio', portraitMQ.matches ? 'xMaxYMid slice' : 'xMidYMid slice');
  });
}
if (portraitMQ.addEventListener) portraitMQ.addEventListener('change', fitArt);

function applyScene() {
  fitArt();
  if (!SCENES.some((s) => s.id === settings.scene)) settings.scene = 'london';
  document.querySelector('.scene').dataset.scene = settings.scene;
  document.body.dataset.scene = settings.scene;
  buildScene(settings.scene);
  document.querySelectorAll('.scene-opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === settings.scene)));
}
function chooseScene(id) {
  settings.scene = id;
  saveJSON(KEY.settings, settings);
  applyScene();
}
function buildSceneGrid() {
  const grid = $('#sceneGrid');
  for (const sc of SCENES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'scene-opt'; b.dataset.id = sc.id; b.setAttribute('role', 'radio');
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = sc.swatch;
    const nm = document.createElement('span'); nm.textContent = sc.name;
    b.append(sw, nm);
    b.addEventListener('click', () => chooseScene(sc.id));
    grid.append(b);
  }
}

/* ---------- 7) หน้าตั้งค่า + PWA ---------- */
const dlg = $('#settingsDlg');
const inputs = { focus: $('#setFocus'), short: $('#setShort'), long: $('#setLong'), every: $('#setEvery') };
const LIMITS = { focus: [1, 180], short: [1, 60], long: [1, 120], every: [2, 8] };

function openSettings() {
  for (const k in inputs) inputs[k].value = settings[k];
  $('#setAutoNext').checked = settings.autoNext;
  $('#setBell').checked = settings.bell;
  $('#setWake').checked = settings.wake;
  $('#setMotion').checked = !motionOff();
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
}
$('#btnSettings').addEventListener('click', openSettings);
$('#btnCloseSettings').addEventListener('click', () => (dlg.close ? dlg.close() : dlg.removeAttribute('open')));
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // แตะนอกกล่องเพื่อปิด

for (const k in inputs) {
  inputs[k].addEventListener('change', () => {
    const [lo, hi] = LIMITS[k];
    settings[k] = clamp(Math.round(Number(inputs[k].value)) || DEFAULTS[k], lo, hi);
    inputs[k].value = settings[k];
    saveJSON(KEY.settings, settings);
    if (k === 'every') T.cycle = Math.min(T.cycle, settings.every);
    else if (!T.running) T.remaining = durMs(T.mode);      // แก้เวลาตอนหยุดอยู่ → เริ่มนับใหม่ตามเวลาที่ตั้ง
    render(); persist();
  });
}
const bindSwitch = (id, key, after) => $(id).addEventListener('change', (e) => { settings[key] = e.target.checked; saveJSON(KEY.settings, settings); if (after) after(); });
bindSwitch('#setAutoNext', 'autoNext');
bindSwitch('#setBell', 'bell');
bindSwitch('#setWake', 'wake', updateWake);
bindSwitch('#setMotion', 'motion', applyMotion);
$('#optAutoMusic').checked = settings.autoMusic;
bindSwitch('#optAutoMusic', 'autoMusic', syncMusic);

$('#setGlass').addEventListener('input', (e) => {
  settings.glass = Number(e.target.value);
  saveJSON(KEY.settings, settings);
  applyGlass();
});
$('#btnTestBell').addEventListener('click', () => { unlockAudio(); ringBell(true); });
$('#btnClearStats').addEventListener('click', () => {
  if (!confirm('ล้างสถิติทั้งหมดในเครื่องนี้?')) return;
  stats.days = {}; saveJSON(KEY.stats, stats); renderStats(); toast('ล้างสถิติแล้ว');
});

// ปุ่มติดตั้งแอป (Chrome/Edge/Android) — บน iOS ใช้เมนูแชร์ตามข้อความแนะนำ
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; $('#btnInstall').hidden = false; });
$('#btnInstall').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => {});
  installEvent = null; $('#btnInstall').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#btnInstall').hidden = true; toast('ติดตั้งแอปเรียบร้อย'); });

// Service worker: ทำให้เปิดแอปได้โดยไม่ต้องใช้อินเทอร์เน็ต
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(() => { $('#offlineBadge').hidden = false; })
      .catch(() => { /* เปิดผ่าน file:// หรือ http ที่ไม่ใช่ localhost จะลงทะเบียนไม่ได้ */ });
  });
}

/* ---------- 8) ปุ่มหลัก + เริ่มต้นการทำงาน ---------- */
$('#btnScene').addEventListener('click', () => {
  const i = SCENES.findIndex((x) => x.id === settings.scene);
  const next = SCENES[(i + 1) % SCENES.length];
  chooseScene(next.id);
  toast(`ฉากหลัง: ${next.name}`);
});
el.start.addEventListener('click', toggleTimer);
$('#btnReset').addEventListener('click', resetTimer);
$('#btnSkip').addEventListener('click', () => finishPhase(false));
document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => { if (b.dataset.mode !== T.mode) setMode(b.dataset.mode); }));

// กลับมาที่แอป (จอเปิดอีกครั้ง/สลับแท็บ) → คำนวณเวลาใหม่ทันที
document.addEventListener('visibilitychange', () => { tick(); updateWake(); renderStats(); });
window.addEventListener('pagehide', persist);

applyMotion();
applyGlass();
buildSceneGrid();
applyScene();
buildSnow();
buildLights();
buildSkyline();
updateClock(); setInterval(updateClock, 20000);
renderStats();
render();
if (T.running) ticker = setInterval(tick, 250);
loadTracks();
