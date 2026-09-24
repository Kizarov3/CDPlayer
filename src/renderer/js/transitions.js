// Snapshot-based view transitions, as in the Java app: freeze a picture of the window, switch the real UI
// underneath instantly, then animate the picture away — warped in 48 vertical strips into the disc ("genie") for
// CD View, or a plain crossfade when source and target rectangles are the same.

const STRIPS = 48;
let running = null;

function loadImage(src) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
}

/**
 * @param capture   async () => data URL of the current window (taken BEFORE `apply`)
 * @param apply     switches the UI to its new state
 * @param rects     () => { source, target } in viewport CSS px, evaluated after `apply`
 */
export async function snapshotTransition(canvas, capture, apply, rects) {
  let snapshot = null;
  try { snapshot = await loadImage(await capture()); } catch { snapshot = null; }
  apply();
  if (!snapshot) return;
  if (running) cancelAnimationFrame(running);
  // Let layout settle one frame so the target rectangle is where the new UI actually put the disc.
  await new Promise((r) => requestAnimationFrame(r));
  const { source, target } = rects();
  const warp = !(source.x === target.x && source.y === target.y && source.w === target.w && source.h === target.h);
  const duration = warp ? 260 : 140;
  const dpr = window.devicePixelRatio || 1, w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.display = 'block';
  const g = canvas.getContext('2d');
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (p < 1) {
      g.globalAlpha = 1 - p;
      const t = p * p * (3 - 2 * p); // smoothstep
      const iw = snapshot.naturalWidth, ih = snapshot.naturalHeight;
      for (let i = 0; i < STRIPS; i++) {
        const sx0 = (i * iw) / STRIPS, sx1 = ((i + 1) * iw) / STRIPS;
        const wobble = warp ? 0.1 * Math.sin(t * Math.PI) * Math.sin(i * 0.6) : 0;
        const st = Math.max(0, Math.min(1, t + wobble));
        const startX = source.x + (source.w * i) / STRIPS, startW = source.w / STRIPS;
        const endX = target.x + (target.w * i) / STRIPS, endW = target.w / STRIPS;
        const dx = startX + (endX - startX) * st, dw = startW + (endW - startW) * st;
        const dy = source.y + (target.y - source.y) * st, dh = source.h + (target.h - source.h) * st;
        // +0.5px overlap hides hairline seams between strips.
        g.drawImage(snapshot, sx0, 0, sx1 - sx0, ih, dx, dy, dw + 0.5, dh);
      }
      running = requestAnimationFrame(step);
    } else {
      canvas.style.display = 'none';
      running = null;
    }
  };
  running = requestAnimationFrame(step);
}
