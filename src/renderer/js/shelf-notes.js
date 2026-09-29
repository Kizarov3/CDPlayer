// Sticky notes on albums: a square of sticky paper on the front of a case pulled out of the shelf, written on in
// marker ("lend to Sam", "for the long drive"). Its colour and tilt come from the album, so they're the same every
// time; its corner shows above the spine on the shelf. Click it to change it; wipe it out, or ×, to peel it off.

import { hash } from './disc-wear.js';

export const NOTE_MAX = 140;
export const NOTE_COLORS = ['255, 234, 128', '255, 184, 204', '176, 216, 255', '204, 240, 164'];


/** An album's note paper: { color: 'r, g, b', tilt: degrees, 1–4 either way }. */
export function noteLook(id) {
  const h = hash(id);
  const tilt = (1 + ((h >>> 4) % 31) / 10) * ((h >>> 12) & 1 ? 1 : -1);
  return { color: NOTE_COLORS[h % NOTE_COLORS.length], tilt };
}

/** What's kept of a note as written: no spaces round it or at line ends, one blank line at most, NOTE_MAX long. */
export function cleanNote(text) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/\s+$/, ''));
  const kept = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s*\n+|\s+$/g, '').trim();
  return [...kept].slice(0, NOTE_MAX).join('').trim();
}

/**
 * The note on a case's front: { id, text } → the sticker, written on (or, with no text, a blank one to write on
 * straight away). onSave(text) is told each change — '' when it's peeled off, and it's gone from the case.
 */
export function stickyNote({ id, text, onSave }) {
  const { color, tilt } = noteLook(id);
  const note = document.createElement('div');
  note.className = 'sticky-note';
  note.style.setProperty('--note', color);
  note.style.transform = `rotate(${tilt}deg)`;
  note.title = 'Click to change the note';
  const written = document.createElement('div');
  written.className = 'note-text';
  const peel = document.createElement('button');
  peel.className = 'note-peel';
  peel.textContent = '×';
  peel.title = 'Peel the note off';
  note.append(written, peel);
  let current = text || '';
  const show = () => { written.textContent = current; if (!note.contains(written)) note.replaceChildren(written, peel); };
  const save = (value) => {
    current = cleanNote(value);
    onSave(current);
    if (current) show(); else note.remove();
  };
  const edit = () => {
    if (note.querySelector('textarea')) return;
    const field = document.createElement('textarea');
    field.className = 'note-field';
    field.maxLength = NOTE_MAX;
    field.value = current;
    field.placeholder = 'Write a note…';
    field.spellcheck = false;
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      if (keep) save(field.value);
      else if (current) show();
      else { note.remove(); onSave(''); } // a blank note let go of unwritten: + NOTE comes back
    };
    field.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing isn't shortcuts, and Esc leaves the note, not the case
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    field.addEventListener('blur', () => finish(true));
    note.replaceChildren(field);
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  };
  note.addEventListener('click', (e) => { if (e.target === peel) { e.stopPropagation(); save(''); } else if (e.target !== note.querySelector('textarea')) edit(); });
  if (current) show(); else queueMicrotask(edit);
  return note;
}
