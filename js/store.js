// Persistence — settings now, session history next. Everything stays on-device
// in localStorage; never send any of this anywhere.

const SETTINGS_KEY = 'billow-settings';

const DEFAULTS = {
  units: 'bpm', // 'bpm' | 'sec' (seconds per breath)
  chime: true,
};

export const settings = loadSettings();

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) { /* private mode / storage full — settings just won't persist */ }
}

// --- Session history ---
// One small record per finished session; no waveforms, so hundreds of
// sessions stay well under localStorage limits.
const HISTORY_KEY = 'billow-history';
const HISTORY_MAX = 500;

export function loadHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

export function addToHistory(record) {
  const arr = loadHistory();
  arr.push(record);
  while (arr.length > HISTORY_MAX) arr.shift();
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
  } catch (e) {}
}

// Ask the browser to protect this site's storage from eviction (matters most
// on iOS, where unused sites can have their data cleared).
try { navigator.storage?.persist?.(); } catch (e) {}
