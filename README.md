# Billow

**Put your phone on your belly and watch your breath.**

Billow is a belly-breathing (diaphragmatic breathing) tracker that runs entirely in your phone's browser. Lie down, rest your phone on your belly, and it uses the motion sensors to detect each breath and show your live breaths-per-minute. Slow your breath and watch the number drop.

- 📱 No app store, no account, no camera — just a web page
- 🔒 100% on-device: sensor data never leaves your phone
- 📈 Live breath waveform with per-breath detection
- ⏱ Timed sessions (1–30 min) with an end-of-session summary
- 🏠 Installable: add to home screen for a full-screen, offline-capable app

## How it works

Breathing tilts a phone resting on your belly by a fraction of a degree. Billow samples the accelerometer and gyroscope (~60 Hz), band-passes each axis to the breathing band (0.05–0.5 Hz), auto-selects whichever axis carries the strongest signal, and runs prominence-based peak detection to count breaths.

## Usage

1. Open the site on your phone (iPhone Safari or Android Chrome — HTTPS required for motion sensors).
2. Tap **Enable Motion Sensors** and allow the permission prompt.
3. Lie flat, phone on your belly screen-up, just below the ribs.
4. Breathe normally; the first reading takes ~30 seconds.

## Development

It's a single static page — no build step. Serve the folder over HTTPS (motion sensors require a secure context) and open it on a phone.

## Disclaimer

Billow is a relaxation and breathing-awareness tool, **not a medical device**. It does not diagnose, treat, or monitor any health condition.
