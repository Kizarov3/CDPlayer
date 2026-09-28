// The app's icon in the Dock (the taskbar on Windows) as the disc that's in: its face, as the player prints it
// (main.js, dock:disc).

const PX = 128;    // as big as a Dock icon shows
const DISC = 0.44; // the disc's radius, as a share of the icon: the Dock's usual margin round it

/** The disc face (a square canvas) → PNG bytes of the icon. */
export async function dockIcon(face) {
  const canvas = new OffscreenCanvas(PX, PX), g = canvas.getContext('2d');
  const r = PX * DISC, c = PX / 2;
  g.save(); // a soft shadow under the disc
  g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = PX * 0.03; g.shadowOffsetY = PX * 0.012;
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fillStyle = '#111'; g.fill();
  g.restore();
  g.drawImage(face, c - r, c - r, 2 * r, 2 * r);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}
