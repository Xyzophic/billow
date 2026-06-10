// Non-visual cues — end-of-session chime and haptics. The breathing pacer's
// vibration patterns will live here too.

let audioCtx = null;

// Browsers only allow sound after a user gesture; call this from the
// start-button tap so the chime is allowed when the timer ends later.
export function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {
    audioCtx = null;
  }
}

// Soft two-note chime (E5 → A5), ~1s, quiet.
export function chime() {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  for (const [freq, dt] of [[659.25, 0], [880, 0.35]]) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + dt);
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + dt + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 1.1);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0 + dt);
    osc.stop(t0 + dt + 1.2);
  }
}

export function endHaptic() {
  // iOS 18+ trick: programmatically clicking a hidden checkbox switch fires native haptic
  try {
    const sw = document.getElementById('hapticSwitch');
    if (sw) sw.click();
  } catch (e) {}
  // Android / browsers with Web Vibration API support
  try {
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  } catch (e) {}
}
