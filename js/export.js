// Export — history as CSV, and a finished session as a shareable image.
// The share image always renders in the light paper palette so it looks
// right wherever it lands, regardless of the phone's dark mode.

const PAPER = '#fbfaf4';
const INK = '#13343b';
const MUTED = '#767772';
const FAINT = '#b8b5ac';
const ACCENT = '#20808d';
const WASH = '#20808d1a';
const SERIF = '"Iowan Old Style", "Palatino Linotype", Georgia, serif';
const SANS = '-apple-system, "Helvetica Neue", "Segoe UI", sans-serif';

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function exportHistoryCsv(history) {
  const lines = ['date,time,duration_sec,avg_bpm,start_bpm,end_bpm,lowest_bpm'];
  for (const r of history) {
    const d = new Date(r.t);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    lines.push(`${date},${time},${r.durationSec},${r.avg},${r.start},${r.end},${r.lowest}`);
  }
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv' }), 'billow-history.csv');
}

// Renders the session card to a canvas and opens the share sheet where
// available (iOS/Android), otherwise downloads the PNG.
// Returns 'shared' | 'cancelled' | 'downloaded' | 'failed' so the UI can report.
export async function shareSummaryImage(summary, units) {
  const W = 1000, H = 1100;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const sec = units === 'sec';
  const fmt = bpm => (sec ? 60 / bpm : bpm).toFixed(1);

  x.fillStyle = PAPER;
  x.fillRect(0, 0, W, H);

  x.fillStyle = INK;
  x.font = `48px ${SERIF}`;
  x.textAlign = 'left';
  x.fillText('billow', 70, 110);

  const d = new Date();
  x.fillStyle = MUTED;
  x.font = `30px ${SANS}`;
  x.textAlign = 'right';
  x.fillText(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase(), W - 70, 110);

  x.textAlign = 'center';
  x.fillStyle = INK;
  x.font = `220px ${SERIF}`;
  x.fillText(fmt(summary.avg), W / 2, 420);

  const mins = Math.floor(summary.durationSec / 60);
  const secs = Math.floor(summary.durationSec % 60);
  x.fillStyle = MUTED;
  x.font = `32px ${SANS}`;
  x.fillText(`${sec ? 'avg seconds per breath' : 'avg breaths per minute'} over ${mins}:${String(secs).padStart(2, '0')}`, W / 2, 490);

  // session curve, soft area style
  const points = summary.points;
  if (points && points.length >= 2) {
    const vals = points.map(p => sec ? 60 / p.bpm : p.bpm);
    const ts = points.map(p => p.t);
    const left = 70, right = W - 70, top = 570, bottom = 800;
    let minV = Math.min(...vals), maxV = Math.max(...vals);
    const pad = ((maxV - minV) || 1) * 0.15;
    minV -= pad; maxV += pad;
    const xOf = t => left + ((t - ts[0]) / ((ts[ts.length - 1] - ts[0]) || 1)) * (right - left);
    const yOf = v => bottom - ((v - minV) / (maxV - minV)) * (bottom - top);

    x.fillStyle = WASH;
    x.beginPath();
    x.moveTo(xOf(ts[0]), bottom);
    for (let i = 0; i < vals.length; i++) x.lineTo(xOf(ts[i]), yOf(vals[i]));
    x.lineTo(xOf(ts[ts.length - 1]), bottom);
    x.closePath();
    x.fill();

    x.strokeStyle = ACCENT;
    x.lineWidth = 6;
    x.beginPath();
    for (let i = 0; i < vals.length; i++) {
      const px = xOf(ts[i]), py = yOf(vals[i]);
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.stroke();
  }

  const cells = [
    ['start', fmt(summary.start)],
    ['end', fmt(summary.end)],
    [sec ? 'slowest' : 'lowest', fmt(summary.lowest)],
  ];
  cells.forEach(([label, value], i) => {
    const cx = W / 2 + (i - 1) * 260;
    x.fillStyle = MUTED;
    x.font = `26px ${SANS}`;
    x.fillText(label, cx, 900);
    x.fillStyle = INK;
    x.font = `56px ${SERIF}`;
    x.fillText(value, cx, 965);
  });

  x.fillStyle = FAINT;
  x.font = `26px ${SANS}`;
  x.fillText('xyzophic.github.io/billow', W / 2, 1045);

  const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
  if (!blob) return 'failed'; // Safari can yield null under memory pressure
  const file = new File([blob], 'billow-session.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled'; // user closed the share sheet
    }
  }
  downloadBlob(blob, 'billow-session.png');
  return 'downloaded';
}
