// What CDPlayer tells someone new to it: the first-run guide (five cards), the FAQ, and the keyboard shortcuts (?),
// all also under Settings → HELP. The shortcuts are the README's table, word for word (a test keeps them together).

export const GUIDE = [
  { title: 'PUT SOME MUSIC ON', lines: [
    'Drag songs or whole folders onto the window — or LOAD A TRACK — and they go in the queue.',
    'MP3, M4A, FLAC, WAV, AIFF, OGG and Opus all play. There is nothing else to install.',
    'Your queue, and where you were in the song, are there the next time you open CDPlayer.',
  ] },
  { title: 'THE DISC IS REAL', lines: [
    'Grab the disc and turn it, like a DJ’s jog wheel, to move through the song.',
    'E opens the tray: drop music on it and close it again. B turns the disc over to see its tracks.',
    'Click the little cover in the corner for the album art, and again for its booklet.',
  ] },
  { title: 'YOUR ALBUMS ON A SHELF', lines: [
    'SHELF (S) stands every album in your music folder spine out — choose the folder the first time.',
    'Click a spine to pull the case out. Albums you leave alone gather dust; new ones come shrink-wrapped.',
    'Sorted by artist, see-through places show the albums of theirs you don’t have yet.',
  ] },
  { title: 'SING ALONG', lines: [
    'LYRICS shows the words, found online when the song has none, the line being sung lit up.',
    'KARAOKE (Y) fills the window and lights each word as it’s sung.',
    'Covers and lyrics are looked up online; everything else works without the internet.',
  ] },
  { title: 'MAKE IT YOURS', lines: [
    'SETTINGS has ten themes, an equalizer, crossfade, a sleep timer and Mini Mode (M).',
    'SPOTIFY plays your Spotify albums too, if you have Premium — optional, it walks you through it.',
    'Press ? any time for the keyboard shortcuts. This guide and the FAQ are in SETTINGS → HELP.',
  ] },
];

export const FAQ = [
  { q: 'My Mac (or Windows) won’t open it — is it safe?', a: 'CDPlayer isn’t signed with a paid Apple or Microsoft certificate, so the first time your system asks. On a Mac: right-click CDPlayer in Applications → Open → Open. On Windows: More info → Run anyway. Only once.' },
  { q: 'Why is there no cover or lyrics for a song?', a: 'CDPlayer uses what’s in the file, and otherwise looks it up online by the song’s artist and title. A file named “Track 01” with no tags can’t be found: fix its name with TAGS, which can fill in the details from MusicBrainz.' },
  { q: 'Where is my data kept?', a: 'In ~/.cdplayer on Mac and Linux, %LOCALAPPDATA%\\CDPlayer on Windows: your queue, history, settings, notes and play counts, as small text files. Your music itself is never changed unless you save tags or found art into it.' },
  { q: 'How do I choose the folder my music is in?', a: 'Open the SHELF and click FOLDER… (the first time, it asks). The shelf shows the albums in that folder and everything under it. Songs outside it still play — drop them on the window.' },
  { q: 'Why doesn’t the equalizer work on Spotify?', a: 'Spotify’s audio is protected, so it plays outside CDPlayer’s sound engine: the equalizer, crossfade, mono, visualizer and waveform can’t reach it. Your own files get all of them.' },
  { q: 'What are the see-through “missing” albums on my shelf?', a: 'Those are missing albums: sorted by artist, each artist’s studio albums you don’t have stand as see-through places, from MusicBrainz. Click one to see it, or NOT INTERESTED to hide it for good.' },
  { q: 'Does CDPlayer send anything over the internet?', a: 'Only lookups: covers and lyrics by artist and title, album details from MusicBrainz, and a check for a new version on GitHub. No account, no tracking, nothing about you. Spotify talks to Spotify only if you connect it.' },
  { q: 'Why are some albums dusty, or wrapped in plastic?', a: 'An album nobody has played in a month gathers dust (rub the mouse over its spine to wipe it); one new in your music folder comes shrink-wrapped until you play it or pull the film off its case.' },
];

// [the keys, what they do] — exactly the README's Keyboard shortcuts table.
export const SHORTCUTS = [
  ['`Space` or `K`', 'Play / Pause'],
  ['`J` / `L`', 'Previous / next track'],
  ['`←` / `→`', 'Skip back / forward 5 seconds'],
  ['`↑` / `↓`', 'Volume up / down'],
  ['`U`', 'Mute / unmute'],
  ['`F`', 'Toggle fullscreen'],
  ['`C`', 'Toggle CD view'],
  ['`M`', 'Toggle Mini Mode'],
  ['`V`', 'Toggle Visualizer Mode'],
  ['`Y`', 'Toggle Karaoke Mode'],
  ['`E`', 'Open / close the disc tray'],
  ['`S`', 'The CD shelf'],
  ['`B`', 'Turn the disc over to its data side: a ring for each track, the laser where it\'s playing'],
  ['`P`', 'Now Playing card: pick lines of the lyrics, then copy or save it'],
  ['`?`', 'These keyboard shortcuts'],
  ['`Esc`', 'Close whatever\'s open, or leave fullscreen / CD view / Visualizer Mode / Mini Mode'],
];
