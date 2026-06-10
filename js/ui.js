// UI wiring — DOM, drawing, and the glue between engine, session, store, cues.
// This is the page's entry module.

import * as engine from './engine.js';
import * as session from './session.js';
import * as cues from './cues.js';
import { settings, saveSettings } from './store.js';

const $ = id => document.getElementById(id);

// Canvas colors (canvas can't read CSS vars; keep in sync with :root tokens)
const ACCENT = '#6f64b8';
const WAVE_FILL = '#211b41';
const PEAK_DOT = '#a89ee0';
const FAINT = '#544a85';

let wakeLock = null;
let lastSummary = null;

// --- Breathing orb ---
// All orb motion routes through setOrbScale() so the upcoming pacer feature can
// drive the orb from a target rhythm instead of the measured signal.
const orbEl = $('orb');
let orbScale = 1, orbTarget = 1;
function setOrbScale(value) {
  orbTarget = Math.max(0.96, Math.min(1.06, value));
}
function orbFrame() {
  const d = orbTarget - orbScale;
  if (Math.abs(d) > 0.0004) {
    orbScale += d * 0.06;
    orbEl.style.transform = `scale(${orbScale.toFixed(4)})`;
  }
  requestAnimationFrame(orbFrame);
}
requestAnimationFrame(orbFrame);

// --- Session progress ring + quiet meta line ---
const RING_C = 304.7; // matches stroke-dasharray of .progress-ring .bar
let metaAxis = '—', metaBreaths = 0, metaElapsed = '0:00';
function updateMetaLine() {
  let line = `signal: ${metaAxis} · ${metaBreaths} breaths · ${metaElapsed}`;
  if (session.isActive()) line += ` / ${session.duration()}:00`;
  $('metaLine').textContent = line;
}
function updateProgressRing() {
  const frac = session.isActive() ? session.progress() : 0;
  $('progressBar').style.strokeDashoffset = (RING_C * (1 - frac)).toFixed(1);
}

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
  $('bpmLabel').textContent = sec ? 'seconds per breath' : 'breaths per minute';
  $('summaryUnitsWord').textContent = sec ? 'avg seconds per breath' : 'avg breaths per minute';
  $('summaryLowestLabel').textContent = sec ? 'slowest' : 'lowest';
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
  $('readyBadge').textContent = a.ready ? 'ready ✓' : 'calibrating…';
  $('readyBadge').classList.toggle('ready', a.ready);
  metaAxis = a.axisLabel;
  metaBreaths = a.recentCount;
  updateMetaLine();

  // Drive the orb from the latest filtered sample (display only; the pacer can
  // take over later by calling setOrbScale from its own rhythm instead).
  setOrbScale(a.trace.filt.length ? 1.01 + 0.05 * a.orbNorm : 1);

  drawTrace(a.trace);
}

// --- Drawing ---
function drawTrace({ timestamps, filt, peaks }) {
  const c = $('trace');
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = c.width = c.offsetWidth * dpr;
  const h = c.height = c.offsetHeight * dpr;
  ctx.clearRect(0, 0, w, h);
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

  const tStart = tSlice[0];
  const tSpan = (tSlice[tSlice.length - 1] - tStart) || 1;
  const xOf = t => ((t - tStart) / tSpan) * w;
  const yOf = v => h - ((v - min + pad) / (range + 2 * pad)) * h;

  // soft area fill under the curve
  ctx.fillStyle = WAVE_FILL;
  ctx.beginPath();
  ctx.moveTo(xOf(tSlice[0]), h);
  for (let i = 0; i < fSlice.length; i++) {
    ctx.lineTo(xOf(tSlice[i]), yOf(fSlice[i]));
  }
  ctx.lineTo(xOf(tSlice[tSlice.length - 1]), h);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = ACCENT;
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
      ctx.fillStyle = PEAK_DOT;
      ctx.beginPath();
      ctx.arc(xOf(p.t), yOf(p.value), 3.5 * dpr, 0, Math.PI * 2);
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
  ctx.clearRect(0, 0, w, h);
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

  // soft area fill under the curve
  ctx.fillStyle = WAVE_FILL;
  ctx.beginPath();
  ctx.moveTo(xOf(ts[0]), h);
  for (let i = 0; i < vals.length; i++) {
    ctx.lineTo(xOf(ts[i]), yOf(vals[i]));
  }
  ctx.lineTo(xOf(ts[ts.length - 1]), h);
  ctx.closePath();
  ctx.fill();

  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 1 * dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.beginPath();
  ctx.moveTo(0, yOf(avg));
  ctx.lineTo(w, yOf(avg));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = ACCENT;
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
  metaElapsed = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  updateMetaLine();
  updateProgressRing();
  if (session.isActive() && session.timerExpired()) {
    finishSession();
  }
}

function finishSession() {
  const summary = session.end();
  styleStartButton(false);
  updateProgressRing();
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
  btn.textContent = active ? 'end session early' : `start ${session.duration()}-min`;
  btn.classList.toggle('secondary', !active);
  btn.classList.toggle('danger', active);
}

function beginSession() {
  cues.unlockAudio();
  session.start();
  $('quickStart').style.display = 'none';
  styleStartButton(true);
  updateProgressRing();
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
  updateProgressRing();
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
