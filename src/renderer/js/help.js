// What CDPlayer tells someone new to it: the first-run guide (five cards), the FAQ, and the keyboard shortcuts (?),
// all also under Settings → HELP. The shortcuts are the README's table, word for word (a test keeps them together).
import { t } from './i18n.js';

// The guide (tour-view.js): a spotlight on each part of the window in turn, with a word on what it does. `targets` are
// lit up together (the visible ones); `fallback` is lit when none of them is on the window yet (no song loaded).
export const TOUR = [
  { targets: ['#disc'], title: t('THE DISC'), text: t('Your music plays on this disc. Grab it and turn it to move through the song. Once a song is in, click the small cover in the case’s corner for the album art, and again for its booklet.') },
  { targets: ['#shelf-button'], title: t('THE SHELF'), text: t('Every album in your music folder, spine out — it asks for the folder the first time. Click a spine to take the case out and play it.') },
  { targets: ['#load-button', '#tray-button'], title: t('PUT SOME MUSIC ON'), text: t('Music from anywhere else: drag songs or whole folders onto the window, or press LOAD A TRACK. ⏏ opens the tray: drop music on it, like a new CD.') },
  { targets: ['#transport'], title: t('PLAY'), text: t('Play and pause, previous and next, five seconds back and on, SHUFFLE and REPEAT. Space plays and pauses; J and L skip.') },
  { targets: ['#queue-card'], title: t('THE QUEUE'), text: t('Your queue: drag a song to move it, × takes it out. With the CD changer on (in SETTINGS), five discs turn here instead.') },
  { targets: ['#lyrics-button', '#karaoke-button', '#tags-button'], fallback: '#now-row', title: t('LYRICS, KARAOKE, TAGS'), text: t('Here, once a song plays: LYRICS shows its words, lit up as they’re sung, KARAOKE fills the window with them, and TAGS fixes its name and album from MusicBrainz.') },
  { targets: ['#spotify-button'], title: t('SPOTIFY'), text: t('Your Spotify albums and playlists play as discs too, with Premium. It’s optional, and walks you through it.') },
  { targets: ['#settings-button'], title: t('SETTINGS'), text: t('Themes, the equalizer, crossfade, the CD changer, the language — and, under HELP, this guide again and what’s special about CDPlayer.') },
  { targets: ['#hint b'], fallback: '#hint', title: t('KEYS'), text: t('Almost everything has a key. Press ? any time to see them all.') },
];

// What CDPlayer does that other players don't (SETTINGS → HELP → WHAT'S SPECIAL), in groups; `show`: what the
// SHOW ME button opens (panels.js knows how), for the ones there's something to look at straight away.
export const FEATURES = [
  { group: t('THE SHELF'), items: [
    { title: t('Dust'), show: 'dust', text: t('An album you haven’t played for a month starts gathering dust on its spine, more each week, thick after half a year. Rub the mouse over the spine to wipe it. PULL ONE takes an album at random — the dustier, the likelier.') },
    { title: t('Shrink-wrap'), show: 'wrap', text: t('An album new in your music folder arrives in shrink-wrap: the film comes off when you play it, or tear it off the case yourself. Its NEW sticker stays for two weeks.') },
    { title: t('Albums you don’t have'), show: 'missing', text: t('Sorted by artist, each artist’s albums end with a box: their studio albums missing from your shelf, from MusicBrainz. Open it and they stand there as see-through places with their tracklists; an album you only have a song of shows the rest of its songs in grey.') },
    { title: t('What it’s worth on Discogs'), show: 'discogs', text: t('Discogs is the biggest marketplace for records and CDs. Pull out a case to see the album’s pressing there — label, catalogue number, country — and its lowest price. APPRAISE values the whole shelf, sorting by price stands it dearest first, and a dear or much-wanted pressing gets a gold ★ RARE.') },
    { title: t('A shop’s look'), text: t('The obi strips, the yen and dollar stickers and the shop receipts tucked behind covers are decoration — a collection bought in different shops over the years. The real prices are Discogs’, in the case.') },
    { title: t('Notes on cases'), text: t('+ NOTE sticks a note on a case; its corner shows on the spine, and the shelf’s search finds what you wrote.') },
    { title: t('A check-up'), text: t('CHECK on the shelf finds what’s wrong in your music folder: songs without tags or covers, duplicates, gaps in an album’s track numbers.') },
  ] },
  { group: t('THE DISC'), items: [
    { title: t('Wear'), text: t('A disc played a lot looks it: hairline scratches after ten plays of its album, fingerprints after fifty, chips after a hundred.') },
    { title: t('Its other side'), show: 'flip', text: t('B turns the disc over to its data side: a ring for each track, and the laser where it’s playing.') },
    { title: t('Spin it by hand'), text: t('Grab the disc and turn it to move through the song.') },
    { title: t('The tray'), text: t('E runs the tray out: drop music on it and it goes in as a new disc; E again closes it, and the drive spins it up.') },
    { title: t('A real player’s sounds'), text: t('Settings → DISC NOISE: a faint hiss, the tray motor, the disc spinning up — and a skip when you shake the window.') },
    { title: t('CD View'), show: 'cdview', text: t('C: just the disc, big, spinning — for when the music is on and nothing else needs to be.') },
  ] },
  { group: t('THE SOUND'), items: [
    { title: t('No gaps'), text: t('An album whose songs run into each other — a live album, a DJ mix — plays on with no gap between its tracks.') },
    { title: t('Out of your head'), text: t('Settings → SPATIAL AUDIO: on headphones, the music comes from two speakers in front of you instead of from inside your head.') },
    { title: t('Every song as loud'), text: t('Settings → SOUND CHECK: an old CD and a new remaster play at the same loudness, and LEVEL under the title says by how much.') },
  ] },
  { group: t('LYRICS AND THE BOOKLET'), items: [
    { title: t('Karaoke'), show: 'karaoke', text: t('Y: the lyrics fill the window and light up word by word as they’re sung — backing vocals under the line, a duet’s singers left and right. Click a line to jump to it.') },
    { title: t('The booklet'), text: t('Click the small cover in the case’s corner, then the big one: the album’s booklet — tracklist, ABOUT THE ALBUM from Wikipedia, lyrics, credits, and tally marks by the songs you play most.') },
    { title: t('A card to share'), text: t('P: a card of the song with the lines you pick — copy it, save it, or record a video of the disc turning while they’re sung, for Stories.') },
  ] },
  { group: t('THE CD CHANGER'), items: [
    { title: t('Five discs'), text: t('Settings → PLAYBACK → CD CHANGER: five discs in a carousel instead of a queue. D skips to the next disc, 1–5 play a slot, and a full changer asks which disc goes back to the shelf.') },
    { title: t('Mixtapes'), text: t('Songs added one at a time go on a home-made CD-R, written on with the day — a compilation you put together as you listen.') },
  ] },
];

export const FAQ = [
  { q: t('My Mac (or Windows) won’t open it — is it safe?'), a: t('CDPlayer isn’t signed with a paid Apple or Microsoft certificate, so the first time your system asks. On a Mac: right-click CDPlayer in Applications → Open → Open. On Windows: More info → Run anyway. Only once.') },
  { q: t('Why is there no cover or lyrics for a song?'), a: t('CDPlayer uses what’s in the file, and otherwise looks it up online by the song’s artist and title. A file named “Track 01” with no tags can’t be found: fix its name with TAGS, which can fill in the details from MusicBrainz.') },
  { q: t('What’s a MIX disc in the changer?'), a: t('A CD-R, home-made: songs added one at a time — from SEARCH, HISTORY or dropped as single files — go in together as one disc, written on with the day it was put together. A playlist goes in as a CD-R with its own name. Albums are discs of their own.') },
  { q: t('What’s the CD changer?'), a: t('A mode you turn on in Settings → CD CHANGER: five discs in a carousel instead of the queue. Albums, folders and playlists go in as discs (INTO THE CHANGER on the shelf); D skips to the next disc, 1–5 play a slot, and SHUFFLE and REPEAT work on this disc or all of them. The queue and the changer each keep their own music.') },
  { q: t('Where is my data kept?'), a: t('In ~/.cdplayer on Mac and Linux, %LOCALAPPDATA%\\CDPlayer on Windows: your queue and changer, history, settings, notes and play counts, as small text files. Your music itself is never changed unless you save tags or found art into it.') },
  { q: t('How do I choose the folder my music is in?'), a: t('Open the SHELF and click FOLDER… (the first time, it asks). The shelf shows the albums in that folder and everything under it. Songs outside it still play — drop them on the window.') },
  { q: t('Why doesn’t the equalizer work on Spotify?'), a: t('Spotify’s audio is protected, so it plays outside CDPlayer’s sound engine: the equalizer, crossfade, mono, visualizer and waveform can’t reach it. Your own files get all of them.') },
  { q: t('What are the see-through “missing” albums on my shelf?'), a: t('Those are missing albums: sorted by artist, each artist’s studio albums you don’t have stand as see-through places, from MusicBrainz. Click one to see it, or NOT INTERESTED to hide it for good.') },
  { q: t('Does CDPlayer send anything over the internet?'), a: t('Only lookups: covers and lyrics by artist and title, album details from MusicBrainz, an album’s pressing and price from Discogs when you open its case or appraise the shelf, and a check for a new version on GitHub. No account, no tracking, nothing about you. Spotify talks to Spotify only if you connect it.') },
  { q: t('Why are some songs so much louder than others?'), a: t('Albums are mastered at different loudness — an old CD can be 10 dB quieter than a new remaster. Turn on Settings → SOUND CHECK: every song plays at the same loudness, from its ReplayGain tags or measured once. ALBUM keeps an album’s own quiet and loud songs.') },
  { q: t('Why are some albums dusty, or wrapped in plastic?'), a: t('An album nobody has played in a month gathers dust (rub the mouse over its spine to wipe it); one new in your music folder comes shrink-wrapped until you play it or pull the film off its case.') },
];

// [the keys, what they do] — exactly the README's Keyboard shortcuts table.
export const SHORTCUTS = [
  ['`Space` or `K`', t('Play / Pause')],
  ['`J` / `L`', t('Previous / next track')],
  ['`D`', t('Next disc in the changer'), 'changer'], // (changer keys: listed only in changer mode)
  ['`1`–`5`', t('Play the disc in that slot of the changer'), 'changer'],
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
  ['`/`', t('Search your music (Enter plays the first match)')],
  ['`B`', t('Turn the disc over to its data side: a ring for each track, the laser where it\'s playing')],
  ['`P`', t('Now Playing card: pick lines of the lyrics, then copy or save it')],
  ['`?`', t('These keyboard shortcuts')],
  ['`Esc`', t('Close whatever\'s open, or leave fullscreen / CD view / Visualizer Mode / Mini Mode')],
  ['`⌘Z` / `Ctrl+Z`', t('Bring back what CLEAR or EJECT just took out')],
  ['`⌘O` / `Ctrl+O`', t('Open songs to play (LOAD A TRACK)')],
  ['`⌘,` / `Ctrl+,`', t('Settings')],
];
