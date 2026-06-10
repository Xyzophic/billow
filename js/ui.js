// UI wiring — DOM, drawing, and the glue between engine, session, store, cues.
// This is the page's entry module.

import * as engine from './engine.js';
import * as session from './session.js';
import * as cues from './cues.js';
import { settings, saveSettings } from './store.js';

const $ = id => document.getElementById(id);

let wakeLock = null;
let lastSummary = null;

// --- Display units (bpm vs seconds per breath) ---
// Everything is measured and stored in bpm; units only change formatting.
function fmtRate(bpm) {
  if (bpm === null || bpm === undefined || isNaN(bpm)) return '—';
  return (settings.units === 'sec' ? 60 / bpm : bpm).toFixed(1);
}

function applyUnits() {
  const sec = settings.units === 'sec';
  $('unitsBpm').classList.toggle('on', !sec);
  $('unitsSec').classList.toggle('on', sec);
  $('bpmLabel').textContent = sec ? 'Seconds per breath' : 'Breaths per minute';
  $('summaryUnitsWord').textContent = sec ? 'avg seconds per breath' : 'avg breaths per minute';
  $('summaryLowestLabel').textContent = sec ? 'Slowest' : 'Lowest';
  if (lastSummary) renderSummary(lastSummary);
}

for (const [btnId, units] of [['unitsBpm', 'bpm'], ['unitsSec', 'sec']]) {
  $(btnId).addEventListener('click', () => {
    settings.units = units;
    saveSettings();
    applyUnits();
  });
}

// --- Capability check ---
const hasMotion = typeof DeviceMotionEvent !== 'undefined';
const looksLikeDesktop = !('ontouchstart' in window) && !navigator.maxTouchPoints;
if (!hasMotion || looksLikeDesktop) {
  $('supportedUI').style.display = 'none';
  $('unsupported').style.display = 'block';
  $('selfUrl').textContent = location.href;
}

// --- Permission + listening ---
$('enableBtn').addEventListener('click', async () => {
  if (hasMotion && typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const result = await DeviceMotionEvent.requestPermission();
      if (result !== 'granted') {
        return setStatus('Motion permission denied. To use Billow, allow motion access: close this tab, reopen the page, and tap Allow.', 'error');
      }
      startListening();
    } catch (e) {
      setStatus('Could not request motion access. Reload the page and tap the button again.', 'error');
    }
  } else if (hasMotion) {
    startListening();
  } else {
    setStatus('Motion sensors not available. Open this page on your phone.', 'error');
  }
});

function startListening() {
  engine.restartClock();
  $('mainSection').style.display = 'block';
  $('enableBtn').style.display = 'none';
  $('qsEnable').style.display = 'none';
  setStatus('Listening. Lie down, phone on belly, breathe normally.', 'success');
  window.addEventListener('devicemotion', engine.handleMotion);
  setInterval(updateAnalysis, 500);
  setInterval(updateClock, 1000);
  requestWakeLock();
}

// --- Keep the screen awake (phone is lying on a belly — it must not sleep) ---
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) { /* low battery or not visible — non-fatal */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && engine.isListening() && wakeLock === null) {
    requestWakeLock();
  }
});

// --- Live readout ---
function updateAnalysis() {
  const a = engine.analyze();
  if (!a) return;
  if (a.bpm !== null) session.record(a.bpm);
  $('bpmNum').textContent = fmtRate(a.bpm);
  $('confidence').textContent = a.statusText;
  $('activeAxis').textContent = a.axisLabel;
  $('peakCount').textContent = a.recentCount;
  $('readyBadge').textContent = a.ready ? 'ready ✓' : 'calibrating…';
  $('readyBadge').classList.toggle('ready', a.ready);
  drawTrace(a.trace);
}

// --- Drawing ---
function drawTrace({ timestamps, filt, peaks }) {
  const c = $('trace');
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = c.width = c.offsetWidth * dpr;
  const h = c.height = c.offsetHeight * dpr;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, w, h);
  if (filt.length < 2 || timestamps.length < 2) return;

  const TRACE_SECONDS = 30;
  const now = timestamps[timestamps.length - 1];
  const traceStart = now - TRACE_SECONDS * 1000;
  let startIdx = 0;
  while (startIdx < timestamps.length && timestamps[startIdx] < traceStart) startIdx++;
  const tSlice = timestamps.slice(startIdx);
  const fSlice = filt.slice(startIdx);
  if (fSlice.length < 2) return;

  let min = Infinity, max = -Infinity;
  for (const v of fSlice) { if (v < min) min = v; if (v > max) max = v; }
  const range = (max - min) || 1;
  const pad = range * 0.15;

  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

  const tStart = tSlice[0];
  const tSpan = (tSlice[tSlice.length - 1] - tStart) || 1;
  const xOf = t => ((t - tStart) / tSpan) * w;
  const yOf = v => h - ((v - min + pad) / (range + 2 * pad)) * h;

  ctx.strokeStyle = '#ff6b35';
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  for (let i = 0; i < fSlice.length; i++) {
    const x = xOf(tSlice[i]);
    const y = yOf(fSlice[i]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  for (const p of peaks) {
    if (p.t >= tStart && p.t <= tStart + tSpan) {
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(xOf(p.t), yOf(p.value), 5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSummaryChart(points) {
  const c = $('summaryChart');
  if (!c.offsetWidth) { requestAnimationFrame(() => drawSummaryChart(points)); return; }
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = c.width = c.offsetWidth * dpr;
  const h = c.height = c.offsetHeight * dpr;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, w, h);
  if (points.length < 2) return;

  const vals = points.map(p => settings.units === 'sec' ? 60 / p.bpm : p.bpm);
  const ts = points.map(p => p.t);
  let minV = Math.min(...vals);
  let maxV = Math.max(...vals);
  const range = (maxV - minV) || 1;
  const pad = range * 0.15;
  minV -= pad; maxV += pad;

  const tStart = ts[0];
  const tSpan = (ts[ts.length - 1] - tStart) || 1;
  const xOf = t => ((t - tStart) / tSpan) * w;
  const yOf = v => h - ((v - minV) / (maxV - minV)) * h;

  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1 * dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.beginPath();
  ctx.moveTo(0, yOf(avg));
  ctx.lineTo(w, yOf(avg));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#ff6b35';
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  for (let i = 0; i < vals.length; i++) {
    const x = xOf(ts[i]);
    const y = yOf(vals[i]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// --- Session timer ---
function updateClock() {
  if (!engine.isListening()) return;
  const elapsed = Math.floor(engine.elapsedSec());
  $('elapsed').textContent = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  if (session.isActive() && session.timerExpired()) {
    finishSession();
  }
}

function finishSession() {
  const summary = session.end();
  styleStartButton(false);
  cues.endHaptic();
  if (settings.chime) cues.chime();
  if (!summary) {
    setStatus('Session ended, but not enough breathing was detected to build a summary. Check the phone is resting flat on your belly and try again.', 'error');
    return;
  }
  lastSummary = summary;
  $('mainSection').style.display = 'none';
  $('usageNote').style.display = 'none';
  $('summaryView').style.display = 'block';
  renderSummary(summary); // after unhiding — the chart canvas needs a real width
}

function renderSummary(s) {
  const mins = Math.floor(s.durationSec / 60);
  const secs = Math.floor(s.durationSec % 60);
  $('summaryAvgBpm').textContent = fmtRate(s.avg);
  $('summaryDuration').textContent = `${mins}:${String(secs).padStart(2, '0')}`;
  $('summaryStart').textContent = fmtRate(s.start);
  $('summaryEnd').textContent = fmtRate(s.end);
  $('summaryLowest').textContent = fmtRate(s.lowest);
  drawSummaryChart(s.points);
}

// --- Controls ---
function styleStartButton(active) {
  const btn = $('startBtn');
  btn.textContent = active ? 'End session early' : `Start ${session.duration()}-min`;
  btn.classList.toggle('secondary', !active);
  btn.classList.toggle('danger', active);
}

function beginSession() {
  cues.unlockAudio();
  session.start();
  $('quickStart').style.display = 'none';
  styleStartButton(true);
  requestWakeLock();
}

$('startBtn').addEventListener('click', () => {
  if (session.isActive()) {
    finishSession();
    setStatus('Session ended early.', 'success');
    return;
  }
  beginSession();
  setStatus(`${session.duration()}-min session started. Slow your breath.`, 'success');
});

$('durationSelect').addEventListener('change', () => {
  session.setDuration(parseInt($('durationSelect').value, 10));
  if (!session.isActive()) {
    styleStartButton(false);
  }
});

$('resetBtn').addEventListener('click', () => {
  engine.restartClock();
  session.clear();
  styleStartButton(false);
  setStatus('Reset. Listening fresh.', 'success');
});

$('newSessionBtn').addEventListener('click', () => {
  $('summaryView').style.display = 'none';
  $('mainSection').style.display = 'block';
  $('usageNote').style.display = 'block';
  beginSession();
  setStatus(`New ${session.duration()}-min session started.`, 'success');
});

function setStatus(msg, type) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
}

applyUnits();

// --- PWA ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
