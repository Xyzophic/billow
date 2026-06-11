// UI wiring — DOM, drawing, and the glue between engine, session, store, cues.
// This is the page's entry module.

import * as engine from './engine.js';
import * as session from './session.js';
import * as cues from './cues.js';
import * as pacer from './pacer.js';
import { exportHistoryCsv, shareSummaryImage } from './export.js';
import { settings, saveSettings, loadHistory, addToHistory } from './store.js';

const $ = id => document.getElementById(id);

// Canvas colors (canvas can't read CSS vars; keep in sync with :root tokens)
const DARK_MQ = matchMedia('(prefers-color-scheme: dark)');
const CANVAS_LIGHT = { accent: '#20808d', waveFill: '#20808d1a', peakDot: '#176975', faint: '#b8b5ac' };
const CANVAS_DARK = { accent: '#2a98a5', waveFill: '#2a98a52b', peakDot: '#6fbfc9', faint: '#5f615b' };
const canvasColors = () => DARK_MQ.matches ? CANVAS_DARK : CANVAS_LIGHT;

let wakeLock = null;
let lastSummary = null;

// Live-trace y-axis easing. The raw min/max of the visible window would zoom
// out instantly on a movement spike, squashing the breathing wave to a flat
// line. Easing the bounds (and clamping the drawn line to them) keeps small
// movements from disrupting the picture; big jolts are handled by freezing.
let easedMin = null, easedMax = null;
const TRACE_RANGE_EASE = 0.15;

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

pacer.init({
  onScale: setOrbScale,
  onCue: txt => { $('pacerCue').textContent = txt; },
});

function syncPacer() {
  // The pacer guides the orb only during an active session, and only when enabled.
  if (session.isActive() && settings.pacer > 0) {
    pacer.start(settings.pacer, settings.pacerVibe);
  } else {
    pacer.stop();
  }
}

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
  if ($('historyView').style.display === 'block') renderHistory();
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
  if (engine.isListening()) return; // double-tap on enable while the permission prompt is open
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
  if (!a.trace.filt.length) { easedMin = easedMax = null; } // fresh signal → re-ease

  // During a jolt, freeze the last calm frame and cover it with a "settling…"
  // overlay; hold the orb steady too, rather than show the recovery wobble.
  $('traceWrap').classList.toggle('noisy', a.noisy);
  if (a.noisy) return;

  // Drive the orb from the latest filtered sample — unless the pacer owns it.
  if (!pacer.isActive()) {
    setOrbScale(a.trace.filt.length ? 1.01 + 0.05 * a.orbNorm : 1);
  }

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
  // Ease the bounds toward the instantaneous range so a transient spike nudges
  // the scale gently instead of snapping the wave flat.
  if (easedMin === null) { easedMin = min; easedMax = max; }
  else {
    easedMin += (min - easedMin) * TRACE_RANGE_EASE;
    easedMax += (max - easedMax) * TRACE_RANGE_EASE;
  }
  min = easedMin; max = easedMax;
  const range = (max - min) || 1;
  const pad = range * 0.15;

  const tStart = tSlice[0];
  const tSpan = (tSlice[tSlice.length - 1] - tStart) || 1;
  const xOf = t => ((t - tStart) / tSpan) * w;
  // Clamp into the canvas so a spike beyond the eased range can't shoot off-frame.
  const yOf = v => {
    const y = h - ((v - min + pad) / (range + 2 * pad)) * h;
    return y < 0 ? 0 : y > h ? h : y;
  };

  const col = canvasColors();
  // soft area fill under the curve
  ctx.fillStyle = col.waveFill;
  ctx.beginPath();
  ctx.moveTo(xOf(tSlice[0]), h);
  for (let i = 0; i < fSlice.length; i++) {
    ctx.lineTo(xOf(tSlice[i]), yOf(fSlice[i]));
  }
  ctx.lineTo(xOf(tSlice[tSlice.length - 1]), h);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = col.accent;
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
      ctx.fillStyle = col.peakDot;
      ctx.beginPath();
      ctx.arc(xOf(p.t), yOf(p.value), 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Soft area chart shared by the summary and history views.
function drawSoftChart(c, xs, vals, dots) {
  if (!c.offsetWidth) { requestAnimationFrame(() => drawSoftChart(c, xs, vals, dots)); return; }
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = c.width = c.offsetWidth * dpr;
  const h = c.height = c.offsetHeight * dpr;
  ctx.clearRect(0, 0, w, h);
  if (vals.length < 2) return;

  let minV = Math.min(...vals);
  let maxV = Math.max(...vals);
  const range = (maxV - minV) || 1;
  const pad = range * 0.15;
  minV -= pad; maxV += pad;

  const xStart = xs[0];
  const xSpan = (xs[xs.length - 1] - xStart) || 1;
  const inset = dots ? 6 * dpr : 0; // keep edge dots inside the canvas
  const xOf = x => inset + ((x - xStart) / xSpan) * (w - 2 * inset);
  const yOf = v => h - ((v - minV) / (maxV - minV)) * h;

  const col = canvasColors();
  // soft area fill under the curve
  ctx.fillStyle = col.waveFill;
  ctx.beginPath();
  ctx.moveTo(xOf(xs[0]), h);
  for (let i = 0; i < vals.length; i++) {
    ctx.lineTo(xOf(xs[i]), yOf(vals[i]));
  }
  ctx.lineTo(xOf(xs[xs.length - 1]), h);
  ctx.closePath();
  ctx.fill();

  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  ctx.strokeStyle = col.faint;
  ctx.lineWidth = 1 * dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.beginPath();
  ctx.moveTo(0, yOf(avg));
  ctx.lineTo(w, yOf(avg));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = col.accent;
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  for (let i = 0; i < vals.length; i++) {
    const x = xOf(xs[i]);
    const y = yOf(vals[i]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (dots) {
    ctx.fillStyle = col.peakDot;
    for (let i = 0; i < vals.length; i++) {
      ctx.beginPath();
      ctx.arc(xOf(xs[i]), yOf(vals[i]), 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const onSchemeChange = () => {
  // the live trace redraws on its own tick; refresh whichever chart view is open
  if ($('summaryView').style.display === 'block' && lastSummary) renderSummary(lastSummary);
  if ($('historyView').style.display === 'block') renderHistory();
};
// MediaQueryList.addEventListener is Safari 14+; fall back rather than crash on older iOS
if (typeof DARK_MQ.addEventListener === 'function') DARK_MQ.addEventListener('change', onSchemeChange);
else if (typeof DARK_MQ.addListener === 'function') DARK_MQ.addListener(onSchemeChange);

function drawSummaryChart(points) {
  const vals = points.map(p => settings.units === 'sec' ? 60 / p.bpm : p.bpm);
  drawSoftChart($('summaryChart'), points.map(p => p.t), vals, false);
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
  syncPacer();
  styleStartButton(false);
  updateProgressRing();
  cues.endHaptic();
  if (settings.chime) cues.chime();
  if (!summary) {
    setStatus('Session ended, but not enough breathing was detected to build a summary. Check the phone is resting flat on your belly and try again.', 'error');
    return;
  }
  lastSummary = summary;
  const r2 = v => Math.round(v * 100) / 100;
  addToHistory({
    t: Date.now(),
    durationSec: Math.round(summary.durationSec),
    avg: r2(summary.avg),
    start: r2(summary.start),
    end: r2(summary.end),
    lowest: r2(summary.lowest),
  });
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
  const goalLine = $('goalLine');
  if (settings.goal > 0) {
    const met = s.avg < settings.goal;
    goalLine.textContent = met
      ? `goal met ✓ — avg ${s.avg.toFixed(1)} under ${settings.goal}/min`
      : `goal: avg ${s.avg.toFixed(1)} vs under ${settings.goal}/min`;
    goalLine.classList.toggle('met', met);
    goalLine.style.display = 'block';
  } else {
    goalLine.style.display = 'none';
  }
  drawSummaryChart(s.points);
}

// --- History view ---
let historyReturn = 'main';

function fmtWhen(t) {
  const d = new Date(t);
  const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`.toLowerCase();
}

function fmtDur(durationSec) {
  return `${Math.floor(durationSec / 60)}:${String(Math.floor(durationSec % 60)).padStart(2, '0')}`;
}

// Day-streak stats from history. A streak is consecutive calendar days with
// at least one session; the current streak survives until a full day is missed.
function computeStreaks(hist) {
  const days = [...new Set(hist.map(r => new Date(r.t).setHours(0, 0, 0, 0)))].sort((a, b) => a - b);
  let best = 0, run = 0, prev = null;
  for (const d of days) {
    run = (prev !== null && Math.round((d - prev) / 86400000) === 1) ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  const today = new Date().setHours(0, 0, 0, 0);
  const last = days[days.length - 1];
  const current = (last === today || Math.round((today - last) / 86400000) === 1) ? run : 0;
  return { current, best };
}

function renderHistory() {
  const hist = loadHistory();
  const sec = settings.units === 'sec';
  $('historyEmpty').style.display = hist.length ? 'none' : 'block';
  $('historyChart').style.display = hist.length >= 2 ? 'block' : 'none';

  $('streakRow').style.display = hist.length ? 'grid' : 'none';
  if (hist.length) {
    const { current, best } = computeStreaks(hist);
    $('streakCur').textContent = `${current}d`;
    $('streakBest').textContent = `${best}d`;
    if (settings.goal > 0) {
      $('goalsMetLabel').textContent = `goals met (<${settings.goal})`;
      $('goalsMet').textContent = `${hist.filter(r => r.avg < settings.goal).length}/${hist.length}`;
    } else {
      $('goalsMetLabel').textContent = 'sessions';
      $('goalsMet').textContent = String(hist.length);
    }
  }

  const list = $('historyList');
  list.textContent = '';
  for (const r of hist.slice(-50).reverse()) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = fmtWhen(r.t);
    const stats = document.createElement('span');
    stats.textContent = `${fmtDur(r.durationSec)} · avg ${fmtRate(r.avg)} · ${sec ? 'slow' : 'low'} ${fmtRate(r.lowest)}`;
    row.append(when, stats);
    list.appendChild(row);
  }

  $('historyCount').textContent = !hist.length ? '' :
    hist.length > 50 ? `showing last 50 of ${hist.length} sessions` :
    `${hist.length} session${hist.length === 1 ? '' : 's'}`;
  $('csvBtn').style.display = hist.length ? 'block' : 'none';

  if (hist.length >= 2) {
    drawSoftChart($('historyChart'), hist.map((r, i) => i), hist.map(r => sec ? 60 / r.avg : r.avg), true);
  }
}

function showHistory(from) {
  historyReturn = from;
  $('mainSection').style.display = 'none';
  $('summaryView').style.display = 'none';
  $('usageNote').style.display = 'none';
  $('historyView').style.display = 'block';
  renderHistory();
}

$('csvBtn').addEventListener('click', () => exportHistoryCsv(loadHistory()));
$('shareBtn').addEventListener('click', async () => {
  if (!lastSummary) return;
  const outcome = await shareSummaryImage(lastSummary, settings.units);
  if (outcome === 'failed') setStatus('Could not create the share image on this device. Try again, or screenshot the summary instead.', 'error');
});
$('historyBtn').addEventListener('click', () => showHistory('main'));
$('historyBtn2').addEventListener('click', () => showHistory('summary'));
$('historyBackBtn').addEventListener('click', () => {
  $('historyView').style.display = 'none';
  if (historyReturn === 'summary') {
    $('summaryView').style.display = 'block';
  } else {
    $('mainSection').style.display = 'block';
    $('usageNote').style.display = 'block';
  }
});

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
  syncPacer();
  $('quickStart').style.display = 'none';
  styleStartButton(true);
  updateProgressRing();
  requestWakeLock();
}

function startedStatus(prefix) {
  const guide = settings.pacer > 0 ? `Pacer at ${settings.pacer}/min — breathe with the orb.` : 'Slow your breath.';
  setStatus(`${prefix} ${guide}`, 'success');
}

$('startBtn').addEventListener('click', () => {
  if (session.isActive()) {
    finishSession();
    setStatus('Session ended early.', 'success');
    return;
  }
  beginSession();
  startedStatus(`${session.duration()}-min session started.`);
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
  syncPacer();
  styleStartButton(false);
  updateProgressRing();
  setStatus('Reset. Listening fresh.', 'success');
});

$('newSessionBtn').addEventListener('click', () => {
  $('summaryView').style.display = 'none';
  $('mainSection').style.display = 'block';
  $('usageNote').style.display = 'block';
  beginSession();
  startedStatus(`New ${session.duration()}-min session started.`);
});

// --- Pacer + goal controls ---
function applyPacerControls() {
  $('pacerSelect').value = String(settings.pacer);
  $('pacerVibeRow').style.display = settings.pacer > 0 ? 'flex' : 'none';
  $('pacerVibeBtn').classList.toggle('on', settings.pacerVibe);
  $('goalSelect').value = String(settings.goal);
}

$('goalSelect').addEventListener('change', () => {
  settings.goal = parseInt($('goalSelect').value, 10) || 0;
  saveSettings();
  if (lastSummary && $('summaryView').style.display === 'block') renderSummary(lastSummary);
});

$('pacerSelect').addEventListener('change', () => {
  settings.pacer = parseInt($('pacerSelect').value, 10) || 0;
  saveSettings();
  applyPacerControls();
  syncPacer(); // takes effect immediately mid-session
});

$('pacerVibeBtn').addEventListener('click', () => {
  settings.pacerVibe = !settings.pacerVibe;
  saveSettings();
  applyPacerControls();
  syncPacer();
});

function setStatus(msg, type) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
}

applyUnits();
applyPacerControls();

// --- PWA ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
