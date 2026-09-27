'use strict';
// Audio CDs: MusicBrainz disc IDs, macOS's .TOC.plist, finding a disc in a (fake) /Volumes, and naming its tracks.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-cd-'));
process.env.CDPLAYER_CD_ROOT = root;
const cd = require('../src/main/audio-cd');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

// Real discs of Queen's "A Night at the Opera", with the IDs MusicBrainz has for them.
const OPERA = { first: 1, last: 12, leadout: 194925, offsets: [150, 16930, 21987, 35895, 48845, 64670, 83000, 93262, 130872, 147315, 162607, 189240] };
test('MusicBrainz disc IDs', () => {
  assert.strictEqual(cd.discId(OPERA), '2xtkvLdMnH8JK3jFZ_eMgtzsAvo-');
  assert.strictEqual(cd.discId({ first: 1, last: 12, leadout: 194080, offsets: [187, 16930, 21965, 35785, 48690, 64460, 82710, 93010, 130482, 146875, 162097, 188715] }), '3FENEYlGd7i7yDlgQ44VAObyG9Y-');
  assert.strictEqual(cd.tocParam({ first: 1, last: 2, leadout: 300, offsets: [150, 200] }), '1+2+300+150+200');
});

function plist(tracks, leadout) {
  const t = tracks.map(([point, start, data]) => `<dict><key>Data</key><${data ? 'true' : 'false'}/><key>Point</key><integer>${point}</integer><key>Start Block</key><integer>${start}</integer></dict>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Format 0x02 TOC Data</key><data>AAECAw==</data><key>Sessions</key><array><dict>
<key>First Track</key><integer>1</integer><key>Leadout Block</key><integer>${leadout}</integer><key>Session Number</key><integer>1</integer>
<key>Track Array</key><array>${t}</array></dict></array></dict></plist>`;
}

test('.TOC.plist: the audio tracks, their offsets from the lead-in, and the disc ID', () => {
  const toc = cd.tocFromPlist(plist(OPERA.offsets.map((o, i) => [i + 1, o - 150]), OPERA.leadout - 150));
  assert.deepStrictEqual({ first: toc.first, last: toc.last, leadout: toc.leadout, offsets: toc.offsets }, OPERA);
  assert.strictEqual(cd.discId(toc), '2xtkvLdMnH8JK3jFZ_eMgtzsAvo-');
});

test('an enhanced CD: the data track after the music is left out, and the audio ends 11400 sectors before it', () => {
  const toc = cd.tocFromPlist(plist([[1, 0], [2, 20000], [3, 50000, true]], 90000));
  assert.deepStrictEqual(toc.tracks, [1, 2]);
  assert.strictEqual(toc.leadout, 50000 - 11400 + 150);
});

test('macOS: only audio CDs\' mounts are looked at', () => {
  const out = [
    '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
    '/dev/disk5s1 on /Volumes/USB Stick (msdos, local, nodev, nosuid, noowners)',
    '/dev/disk4 on /Volumes/Audio CD (cddafs, local, nodev, nosuid, read-only, noowners)',
    '/dev/disk6 on /Volumes/A Night at the Opera (cddafs, local, nodev, nosuid, read-only, noowners)',
  ].join('\n');
  assert.deepStrictEqual(cd.cddaMounts(out), ['/Volumes/Audio CD', '/Volumes/A Night at the Opera']);
});

test('Linux: the table of contents from the tracks\' lengths', () => {
  assert.deepStrictEqual(cd.tocFromSectors([100, 250]), { first: 1, last: 2, leadout: 500, offsets: [150, 250], tracks: [1, 2] });
});

test('a disc in the drive is found, its tracks in order; a plain folder isn\'t one', async () => {
  const vol = path.join(root, 'Audio CD');
  fs.mkdirSync(vol);
  fs.writeFileSync(path.join(vol, '.TOC.plist'), plist(OPERA.offsets.map((o, i) => [i + 1, o - 150]), OPERA.leadout - 150));
  for (let n = 1; n <= 12; n++) fs.writeFileSync(path.join(vol, `${n} Audio Track.aiff`), '');
  fs.mkdirSync(path.join(root, 'Backup Drive'));
  const discs = await cd.findDiscs();
  assert.strictEqual(discs.length, 1);
  assert.strictEqual(discs[0].id, '2xtkvLdMnH8JK3jFZ_eMgtzsAvo-');
  assert.deepStrictEqual(discs[0].tracks.map((p) => path.basename(p)).slice(0, 3), ['1 Audio Track.aiff', '2 Audio Track.aiff', '3 Audio Track.aiff']);
  assert.strictEqual(discs[0].tracks.length, 12);
});

test('naming a disc: its release\'s tracks, and the album\'s cover, for each file', async () => {
  const disc = { id: 'abc', toc: { first: 1, last: 2, leadout: 500, offsets: [150, 250] }, tracks: ['/v/1 Audio Track.aiff', '/v/2 Audio Track.aiff'] };
  const asked = [];
  const answer = { releases: [
    { id: 'wrong', title: 'Other', media: [{ position: 1, discs: [{ id: 'zzz' }], tracks: [{ title: 'x' }] }] },
    { id: 'r1', title: 'Neon Skies', date: '2019-03-01', 'artist-credit': [{ name: 'Nova Drift' }], media: [{ position: 1, discs: [{ id: 'abc' }], tracks: [
      { title: 'Solar Flare', 'artist-credit': [{ name: 'Nova Drift', joinphrase: ' feat. ' }, { name: 'Someone' }] }, { title: 'Low Orbit' }] }] },
  ] };
  const named = await cd.nameDisc(disc, { fetchMb: async (q) => { asked.push(q); return answer; }, fetchCover: async (id) => `cover-of-${id}` });
  assert.deepStrictEqual(named, { album: 'Neon Skies', artist: 'Nova Drift', year: '2019' });
  assert.match(asked[0], /^discid\/abc\?toc=1\+2\+500\+150\+250&inc=/);
  assert.deepStrictEqual(cd.detailsFor('/v/1 Audio Track.aiff'), { title: 'Solar Flare', artist: 'Nova Drift feat. Someone', album: 'Neon Skies', albumArtist: 'Nova Drift', year: '2019', track: 1, of: 2, disc: null, cover: 'cover-of-r1', releaseId: 'r1', discs: 1 });
  assert.strictEqual(cd.detailsFor('/v/2 Audio Track.aiff').artist, 'Nova Drift');
  cd.forgetDisc(disc);
  assert.strictEqual(cd.detailsFor('/v/1 Audio Track.aiff'), null);
});

test('a disc MusicBrainz doesn\'t know keeps its tracks\' own names', async () => {
  const disc = { id: 'nope', toc: { first: 1, last: 1, leadout: 300, offsets: [150] }, tracks: ['/v/1 Audio Track.aiff'] };
  assert.strictEqual(await cd.nameDisc(disc, { fetchMb: async () => ({ releases: [] }), fetchCover: async () => null }), null);
  assert.strictEqual(cd.detailsFor('/v/1 Audio Track.aiff'), null);
});
test('a late answer for a disc that has since been swapped names nothing', async () => {
  const disc = { id: 'abc', toc: { first: 1, last: 1, leadout: 300, offsets: [150] }, tracks: ['cdda://F/1'] };
  const answer = { releases: [{ id: 'r1', title: 'Old Disc', 'artist-credit': [{ name: 'Someone' }], media: [{ position: 1, discs: [{ id: 'abc' }], tracks: [{ title: 'Old Song' }] }] }] };
  assert.strictEqual(await cd.nameDisc(disc, { fetchMb: async () => answer, fetchCover: async () => null, isCurrent: () => false }), null);
  assert.strictEqual(cd.detailsFor('cdda://F/1'), null);
});

test('Windows: the disc in a drive, read through the CD helper, with its cdda:// tracks — and forgotten when it\'s taken out', async () => {
  const realPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const cdRoot = process.env.CDPLAYER_CD_ROOT; delete process.env.CDPLAYER_CD_ROOT; // (the file's stand-in CD folder would win)
  process.env.CDPLAYER_WIN_CD_HELPER = JSON.stringify([process.execPath, path.join(__dirname, 'fixtures', 'fake-cd-helper.js')]);
  try {
    const winCd = require('../src/main/win-cd');
    const { findDiscs } = require('../src/main/audio-cd');
    const [disc, ...others] = await findDiscs();
    assert.strictEqual(others.length, 0);
    assert.strictEqual(disc.mount, 'F:');
    assert.strictEqual(disc.id, '6u6SZ6TRjV_O9VDaKMAucGeZEOY-');
    assert.strictEqual(disc.tracks.length, 13);
    assert.strictEqual(disc.tracks[2], 'cdda://F/3');
    assert.ok(winCd.trackInfo('cdda://F/3'));
    winCd.drives = async () => []; // the disc taken out
    assert.deepStrictEqual(await findDiscs(), []);
    assert.strictEqual(winCd.trackInfo('cdda://F/3'), null);
  } finally {
    Object.defineProperty(process, 'platform', { value: realPlatform });
    process.env.CDPLAYER_CD_ROOT = cdRoot;
    delete process.env.CDPLAYER_WIN_CD_HELPER;
  }
});

test('Windows: a check that fails (the helper busy or restarting) is not an ejected disc', async () => {
  const realPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const cdRoot = process.env.CDPLAYER_CD_ROOT; delete process.env.CDPLAYER_CD_ROOT; // (the file's stand-in CD folder would win)
  process.env.CDPLAYER_WIN_CD_HELPER = JSON.stringify([process.execPath, path.join(__dirname, 'fixtures', 'fake-cd-helper.js')]);
  const winCd = require('../src/main/win-cd');
  const { drives, readToc } = winCd;
  try {
    const { findDiscs } = require('../src/main/audio-cd');
    winCd.drives = async () => ['F:']; winCd.readToc = readToc;
    const [disc] = await findDiscs();
    winCd.drives = async () => { throw new Error('the CD helper stopped'); };
    assert.deepStrictEqual((await findDiscs()).map((d) => d.id), [disc.id], 'no answer: the disc stays');
    winCd.drives = async () => ['F:']; winCd.readToc = async () => { throw new Error('toc: busy'); };
    assert.deepStrictEqual((await findDiscs()).map((d) => d.id), [disc.id], 'its table of contents unreadable for a moment: it stays');
    assert.ok(winCd.trackInfo('cdda://F/3'), 'and its tracks still play');
    winCd.drives = async () => []; winCd.readToc = readToc;
    assert.deepStrictEqual(await findDiscs(), [], 'a drive answered without it: gone');
  } finally {
    winCd.drives = drives; winCd.readToc = readToc;
    Object.defineProperty(process, 'platform', { value: realPlatform });
    process.env.CDPLAYER_CD_ROOT = cdRoot;
    delete process.env.CDPLAYER_WIN_CD_HELPER;
  }
});
