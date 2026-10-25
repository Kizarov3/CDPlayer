'use strict';
// IMPORT PLAYS: each service's export read, its songs found on the shelf, and nothing counted twice.
const test = require('node:test');
const assert = require('node:assert');
const { read, apply, csvRows, plainTitle } = require('../src/main/import-plays');
const { makeZip } = require('./zip-fixture');

const file = (name, text) => ({ name, data: Buffer.from(text) });
const ALBUMS = [
  { title: 'OK Computer', artist: 'Radiohead', tracks: [
    { path: '/m/okc/01 Airbag.flac', title: 'Airbag', artist: 'Radiohead' },
    { path: '/m/okc/02 Paranoid Android.flac', title: 'Paranoid Android', artist: 'Radiohead' }] },
  { title: 'OK Computer OKNOTOK 1997 2017', artist: 'Radiohead', tracks: [
    { path: '/m/oknotok/01 Airbag.flac', title: 'Airbag (Remastered)', artist: 'Radiohead' }] },
  { title: 'Hits', artist: 'Various Artists', tracks: [
    { path: '/m/hits/01.mp3', title: 'Get Lucky', artist: 'Daft Punk; Pharrell Williams' }] },
];
const empty = () => ({ counts: new Map(), last: new Map(), first: new Map() });
const T = (iso) => Date.parse(iso);

test("Spotify's extended history: songs heard 30 s or more, by album artist, the album choosing the edition", () => {
  const found = read(file('Streaming_History_Audio_2020.json', JSON.stringify([
    { ts: '2020-01-01T10:00:00Z', ms_played: 240000, master_metadata_track_name: 'Airbag', master_metadata_album_artist_name: 'Radiohead', master_metadata_album_album_name: 'OK Computer OKNOTOK 1997 2017' },
    { ts: '2020-01-02T10:00:00Z', ms_played: 5000, master_metadata_track_name: 'Airbag', master_metadata_album_artist_name: 'Radiohead', master_metadata_album_album_name: 'OK Computer' },
    { ts: '2020-01-03T10:00:00Z', ms_played: 200000, master_metadata_track_name: 'Paranoid Android - Remastered 2017', master_metadata_album_artist_name: 'Radiohead', master_metadata_album_album_name: 'OK Computer' },
    { ts: '2020-01-04T10:00:00Z', ms_played: 200000, master_metadata_track_name: null, episode_name: 'A podcast' },
    { ts: '2020-01-05T10:00:00Z', ms_played: 200000, master_metadata_track_name: 'Creep', master_metadata_album_artist_name: 'Radiohead', master_metadata_album_album_name: 'Pablo Honey' },
  ])));
  assert.strictEqual(found[0].source, 'spotify');
  const r = apply(found, ALBUMS, empty());
  assert.deepStrictEqual(Object.fromEntries(r.plays.counts), { '/m/oknotok/01 Airbag.flac': 1, '/m/okc/02 Paranoid Android.flac': 1 });
  assert.strictEqual(r.plays.first.get('/m/okc/02 Paranoid Android.flac'), T('2020-01-03T10:00:00Z'));
  assert.deepStrictEqual([r.added, r.missing, r.sources], [2, 1, ['SPOTIFY']]);
});

test("Spotify's account data, Last.fm's CSV (with a header, or without) and ListenBrainz's JSON lines are read", () => {
  const spotify = read(file('StreamingHistory0.json', JSON.stringify([{ endTime: '2023-01-31 22:15', artistName: 'Radiohead', trackName: 'Airbag', msPlayed: 100000 }])));
  assert.deepStrictEqual(spotify[0].listens, [{ artist: 'Radiohead', title: 'Airbag', album: null, at: T('2023-01-31T22:15:00Z') }]);
  const headed = read(file('scrobbles.csv', 'uts,utc_time,artist,artist_mbid,album,album_mbid,track,track_mbid\n1580508900,"31 Jan 2020, 22:15",Radiohead,,OK Computer,,"Paranoid Android",\n'));
  assert.deepStrictEqual(headed[0].listens, [{ artist: 'Radiohead', title: 'Paranoid Android', album: 'OK Computer', at: 1580508900000 }]);
  const bare = read(file('lastfm.csv', 'Radiohead,OK Computer,Airbag,31 Jan 2020 22:15\r\n'));
  assert.deepStrictEqual(bare[0], { source: 'lastfm', listens: [{ artist: 'Radiohead', title: 'Airbag', album: 'OK Computer', at: T('2020-01-31T22:15:00Z') }] });
  const lb = read(file('listens.jsonl', '{"listened_at":1580508900,"track_metadata":{"artist_name":"Daft Punk","track_name":"Get Lucky","release_name":"Random Access Memories"}}\n'));
  assert.strictEqual(lb[0].source, 'listenbrainz');
  const r = apply(lb, ALBUMS, empty());
  assert.deepStrictEqual(Object.fromEntries(r.plays.counts), { '/m/hits/01.mp3': 1 }); // one of the song's two artists
});

test("a service's whole export as its .zip: the music read, podcasts left", () => {
  const listen = (title, ts) => ({ ts, ms_played: 60000, master_metadata_track_name: title, master_metadata_album_artist_name: 'Radiohead', master_metadata_album_album_name: 'OK Computer' });
  const zip = makeZip([
    { name: 'Spotify Extended Streaming History/', data: Buffer.alloc(0) },
    { name: 'Spotify Extended Streaming History/Streaming_History_Audio_2020.json', data: Buffer.from(JSON.stringify([listen('Airbag', '2020-01-01T00:00:00Z')])), deflate: true },
    { name: 'Spotify Extended Streaming History/Streaming_History_Audio_2021.json', data: Buffer.from(JSON.stringify([listen('Airbag', '2021-01-01T00:00:00Z')])) },
    { name: 'Spotify Extended Streaming History/Streaming_History_Video_2021.json', data: Buffer.from(JSON.stringify([listen('Airbag', '2021-06-01T00:00:00Z')])) },
    { name: 'Spotify Extended Streaming History/ReadMeFirst.pdf', data: Buffer.from('%PDF') },
  ]);
  const r = apply(read({ name: 'my_spotify_data.zip', data: zip }), ALBUMS, empty());
  assert.deepStrictEqual(Object.fromEntries(r.plays.counts), { '/m/okc/01 Airbag.flac': 2 });
});

test('imported again — or a file picked twice — nothing is counted twice; what came after is', () => {
  const lines = (...ts) => file('scrobbles.csv', 'uts,artist,album,track\n' + ts.map((s) => `${s},Radiohead,OK Computer,Airbag`).join('\n'));
  const first = apply([...read(lines(100, 200)), ...read(lines(100, 200))], ALBUMS, empty());
  assert.strictEqual(first.plays.counts.get('/m/okc/01 Airbag.flac'), 2);
  const again = apply(read(lines(100, 200, 300)), ALBUMS, first.plays, first.imports);
  assert.deepStrictEqual([again.plays.counts.get('/m/okc/01 Airbag.flac'), again.added, again.already], [3, 1, 2]);
  assert.strictEqual(again.imports.lastfm.length, 3);
  assert.strictEqual(again.plays.last.get('/m/okc/01 Airbag.flac'), 300000);
});

const libraryXml = (count, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>Major Version</key><integer>1</integer>
	<key>Tracks</key>
	<dict>
		<key>101</key>
		<dict>
			<key>Track ID</key><integer>101</integer>
			<key>Name</key><string>Paranoid Android</string>
			<key>Artist</key><string>Radiohead</string>
			<key>Album</key><string>OK Computer</string>
			<key>Play Count</key><integer>${count}</integer>
			<key>Play Date UTC</key><date>2019-05-01T12:00:00Z</date>
			<key>Location</key><string>file:///m/okc/02%20Paranoid%20Android.flac</string>
		</dict>
		<key>102</key>
		<dict>
			<key>Name</key><string>Never Played &amp; Gone</string>
			<key>Artist</key><string>Radiohead</string>
		</dict>${extra}
	</dict>
	<key>Playlists</key>
	<array><dict><key>Name</key><string>Library</string><key>Playlist Items</key><array><dict><key>Track ID</key><integer>101</integer></dict></array></dict></array>
</dict></plist>`;

test("Apple Music's Library.xml: a song's total, by its file when it's the same one; only what it's grown by, imported again", () => {
  const found = read(file('Library.xml', libraryXml(7)));
  assert.deepStrictEqual(found[0].totals, [{ artist: 'Radiohead', title: 'Paranoid Android', album: 'OK Computer', count: 7, at: T('2019-05-01T12:00:00Z'), file: '/m/okc/02 Paranoid Android.flac' }]);
  const plays = empty(); plays.counts.set('/m/okc/02 Paranoid Android.flac', 2);
  const r = apply(found, ALBUMS, plays);
  assert.strictEqual(r.plays.counts.get('/m/okc/02 Paranoid Android.flac'), 9);
  assert.strictEqual(r.plays.first.has('/m/okc/02 Paranoid Android.flac'), false); // a total doesn't say when it began
  const again = apply(read(file('Library.xml', libraryXml(10))), ALBUMS, r.plays, r.imports);
  assert.deepStrictEqual([again.plays.counts.get('/m/okc/02 Paranoid Android.flac'), again.added], [12, 3]);
  const same = apply(read(file('Library.xml', libraryXml(10))), ALBUMS, again.plays, again.imports);
  assert.deepStrictEqual([same.added, same.already], [0, 10]);
});

test("Windows' iTunes Library.xml: its file:// addresses are Windows paths, wherever it's read", () => {
  const xml = libraryXml(3).replace(/<key>Location<\/key><string>[^<]*<\/string>/, '<key>Location</key><string>file://localhost/C:/Users/Sam/Music/iTunes/Radiohead/OK%20Computer/02%20Paranoid%20Android.m4a</string>');
  assert.strictEqual(read(file('Library.xml', xml))[0].totals[0].file, 'C:\\Users\\Sam\\Music\\iTunes\\Radiohead\\OK Computer\\02 Paranoid Android.m4a');
});

test('the plays maps stay with the most recently played last; files that are none of these give nothing', () => {
  const plays = empty();
  plays.counts.set('/m/hits/01.mp3', 1); plays.last.set('/m/hits/01.mp3', T('2024-01-01T00:00:00Z'));
  const r = apply(read(file('a.csv', 'uts,artist,track\n1580508900,Radiohead,Airbag')), ALBUMS, plays);
  assert.deepStrictEqual([...r.plays.counts.keys()], ['/m/okc/01 Airbag.flac', '/m/hits/01.mp3']);
  assert.deepStrictEqual(read(file('notes.txt', 'hello there')), []);
  assert.deepStrictEqual(read(file('x.json', '{"a":1}')), []);
  assert.deepStrictEqual(read(file('x.xml', '<html></html>')), []);
});

test('CSV cells: quotes, commas and line breaks inside them', () => {
  assert.deepStrictEqual(csvRows('a,"b, c","say ""hi"""\n"two\nlines",x'), [['a', 'b, c', 'say "hi"'], ['two\nlines', 'x']]);
  assert.strictEqual(plainTitle('Airbag - Remastered 2017'), 'Airbag');
  assert.strictEqual(plainTitle('Airbag (2009 Remaster)'), 'Airbag');
  assert.strictEqual(plainTitle('Airbag (Live)'), 'Airbag (Live)');
});

test('a listen not on the shelf is counted once it is; CDPlayer’s own scrobbles aren’t counted again', () => {
  const csv = file('s.csv', 'uts,artist,album,track\n100,Radiohead,OK Computer,Airbag\n200,Radiohead,Kid A,Idioteque');
  const first = apply(read(csv), ALBUMS, empty());
  assert.deepStrictEqual([first.added, first.missing], [1, 1]);
  const more = [...ALBUMS, { title: 'Kid A', artist: 'Radiohead', tracks: [{ path: '/m/kida/08.flac', title: 'Idioteque', artist: 'Radiohead' }] }];
  const later = apply(read(csv), more, first.plays, first.imports);
  assert.deepStrictEqual([later.added, later.already, later.plays.counts.get('/m/kida/08.flac')], [1, 1, 1]);
  const lb = read(file('l.jsonl', [
    '{"listened_at":100,"track_metadata":{"artist_name":"Radiohead","track_name":"Airbag","additional_info":{"media_player":"CDPlayer"}}}',
    '{"listened_at":200,"track_metadata":{"artist_name":"Radiohead","track_name":"Airbag","additional_info":{"media_player":"Spotify"}}}'].join('\n')));
  assert.deepStrictEqual([apply(lb, ALBUMS, empty()).added, apply(lb, ALBUMS, empty()).already], [1, 1]);
  // a null in Spotify's list is passed over; a time years ahead isn't taken as the last time played
  const sp = read(file('s.json', JSON.stringify([null, { ts: '2030-01-01T00:00:00Z', ms_played: 99999, master_metadata_track_name: 'Airbag', master_metadata_album_artist_name: 'Radiohead' }].map((x, i) => (i && x ? { ...x, ts: '5138-01-01T00:00:00Z' } : x)))));
  const ahead = apply(sp, ALBUMS, empty());
  assert.deepStrictEqual([ahead.added, ahead.plays.last.size], [1, 0]);
  const since = apply(read(file('s.csv', 'uts,artist,track\n100,Radiohead,Airbag\n500,Radiohead,Airbag')), ALBUMS, empty(), {}, { own: { lastfm: 300000 } });
  assert.deepStrictEqual([since.added, since.already], [1, 1]);
});
