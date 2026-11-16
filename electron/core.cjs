const path = require('node:path');
const crypto = require('node:crypto');

const AUDIO = new Set(['.mp3', '.wav', '.flac', '.ogg', '.oga', '.m4a', '.aac', '.opus', '.aiff', '.aif']);
const VIDEO = new Set(['.mp4', '.m4v', '.webm', '.mov', '.mkv']);
const supported = file => AUDIO.has(path.extname(file).toLowerCase()) || VIDEO.has(path.extname(file).toLowerCase());
const stableId = file => crypto.createHash('sha256').update(process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file)).digest('hex').slice(0, 24);
const mediaMime = file => ({'.mp3':'audio/mpeg','.wav':'audio/wav','.flac':'audio/flac','.ogg':'audio/ogg','.oga':'audio/ogg','.opus':'audio/ogg','.m4a':'audio/mp4','.aac':'audio/aac','.mp4':'video/mp4','.m4v':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mkv':'video/x-matroska','.aiff':'audio/aiff','.aif':'audio/aiff'}[path.extname(file).toLowerCase()] || 'application/octet-stream');

function parseByteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size < 1) return false;
  let start, end;
  if (!match[1]) { const suffix = Number(match[2]); if (suffix < 1) return false; start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return false;
  return {start, end};
}

function cleanSettings(raw = {}) {
  if (!raw || typeof raw !== 'object') raw = {};
  const bounded = (v, min, max, fallback) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback;
  return {
    volume: bounded(raw.volume ?? 75, 0, 100, 75), muted: !!raw.muted,
    shuffle: !!raw.shuffle, repeat: ['off','all','one'].includes(raw.repeat) ? raw.repeat : 'off',
    theme: ['aurora','violet','sunset'].includes(raw.theme) ? raw.theme : 'aurora',
    rate: [0.5,0.75,1,1.25,1.5,2].includes(Number(raw.rate)) ? Number(raw.rate) : 1,
    eqEnabled: !!raw.eqEnabled,
    eqValues: Array.from({length:10}, (_,i)=>bounded(raw.eqValues?.[i] ?? 0, -12, 12, 0)),
    eqPreset: String(raw.eqPreset || 'flat').slice(0,50),
    lastTrackId: typeof raw.lastTrackId === 'string' ? raw.lastTrackId.slice(0,100) : null,
    positions: Object.fromEntries(Object.entries(raw.positions && typeof raw.positions === 'object' ? raw.positions : {}).slice(-1000).filter(([id,seconds])=>/^[a-zA-Z0-9-]{1,100}$/.test(id) && Number.isFinite(Number(seconds)) && Number(seconds)>=0).map(([id,seconds])=>[id,Math.min(1e9,Number(seconds))]))
  };
}

function parsePlaylist(contents, playlistPath) {
  const base = path.dirname(playlistPath);
  let entries;
  if (path.extname(playlistPath).toLowerCase() === '.json') {
    const data = JSON.parse(contents);
    const tracks = Array.isArray(data) ? data : data.tracks;
    if (!Array.isArray(tracks)) throw new Error('Invalid playlist');
    entries = tracks.map(t => typeof t === 'string' ? t : t?.path).filter(t=>typeof t === 'string');
  } else entries = contents.replace(/^\uFEFF/, '').split(/\r?\n/).map(s=>s.trim()).filter(s=>s && !s.startsWith('#'));
  return entries.slice(0,10000).filter(s=>!/^\w+:\/\//.test(s) && !s.includes('\0')).map(s=>path.resolve(base,s)).filter(supported);
}

module.exports = {AUDIO, VIDEO, supported, stableId, mediaMime, parseByteRange, cleanSettings, parsePlaylist};
