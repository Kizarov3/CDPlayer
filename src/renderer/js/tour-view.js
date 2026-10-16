// The guide on the window itself: the rest dimmed, one part lit up at a time with a bubble pointing at it saying what
// it is and how it works. NEXT / BACK / SKIP, or → / Enter, ← and Esc. Shown the first time CDPlayer opens, and from
// SETTINGS → SHOW THE GUIDE. Steps whose part isn't on the window are left out.
import { el } from './widgets.js';
import { t } from './i18n.js';
import { TOUR } from './help.js';
import { placeBubble, unionRect } from './tour.js';

const PAD = 8; // the lit-up area round what's pointed at
let open = null;
export const isTourOpen = () => !!open;
// A part drawn on a canvas (the disc's case) has no element of its own: its rectangle comes from whoever draws it.
const drawn = new Map();
export const pointAtDrawn = (selector, rect) => drawn.set(selector, rect);

const visible = (e) => e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
function rectOf(step) {
  const own = step.targets.length === 1 && drawn.get(step.targets[0]);
  if (own && visible(document.querySelector(step.targets[0]))) { const r = own(); if (r) return r; }
  const r = unionRect(step.targets.map((q) => document.querySelector(q)).filter(visible).map((e) => e.getBoundingClientRect()));
  if (r || !step.fallback) return r;
  const f = document.querySelector(step.fallback);
  return visible(f) ? f.getBoundingClientRect() : null;
}

/**
 * Runs the guide; `first`: the first launch, with a welcome before it. It ends with what makes CDPlayer different, and
 * `onFeatures` (if given) opens WHAT'S SPECIAL from there. → a promise, settled when it's closed.
 */
export function startTour({ first = false, onFeatures = null } = {}) {
  if (open) return open.promise;
  const welcome = { targets: [], title: t('WELCOME TO CDPLAYER'), text: t('A CD player for the music on your computer: your albums stand on a shelf, a disc spins as it plays, and it all ages the way real CDs do. A quick look round takes a minute — or SKIP it and explore.') };
  const finale = { targets: [], title: t('WHAT MAKES IT DIFFERENT'), text: t('It treats your files like a CD collection: albums you don’t play gather dust, discs wear as they’re played, the shelf shows the albums you’re missing and what yours are worth, every album has a booklet, and karaoke lights up word by word. All of it, and where to find it, is in SETTINGS → HELP → WHAT’S SPECIAL.') };
  const steps = [...(first ? [welcome] : []), ...TOUR.filter((s) => rectOf(s)), finale];
  const counted = steps.filter((s) => s !== welcome).length; // the last word counted too: no step after "9 of 9"
  const spot = el('div', { class: 'tour-spot' });
  const bubble = el('div', { class: 'tour-bubble', role: 'dialog' });
  const layer = el('div', { class: 'tour-layer' }, spot, bubble);
  document.getElementById('overlays').append(layer);
  let i = 0, done;
  const promise = new Promise((resolve) => { done = resolve; });

  function show() {
    const step = steps[i], last = i === steps.length - 1, n = steps.indexOf(step) - (first ? 1 : 0) + 1;
    const next = el('button', { class: 'pill on', onClick: () => go(1) }, last ? (first ? t('START LISTENING') : t('DONE')) : t('NEXT|step'));
    bubble.replaceChildren(...[ // (replaceChildren would write a null out as "null")
      step === welcome ? null : el('div', { class: 'tour-count' }, t('{step} OF {total}', { step: n, total: counted })),
      el('div', { class: 'tour-title' }, step.title),
      el('div', { class: 'tour-text' }, step.text),
      el('div', { class: 'tour-actions' },
        last ? null : el('button', { class: 'pill', onClick: close }, t('SKIP')),
        el('span', { class: 'grow' }),
        i ? el('button', { class: 'pill', onClick: () => go(-1) }, t('BACK')) : null,
        step === finale && onFeatures ? el('button', { class: 'pill', onClick: () => { close(); onFeatures(); } }, t('SHOW THEM')) : null,
        next)].filter(Boolean));
    bubble.classList.toggle('wide', step === welcome || step === finale);
    const r = step.targets.length ? rectOf(step) : null;
    layer.classList.toggle('dim', !r);
    spot.hidden = !r;
    const view = { width: window.innerWidth, height: window.innerHeight };
    const size = { width: bubble.offsetWidth, height: bubble.offsetHeight };
    if (!r) {
      bubble.dataset.side = 'none';
      Object.assign(bubble.style, { left: `${(view.width - size.width) / 2}px`, top: `${(view.height - size.height) / 2}px` });
    } else {
      const lit = { left: r.left - PAD, top: r.top - PAD, right: r.right + PAD, bottom: r.bottom + PAD };
      Object.assign(spot.style, { left: `${lit.left}px`, top: `${lit.top}px`, width: `${lit.right - lit.left}px`, height: `${lit.bottom - lit.top}px` });
      const at = placeBubble(lit, size, view);
      bubble.dataset.side = at.side;
      bubble.style.setProperty('--arrow', `${at.arrow}px`);
      Object.assign(bubble.style, { left: `${at.x}px`, top: `${at.y}px` });
    }
    next.focus({ preventScroll: true });
  }
  function go(d) {
    if (i + d >= steps.length) { close(); return; }
    i = Math.max(0, i + d);
    show();
  }
  function onKey(e) {
    if (e.metaKey || e.ctrlKey) return; // the system's own (⌘Q, ⌘W…) still work
    // The guide has the keyboard while it's up: the player's keys wait.
    const used = { Escape: close, ArrowRight: () => go(1), Enter: () => go(1), ArrowLeft: () => go(-1) }[e.key];
    e.stopPropagation(); e.preventDefault();
    if (used && !e.repeat) used();
  }
  function close() {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', show);
    layer.remove();
    open = null;
    done();
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', show);
  open = { promise };
  show();
  return promise;
}
