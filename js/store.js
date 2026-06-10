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
