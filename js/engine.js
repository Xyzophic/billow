// Breath detection engine — EMA bandpass (0.05–0.5 Hz), auto axis pick,
// prominence-based peak detection. User-validated; change tunables with care.

// --- Tunables ---
const SAMPLE_RATE_NOMINAL = 60;
const VARIANCE_WINDOW_SEC = 15;
const PEAK_WINDOW_SEC = 60;
const MIN_PEAK_DISTANCE_SEC = 2.5;
const BUFFER_SECONDS = 70;
const MOTION_GAP_RESET_MS = 3000; // backgrounded tab → stale buffers, start clean

// EMA bandpass coefficients (~0.05–0.5 Hz at 60 Hz)
const ALPHA_SLOW = 2 * Math.PI * 0.05 / SAMPLE_RATE_NOMINAL;
const ALPHA_FAST = 2 * Math.PI * 0.5 / SAMPLE_RATE_NOMINAL;

const AXIS_LABELS = { ag_x: 'tilt x', ag_y: 'tilt y', ag_z: 'lift z', rot_beta: 'rotation' };

// --- State ---
let clockStartT = null;
let lastMotionWallT = null;
let activeChannel = null;
let activePeaks = [];
let timestamps = [];

const channels = {
  ag_x: makeChan(),
  ag_y: makeChan(),
  ag_z: makeChan(),
  rot_beta: makeChan(),
};

function makeChan() {
  return { raw: [], emaSlow: 0, emaFast: 0, filt: [], inited: false };
}

export function isListening() {
  return clockStartT !== null;
}

export function restartClock() {
  clockStartT = Date.now();
  clearSignal();
}

export function elapsedSec() {
  return clockStartT === null ? 0 : (Date.now() - clockStartT) / 1000;
}

export function clearSignal() {
  timestamps = [];
  for (const k in channels) {
    channels[k].raw = [];
    channels[k].filt = [];
    channels[k].inited = false;
  }
  activePeaks = [];
}

export function handleMotion(e) {
  if (clockStartT === null) return;
  const nowWall = Date.now();
  // If the page was backgrounded, the buffers have a hole — restart the signal clean.
  if (lastMotionWallT !== null && nowWall - lastMotionWallT > MOTION_GAP_RESET_MS) {
    clearSignal();
  }
  lastMotionWallT = nowWall;

  const ag = e.accelerationIncludingGravity || {};
  const r = e.rotationRate || {};
  const t = nowWall - clockStartT;

  timestamps.push(t);
  pushSample('ag_x', ag.x ?? 0);
  pushSample('ag_y', ag.y ?? 0);
  pushSample('ag_z', ag.z ?? 0);
  pushSample('rot_beta', r.beta ?? 0);

  // Trim to last BUFFER_SECONDS
  const cutoff = t - BUFFER_SECONDS * 1000;
  let trimIdx = 0;
  while (trimIdx < timestamps.length && timestamps[trimIdx] < cutoff) trimIdx++;
  if (trimIdx > 0) {
    timestamps.splice(0, trimIdx);
    for (const k in channels) {
      channels[k].raw.splice(0, trimIdx);
      channels[k].filt.splice(0, trimIdx);
    }
    activePeaks = activePeaks.filter(p => p.t >= cutoff);
  }
}

function pushSample(name, val) {
  const ch = channels[name];
  if (!ch.inited) { ch.emaSlow = val; ch.emaFast = 0; ch.inited = true; }
  ch.emaSlow += ALPHA_SLOW * (val - ch.emaSlow);          // tracks DC
  const hp = val - ch.emaSlow;                              // high-pass
  ch.emaFast += ALPHA_FAST * (hp - ch.emaFast);            // low-pass on hp = bandpass
  ch.raw.push(val);
  ch.filt.push(ch.emaFast);
}

// --- Analysis ---
function stdOfRecent(arr, n) {
  const start = Math.max(0, arr.length - n);
  if (arr.length - start < 2) return 0;
  let sum = 0;
  for (let i = start; i < arr.length; i++) sum += arr[i];
  const mean = sum / (arr.length - start);
  let varSum = 0;
  for (let i = start; i < arr.length; i++) varSum += (arr[i] - mean) ** 2;
  return Math.sqrt(varSum / (arr.length - start));
}

function computeSamplingRate() {
  if (timestamps.length < 30) return SAMPLE_RATE_NOMINAL;
  const recent = timestamps.slice(-30);
  const span = recent[recent.length - 1] - recent[0];
  return span > 0 ? (recent.length - 1) / (span / 1000) : SAMPLE_RATE_NOMINAL;
}

function pickActiveChannel(samplingRate) {
  const n = Math.floor(VARIANCE_WINDOW_SEC * samplingRate);
  let best = null, bestStd = 0;
  for (const k in channels) {
    const s = stdOfRecent(channels[k].filt, n);
    if (s > bestStd) { bestStd = s; best = k; }
  }
  return best;
}

function detectPeaks(filt, samplingRate) {
  const minDist = Math.floor(MIN_PEAK_DISTANCE_SEC * samplingRate);
  const std = stdOfRecent(filt, filt.length);
  const minProminence = std * 0.3;
  const peaks = [];
  for (let i = 1; i < filt.length - 1; i++) {
    if (filt[i] > filt[i - 1] && filt[i] > filt[i + 1] && filt[i] > minProminence) {
      let isPeak = true;
      const lo = Math.max(0, i - minDist);
      const hi = Math.min(filt.length, i + minDist + 1);
      for (let j = lo; j < hi; j++) {
        if (j !== i && filt[j] > filt[i]) { isPeak = false; break; }
      }
      if (isPeak) peaks.push(i);
    }
  }
  return peaks;
}

// Run one analysis pass. Returns null when there is nothing new to show,
// otherwise { ready, bpm (number|null), statusText, axisLabel, recentCount, trace }.
export function analyze() {
  if (timestamps.length < 30) {
    return {
      ready: false, bpm: null, statusText: 'acquiring signal…',
      axisLabel: '—', recentCount: 0,
      trace: { timestamps: [], filt: [], peaks: [] },
    };
  }
  const samplingRate = computeSamplingRate();

  const newActive = pickActiveChannel(samplingRate);
  if (newActive) activeChannel = newActive;
  if (!activeChannel) return null;

  const filt = channels[activeChannel].filt.map(v => -v);
  const peakIdx = detectPeaks(filt, samplingRate);
  const peakObjs = peakIdx.map(i => ({ t: timestamps[i], idx: i, value: filt[i] }));
  activePeaks = peakObjs;

  const now = timestamps[timestamps.length - 1];
  const windowStart = now - PEAK_WINDOW_SEC * 1000;
  const recentPeaks = peakObjs.filter(p => p.t >= windowStart);

  let bpm = null;
  let statusText = 'detecting breaths…';
  if (recentPeaks.length >= 2) {
    const span = (recentPeaks[recentPeaks.length - 1].t - recentPeaks[0].t) / 1000;
    if (span > 0) {
      bpm = (recentPeaks.length - 1) / span * 60;
      statusText = `${recentPeaks.length} breaths in last ${Math.round(span)}s`;
    }
  } else if (recentPeaks.length === 1) {
    statusText = 'first breath detected…';
  }

  return {
    ready: bpm !== null,
    bpm,
    statusText,
    axisLabel: AXIS_LABELS[activeChannel] || activeChannel,
    recentCount: recentPeaks.length,
    trace: { timestamps, filt, peaks: peakObjs },
  };
}
