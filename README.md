# Billow

**Put your phone on your belly and watch your breath. **

Billow is a belly-breathing (diaphragmatic breathing) tracker that runs entirely in your phone's browser. Lie down, rest your phone on your belly, and it uses the motion sensors to detect each breath and show your live breaths-per-minute. Slow your breath and watch the number drop.

- 📱 No app store, no account, no camera — just a web page
- 🔒 100% on-device: sensor data never leaves your phone
- 📈 Live breath waveform with per-breath detection
- 🔄 Show your pace as breaths per minute or seconds per breath
- ✅ "Ready" badge tells you when the signal is locked on
- ⏱ Timed sessions (1–30 min) with a soft end-of-session chime and summary
- 📒 Session history saved on your phone, with a trend chart across sessions
- 🫧 Optional breathing pacer: the orb guides you at a target pace (4–10/min) with whisper cues and optional vibration
- 🎯 Optional goal ("avg under N per minute") with day streaks tracked in history
- 📤 Export history as CSV, or share a session as an image
- 🌙 Follows your phone's light/dark mode
- 🏠 Installable: add to home screen for a full-screen, offline-capable app

## How it works

Breathing tilts a phone resting on your belly by a fraction of a degree. Billow samples the accelerometer and gyroscope (~60 Hz), band-passes each axis to the breathing band (0.05–0.5 Hz), auto-selects whichever axis carries the strongest signal, and runs prominence-based peak detection to count breaths.

## Usage

1. Open the site on your phone (iPhone Safari or Android Chrome — HTTPS required for motion sensors).
2. Tap **Enable Motion Sensors** and allow the permission prompt.
3. Lie flat, phone on your belly screen-up, just below the ribs.
4. Breathe normally; the first reading takes ~30 seconds.

## Development

Static files, no build step — plain ES modules. Serve the folder over HTTPS (motion sensors require a secure context) and open it on a phone.

- `index.html` — markup only
- `css/app.css` — styles
- `js/engine.js` — breath detection (validated against real sessions; change with care)
- `js/session.js` — session timer and summary stats
- `js/store.js` — on-device persistence (settings; session history soon)
- `js/cues.js` — chime and haptics
- `js/pacer.js` — breathing pacer rhythm (drives the orb when enabled)
- `js/export.js` — CSV export and share-image rendering
- `js/ui.js` — entry module; DOM wiring and drawing

When adding a file, also add it to the cache list in `sw.js` and bump the cache version.

## Disclaimer

Billow is a relaxation and breathing-awareness tool, **not a medical device**. It does not diagnose, treat, or monitor any health condition.
