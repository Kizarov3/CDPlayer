// What CDPlayer tells someone new to it: the first-run guide (five cards), the FAQ, and the keyboard shortcuts (?),
// all also under Settings → HELP. The shortcuts are the README's table, word for word (a test keeps them together).
import { t } from './i18n.js';

export const GUIDE = [
  { title: t('PUT SOME MUSIC ON'), lines: [
    t('Drag songs or whole folders onto the window — or LOAD A TRACK — and they go in the queue.'),
    t('MP3, M4A, FLAC, WAV, AIFF, OGG and Opus all play. There is nothing else to install.'),
    t('Your queue, and where you were in the song, are there the next time you open CDPlayer.'),
  ] },
  { title: t('THE DISC IS REAL'), lines: [
    t('Grab the disc and turn it, like a DJ’s jog wheel, to move through the song.'),
    t('E opens the tray: drop music on it and close it again. B turns the disc over to see its tracks.'),
    t('Click the little cover in the corner for the album art, and again for its booklet.'),
  ] },
  { title: t('YOUR ALBUMS ON A SHELF'), lines: [
    t('SHELF (S) stands every album in your music folder spine out — choose the folder the first time.'),
    t('Click a spine to pull the case out. Albums you leave alone gather dust; new ones come shrink-wrapped.'),
    t('Sorted by artist, see-through places show the albums of theirs you don’t have yet.'),
  ] },
  { title: t('SING ALONG'), lines: [
    t('LYRICS shows the words, found online when the song has none, the line being sung lit up.'),
    t('KARAOKE (Y) fills the window and lights each word as it’s sung.'),
    t('Covers and lyrics are looked up online; everything else works without the internet.'),
  ] },
  { title: t('MAKE IT YOURS'), lines: [
    t('SETTINGS has ten themes, an equalizer, crossfade, a sleep timer and Mini Mode (M).'),
    t('SPOTIFY plays your Spotify albums too, if you have Premium — optional, it walks you through it.'),
    t('Press ? any time for the keyboard shortcuts. This guide and the FAQ are in SETTINGS → HELP.'),
  ] },
];

export const FAQ = [
  { q: t('My Mac (or Windows) won’t open it — is it safe?'), a: t('CDPlayer isn’t signed with a paid Apple or Microsoft certificate, so the first time your system asks. On a Mac: right-click CDPlayer in Applications → Open → Open. On Windows: More info → Run anyway. Only once.') },
  { q: t('Why is there no cover or lyrics for a song?'), a: t('CDPlayer uses what’s in the file, and otherwise looks it up online by the song’s artist and title. A file named “Track 01” with no tags can’t be found: fix its name with TAGS, which can fill in the details from MusicBrainz.') },
  { q: t('Where is my data kept?'), a: t('In ~/.cdplayer on Mac and Linux, %LOCALAPPDATA%\\CDPlayer on Windows: your queue, history, settings, notes and play counts, as small text files. Your music itself is never changed unless you save tags or found art into it.') },
  { q: t('How do I choose the folder my music is in?'), a: t('Open the SHELF and click FOLDER… (the first time, it asks). The shelf shows the albums in that folder and everything under it. Songs outside it still play — drop them on the window.') },
  { q: t('Why doesn’t the equalizer work on Spotify?'), a: t('Spotify’s audio is protected, so it plays outside CDPlayer’s sound engine: the equalizer, crossfade, mono, visualizer and waveform can’t reach it. Your own files get all of them.') },
  { q: t('What are the see-through “missing” albums on my shelf?'), a: t('Those are missing albums: sorted by artist, each artist’s studio albums you don’t have stand as see-through places, from MusicBrainz. Click one to see it, or NOT INTERESTED to hide it for good.') },
  { q: t('Does CDPlayer send anything over the internet?'), a: t('Only lookups: covers and lyrics by artist and title, album details from MusicBrainz, and a check for a new version on GitHub. No account, no tracking, nothing about you. Spotify talks to Spotify only if you connect it.') },
  { q: t('Why are some albums dusty, or wrapped in plastic?'), a: t('An album nobody has played in a month gathers dust (rub the mouse over its spine to wipe it); one new in your music folder comes shrink-wrapped until you play it or pull the film off its case.') },
];

// [the keys, what they do] — exactly the README's Keyboard shortcuts table.
export const SHORTCUTS = [
  ['`Space` or `K`', t('Play / Pause')],
  ['`J` / `L`', t('Previous / next track')],
  ['`←` / `→`', t('Skip back / forward 5 seconds')],
  ['`↑` / `↓`', t('Volume up / down')],
  ['`U`', t('Mute / unmute')],
  ['`F`', t('Toggle fullscreen')],
  ['`C`', t('Toggle CD view')],
  ['`M`', t('Toggle Mini Mode')],
  ['`V`', t('Toggle Visualizer Mode')],
  ['`Y`', t('Toggle Karaoke Mode')],
  ['`E`', t('Open / close the disc tray')],
  ['`S`', t('The CD shelf')],
  ['`B`', t('Turn the disc over to its data side: a ring for each track, the laser where it\'s playing')],
  ['`P`', t('Now Playing card: pick lines of the lyrics, then copy or save it')],
  ['`?`', t('These keyboard shortcuts')],
  ['`Esc`', t('Close whatever\'s open, or leave fullscreen / CD view / Visualizer Mode / Mini Mode')],
];
