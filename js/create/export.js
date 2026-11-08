// Export: Foto → JPEG, Video → MediaRecorder (MP4 bevorzugt, sonst WebM).
import { canvasToBlob } from '../util.js';

export const MAX_VIDEO_SECONDS = 60;

const MIME_AV = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.4D0028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
const MIME_V = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** Unterstützte Recorder-MIME-Typen in Reihenfolge der Vorliebe. */
export function recorderMimes(withAudio) {
  if (typeof MediaRecorder === 'undefined') return [];
  return (withAudio ? MIME_AV : MIME_V).filter(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } });
}
export const canRecordVideo = () => typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream && recorderMimes(false).length > 0;
export const willProduceMp4 = () => (recorderMimes(true)[0] || recorderMimes(false)[0] || '').startsWith('video/mp4');
export const baseMime = m => (m || '').split(';')[0] || 'video/webm';

/** Kleines JPEG-Vorschaubild (max. 400 px). */
export async function makeThumb(canvas, max = 400) {
  const r = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * r); c.height = Math.round(canvas.height * r);
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(canvas, 0, 0, c.width, c.height);
  return canvasToBlob(c, 'image/jpeg', 0.8);
}

/** Foto-Export: draw(ctx) zeichnet in W×H. */
export async function exportImage(W, H, draw) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  draw(c.getContext('2d'));
  const blob = await canvasToBlob(c, 'image/jpeg', 0.92);
  const thumb = await makeThumb(c);
  c.width = c.height = 1; // Speicher freigeben (iOS)
  return { blob, thumb, mime: 'image/jpeg' };
}

const once = (el, ev) => new Promise(res => el.addEventListener(ev, res, { once: true }));
async function seek(video, t) {
  if (Math.abs(video.currentTime - t) < 0.01 && video.readyState >= 2) return;
  const p = once(video, 'seeked');
  video.currentTime = t;
  await Promise.race([p, new Promise(r => setTimeout(r, 4000))]);
}

/**
 * Video in Echtzeit abspielen, jeden Frame auf ein Canvas zeichnen und aufnehmen.
 * opts: { video, W, H, start, end, draw(ctx), audioTrack, onProgress(0..1), isCancelled() }
 */
export async function recordVideo({ video, W, H, start, end, draw, audioTrack, onProgress, isCancelled }) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  // Manche Browser liefern nur Frames für Canvas im Dokument.
  canvas.className = 'create-offscreen';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');

  try {
    video.pause();
    await seek(video, start);
    draw(ctx);
    const thumb = await makeThumb(canvas);

    const stream = canvas.captureStream(30);
    if (audioTrack) stream.addTrack(audioTrack);
    const candidates = recorderMimes(!!audioTrack);
    let rec = null, lastErr;
    for (const mimeType of candidates) {
      try {
        rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 });
        break;
      } catch (e) { lastErr = e; }
    }
    if (!rec) throw lastErr || new Error('Videoaufnahme wird von diesem Browser nicht unterstützt');

    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = once(rec, 'stop');
    let recError = null;
    rec.onerror = e => { recError = e.error || new Error('Aufnahmefehler'); };
    rec.start(1000);
    draw(ctx); // erster Frame für den Stream

    const len = Math.max(0.1, end - start);
    let done = false, cancelled = false, onEnded = null, lastDraw = 0;
    const paint = () => { draw(ctx); lastDraw = performance.now(); onProgress?.(Math.min(1, Math.max(0, video.currentTime - start) / len)); };
    const finished = new Promise(resolve => {
      const finish = () => { if (!done) { done = true; clearInterval(guard); resolve(); } };
      const check = () => {
        if (isCancelled?.()) { cancelled = true; finish(); return true; }
        if (video.ended || video.currentTime >= end - 0.01) { paint(); finish(); return true; }
        return false;
      };
      const tick = () => {
        if (done || check()) return;
        paint();
        schedule();
      };
      const schedule = () => {
        if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(tick);
        else requestAnimationFrame(tick);
      };
      // Sicherheitsnetz: zeichnet weiter, falls keine Frame-Callbacks kommen (z. B. Tab im Hintergrund)
      const guard = setInterval(() => {
        if (done || check()) return;
        if (performance.now() - lastDraw > 70) paint();
      }, 1000 / 30);
      onEnded = () => { paint(); finish(); };
      video.addEventListener('ended', onEnded, { once: true });
      schedule();
    });

    try { await video.play(); }
    catch (e) {
      done = true;
      if (rec.state !== 'inactive') rec.stop();
      stream.getVideoTracks().forEach(t => t.stop());
      throw e;
    }
    await finished;
    video.removeEventListener('ended', onEnded);
    video.pause();
    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    stream.getVideoTracks().forEach(t => t.stop());
    if (cancelled) { const e = new Error('Abgebrochen'); e.name = 'AbortError'; throw e; }
    if (recError) throw recError;
    const mime = baseMime(rec.mimeType || candidates[0]);
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size) throw new Error('Leeres Video – Aufnahme fehlgeschlagen');
    onProgress?.(1);
    return { blob, thumb, mime };
  } finally {
    canvas.remove();
    canvas.width = canvas.height = 1;
  }
}
