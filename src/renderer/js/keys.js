// The shortcut a key press means. A Latin letter is taken as typed (so AZERTY/Dvorak users get their own M, J...),
// but on a non-Latin layout — Russian, Greek, Hebrew... — the J key types "о", so fall back to the physical key
// position instead, the way the Java version's key codes always behaved.
export function shortcutKey(e) {
  if (e.key.length === 1 && /^[a-z ]$/i.test(e.key)) return e.key.toLowerCase();
  const letter = /^Key([A-Z])$/.exec(e.code || '');
  if (letter) return letter[1].toLowerCase();
  if (e.code === 'Space') return ' ';
  return e.key;
}
