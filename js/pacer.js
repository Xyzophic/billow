// Breathing pacer — drives the orb from a target rhythm instead of the
// measured signal, with whisper cues and optional vibration.

import * as cues from './cues.js';

const INHALE_FRAC = 0.4; // inhale 40% of the cycle, exhale 60% — relaxation bias

let rafId = null;
let t0 = 0;
let targetBpm = 6;
let vibrate = false;
let onScale = null;
let onCue = null;
let lastKind = null;

export function init(callbacks) {
  onScale = callbacks.onScale;
  onCue = callbacks.onCue;
}

export function start(bpm, vibe) {
  targetBpm = bpm;
  vibrate = vibe;
  if (rafId === null) {
    t0 = performance.now(); // anchor so every run begins on an inhale
    lastKind = null;
    rafId = requestAnimationFrame(frame);
  }
}

export function stop() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  lastKind = null;
  if (onCue) onCue('');
}

export function isActive() {
  return rafId !== null;
}

// One pacer step at time `now` (ms). Exported so the rhythm is testable and
// drivable without the animation-frame loop.
export function tick(now) {
  const cycle = 60000 / targetBpm;
  const phase = (((now - t0) % cycle) + cycle) % cycle / cycle;
  const inhale = phase < INHALE_FRAC;
  const p = inhale ? phase / INHALE_FRAC : (phase - INHALE_FRAC) / (1 - INHALE_FRAC);
  const eased = 0.5 - 0.5 * Math.cos(Math.PI * p); // smooth 0→1
  const scale = inhale ? 0.96 + 0.10 * eased : 1.06 - 0.10 * eased;
  if (onScale) onScale(scale);
  const kind = inhale ? 'in' : 'out';
  if (kind !== lastKind) {
    lastKind = kind;
    if (onCue) onCue(kind === 'in' ? 'breathe in…' : 'breathe out…');
    if (vibrate) cues.pacerPulse(kind);
  }
  return scale;
}

function frame(now) {
  tick(now);
  rafId = requestAnimationFrame(frame);
}
