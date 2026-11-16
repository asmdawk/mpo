const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  parseByteRange,
  cleanSettings,
  parsePlaylist,
  supported,
  stableId,
  mediaMime,
} = require('../electron/core.cjs');

test('media byte ranges preserve exact offsets for seeking', () => {
  assert.equal(parseByteRange(null, 1024), null);
  assert.equal(parseByteRange('', 1024), null);
  assert.deepEqual(parseByteRange('bytes=0-0', 1024), {start: 0, end: 0});
  assert.deepEqual(parseByteRange('bytes=100-199', 1024), {start: 100, end: 199});
  assert.deepEqual(parseByteRange(' bytes=500- ', 1024), {start: 500, end: 1023});
  assert.deepEqual(parseByteRange('bytes=1023-', 1024), {start: 1023, end: 1023});
});

test('media suffix ranges and oversized end bounds match HTTP semantics', () => {
  assert.deepEqual(parseByteRange('bytes=-128', 1024), {start: 896, end: 1023});
  assert.deepEqual(parseByteRange('bytes=-2048', 1024), {start: 0, end: 1023});
  assert.deepEqual(parseByteRange('bytes=512-5000', 1024), {start: 512, end: 1023});
  assert.deepEqual(parseByteRange('bytes=0-', 1), {start: 0, end: 0});
});

test('invalid, unsatisfiable and multipart byte ranges are rejected', () => {
  for (const value of [
    'bytes=-', 'bytes=-0', 'bytes=20-10', 'bytes=1024-',
    'bytes=0-1,4-8', 'items=0-10', 'bytes=x-y',
    'bytes=1.5-10', 'bytes=9007199254740993-',
  ]) {
    assert.equal(parseByteRange(value, 1024), false, value);
  }
  assert.equal(parseByteRange('bytes=0-', 0), false);
});

test('settings use safe defaults and exactly ten equalizer bands', () => {
  const defaults = cleanSettings();
  assert.equal(defaults.volume, 75);
  assert.equal(defaults.rate, 1);
  assert.equal(defaults.repeat, 'off');
  assert.equal(defaults.muted, false);
  assert.equal(defaults.shuffle, false);
  assert.equal(defaults.eqEnabled, false);
  assert.deepEqual(defaults.eqValues, Array(10).fill(0));
  assert.equal(defaults.eqPreset, 'flat');
});

test('settings clamp volume and EQ, reject invalid numbers and limit text', () => {
  const settings = cleanSettings({
    volume: 150, rate: 99, repeat: 'invalid', eqPreset: 'a'.repeat(100),
    eqValues: [-100, 100, NaN, Infinity, '6', null, -2.5, 0, 2, 3, 9],
  });
  assert.equal(settings.volume, 100);
  assert.equal(cleanSettings({volume: -20}).volume, 0);
  assert.equal(cleanSettings({volume: 'not-a-number'}).volume, 75);
  assert.equal(settings.rate, 1);
  assert.equal(settings.repeat, 'off');
  assert.equal(settings.eqPreset.length, 50);
  assert.deepEqual(settings.eqValues, [-12, 12, 0, 0, 6, 0, -2.5, 0, 2, 3]);
  assert.equal(cleanSettings({rate: '1.5', repeat: 'one'}).rate, 1.5);
  assert.equal(cleanSettings({repeat: 'all'}).repeat, 'all');
});

test('UTF-8 M3U imports Cyrillic and relative files while ignoring comments and URLs', () => {
  const playlist = path.resolve('tests', 'fixtures', 'плейлисты', 'вечер.m3u8');
  const base = path.dirname(playlist);
  const contents = '\uFEFF#EXTM3U\r\n' +
    '#EXTINF:24,Исполнитель — Мелодия\r\n' +
    '../Музыка/Мелодия.MP3\r\n' +
    '  ./Клип.mp4  \r\n' +
    '\r\n# an ordinary comment\r\n' +
    'https://example.com/music.mp3\r\n' +
    'file:///outside.mp3\r\n' +
    'javascript://blocked.mp3\r\n' +
    'readme.txt\r\n' +
    'bad\0name.mp3\r\n';
  assert.deepEqual(parsePlaylist(contents, playlist), [
    path.resolve(base, '../Музыка/Мелодия.MP3'),
    path.resolve(base, './Клип.mp4'),
  ]);
});

test('playlist absolute media paths remain absolute', () => {
  const absoluteMedia = path.resolve('tests', 'fixtures', 'sample.mp3');
  const playlist = path.resolve('another', 'folder', 'list.m3u');
  assert.deepEqual(parsePlaylist(absoluteMedia, playlist), [absoluteMedia]);
});

test('JSON playlists accept string paths and saved track objects', () => {
  const playlist = path.resolve('tests', 'fixtures', 'list.json');
  const base = path.dirname(playlist);
  const tracks = ['sample.mp3', {path: 'sample.mp4'}, null, {title: 'No path'},
    'https://example.com/remote.mp3', 'notes.txt'];
  const expected = [path.resolve(base, 'sample.mp3'), path.resolve(base, 'sample.mp4')];
  assert.deepEqual(parsePlaylist(JSON.stringify(tracks), playlist), expected);
  assert.deepEqual(parsePlaylist(JSON.stringify({tracks}), playlist), expected);
  assert.throws(() => parsePlaylist('{', playlist), SyntaxError);
  assert.throws(() => parsePlaylist('{"tracks":"invalid"}', playlist), /Invalid playlist/);
});

test('playlist entries are bounded to avoid unbounded import work', () => {
  const files = Array.from({length: 10002}, (_, index) => `track-${index}.mp3`);
  const result = parsePlaylist(files.join('\n'), path.resolve('list.m3u'));
  assert.equal(result.length, 10000);
  assert.equal(path.basename(result.at(-1)), 'track-9999.mp3');
});

test('supported file checks, stable IDs and media MIME types agree', () => {
  assert.equal(supported('SONG.MP3'), true);
  assert.equal(supported('Клип.MP4'), true);
  assert.equal(supported('payload.exe'), false);
  assert.equal(supported('song.mp3.exe'), false);
  assert.equal(mediaMime('SONG.MP3'), 'audio/mpeg');
  assert.equal(mediaMime('clip.mp4'), 'video/mp4');
  assert.equal(mediaMime('audio.wav'), 'audio/wav');
  const absolute = path.resolve('tests/fixtures/sample.mp3');
  assert.equal(stableId('tests/fixtures/sample.mp3'), stableId(absolute));
  assert.match(stableId(absolute), /^[a-f0-9]{24}$/);
  assert.notEqual(stableId(absolute), stableId(absolute + '.mp4'));
});

test('actual MP3 fixture preserves Cyrillic ID3 metadata and duration', async () => {
  const {parseFile} = await import('music-metadata');
  const metadata = await parseFile(path.join(__dirname, 'fixtures', 'sample.mp3'));
  assert.equal(metadata.common.title, 'Тестовый трек');
  assert.equal(metadata.common.artist, 'ZigZak Originals');
  assert.ok(Math.abs(metadata.format.duration - 4) < .1);
  assert.equal(metadata.format.numberOfChannels, 2);
  assert.equal(metadata.format.sampleRate, 44100);
});

test('actual H.264/AAC MP4 fixture exposes video title and duration', async () => {
  const {parseFile} = await import('music-metadata');
  const metadata = await parseFile(path.join(__dirname, 'fixtures', 'sample.mp4'));
  assert.equal(metadata.common.title, 'ZigZak Video Test');
  assert.ok(Math.abs(metadata.format.duration - 4) < .1);
  assert.equal(metadata.format.sampleRate, 44100);
  assert.equal(metadata.format.numberOfChannels, 2);
});
