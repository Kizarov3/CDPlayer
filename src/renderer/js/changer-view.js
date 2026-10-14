// The changer's carousel, seen from above: five slots round a tray, each disc with its cover printed on it, the
// playing one turned to the laser on the side facing the big disc. Under it, the playing disc's tracklist.
import { el } from './widgets.js';
import { trayAngle } from './changer.js';
import { t } from './i18n.js';

export function createChangerView(root, { tray, heading, list, onPlaySlot, onPlayTrack, coverFor, animations }) {
  const ring = el('div', { class: 'changer-ring' });
  const discs = Array.from({ length: 5 }, (_, s) => {
    const art = el('div', { class: 'changer-art' });
    const node = el('button', { class: 'changer-disc empty', onClick: () => onPlaySlot(s) }, art, el('span', { class: 'changer-no' }, String(s + 1)));
    node.style.setProperty('--a', `${s * 72}deg`);
    ring.append(node);
    return { node, art, path: null };
  });
  tray.replaceChildren(el('div', { class: 'changer-tray' }, ring), el('div', { class: 'changer-laser', title: t('The laser') }));
  let angle = null;

  function turnTo(slot) {
    if (slot < 0) return;
    const target = trayAngle(slot);
    // Always the same way round, like a real carousel: a smaller angle than now goes on a full turn.
    let next = target;
    if (angle != null) while (next > angle) next -= 360;
    const steps = angle == null ? 0 : Math.round((angle - next) / 72);
    ring.style.transition = animations() && steps ? `transform ${steps * 400}ms cubic-bezier(.4,0,.2,1)` : 'none';
    ring.style.transform = `rotate(${next}deg)`;
    ring.style.setProperty('--ring', `${next}deg`); // the covers turn back by as much, staying upright
    angle = next;
  }

  function render(view) {
    view.slots.forEach((d, s) => {
      const x = discs[s];
      x.node.className = `changer-disc${d ? '' : ' empty'}${d && d.done ? ' done' : ''}${d && d.next ? ' next' : ''}${s === view.playingSlot ? ' playing' : ''}${d && d.kind === 'cdr' ? ' cdr' : ''}`;
      x.node.title = d ? [t('DISC {n}', { n: s + 1 }), d.title, d.artist].filter(Boolean).join(' · ') + (d.note ? `\n${d.note}` : '') : t('Slot {n} · empty', { n: s + 1 });
      x.node.disabled = !d;
      const path = d ? d.firstPath : null;
      if (path !== x.path) {
        x.path = path;
        x.art.style.backgroundImage = '';
        x.art.textContent = d && d.kind === 'cdr' ? d.title || '' : '';
        if (path) coverFor(path).then((src) => { if (x.path === path && src) { x.art.style.backgroundImage = `url("${src}")`; x.art.textContent = ''; } });
      }
    });
    turnTo(view.playingSlot);
    heading.textContent = view.heading;
    const scrollTop = list.scrollTop;
    list.replaceChildren(...view.tracks.map((tr) => el('div', { class: `queue-row${tr.current ? ' active' : ''}`, title: t('Play {song}', { song: tr.title }), onClick: () => onPlayTrack(tr.index) },
      el('span', { class: 'num' }, `${tr.no}.`), el('span', { class: 'entry' }, tr.title), el('span', { class: 'east' }, el('span', { class: 'duration' }, tr.time)))));
    list.scrollTop = scrollTop;
  }
  return { render, turnTo };
}
