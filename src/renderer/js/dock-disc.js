// The app's icon in the Dock (the taskbar on Windows) as the disc that's in: its face, as the player prints it, turned
// through a full circle in a few frames that the main process steps through while it plays (main.js, dock:*).

export const DOCK_FRAMES = 18;  // 20° apart: at 8 a second, a turn every ~2.2 s, like the player's disc
const PX = 128;                  // as big as a Dock icon shows; 256 cost twice the processor to step through
const DISC = 0.44;              // the disc's radius, as a share of the icon: the Dock's usual margin round it

/** The disc face (a square canvas, unturned) → PNG bytes of each turned frame. */
export async function dockFrames(face) {
  const frames = [];
  const r = PX * DISC, c = PX / 2;
  for (let i = 0; i < DOCK_FRAMES; i++) {
    const canvas = new OffscreenCanvas(PX, PX), g = canvas.getContext('2d');
    g.save(); // the disc's shadow, which doesn't turn
    g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = PX * 0.03; g.shadowOffsetY = PX * 0.012;
    g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fillStyle = '#111'; g.fill();
    g.restore();
    g.translate(c, c); g.rotate((i * Math.PI * 2) / DOCK_FRAMES);
    g.drawImage(face, -r, -r, 2 * r, 2 * r);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    frames.push(new Uint8Array(await blob.arrayBuffer()));
  }
  return frames;
}
