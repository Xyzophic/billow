// Timed-session state: start/end, the bpm timeline recorded during the
// session, and the end-of-session summary stats.

import * as engine from './engine.js';

let inSession = false;
let durationMinutes = 5;
let timerStopAt = null;
let bpmHistory = [];

export function isActive() {
  return inSession;
}

export function duration() {
  return durationMinutes;
}

export function setDuration(min) {
  durationMinutes = min;
}

export function start() {
  engine.restartClock();
  bpmHistory = [];
  inSession = true;
  timerStopAt = Date.now() + durationMinutes * 60 * 1000;
}

export function clear() {
  bpmHistory = [];
  inSession = false;
  timerStopAt = null;
}

export function record(bpm) {
  if (inSession) bpmHistory.push({ t: engine.elapsedSec(), bpm });
}

export function timerExpired() {
  return timerStopAt !== null && Date.now() >= timerStopAt;
}

// Fraction of the timed session completed, 0..1.
export function progress() {
  if (!inSession || timerStopAt === null) return 0;
  const total = durationMinutes * 60 * 1000;
  return Math.max(0, Math.min(1, 1 - (timerStopAt - Date.now()) / total));
}

// Ends the session and returns summary stats, or null if too little was
// detected to summarize. Stats stay in bpm — display units are UI-only.
export function end() {
  inSession = false;
  timerStopAt = null;
  if (bpmHistory.length < 2) return null;

  const bpms = bpmHistory.map(p => p.bpm);
  const avg = bpms.reduce((a, b) => a + b, 0) / bpms.length;
  const lowest = Math.min(...bpms);
  const startSlice = bpms.slice(0, Math.min(5, bpms.length));
  const start = startSlice.reduce((a, b) => a + b, 0) / startSlice.length;
  const endSlice = bpms.slice(-Math.min(5, bpms.length));
  const endAvg = endSlice.reduce((a, b) => a + b, 0) / endSlice.length;
  const durationSec = bpmHistory[bpmHistory.length - 1].t - bpmHistory[0].t;

  return { avg, start, end: endAvg, lowest, durationSec, points: bpmHistory };
}
