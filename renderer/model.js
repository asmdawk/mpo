export const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const PRESETS = {
  flat: { name: 'Ровный', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { name: 'Глубокий бас', values: [6, 5, 4, 2, 0, -1, -1, 0, 1, 2] },
  vocal: { name: 'Вокал', values: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  electronic: { name: 'Электроника', values: [4, 3, 1, 0, -2, 0, 2, 3, 4, 3] },
  cinema: { name: 'Кино', values: [4, 3, 1, 0, 2, 3, 2, 1, 2, 2] }
};
export const DEFAULT_SETTINGS = {
  volume: 75, muted: false, shuffle: false, repeat: 'off', rate: 1,
  eqEnabled: false, eqValues: FREQUENCIES.map(() => 0), eqPreset: 'flat', theme: 'aurora'
};
export function timeLabel(value) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const total = Math.floor(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function plural(value, forms) {
  const n = Math.abs(value) % 100;
  const last = n % 10;
  return forms[n > 10 && n < 20 ? 2 : last === 1 ? 0 : last > 1 && last < 5 ? 1 : 2];
}
export function normalizedSettings(input = {}) {
  const n = Number(input.volume);
  const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
  return {
    ...DEFAULT_SETTINGS,
    volume: Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 75,
    muted: Boolean(input.muted), shuffle: Boolean(input.shuffle),
    repeat: ['off', 'all', 'one'].includes(input.repeat) ? input.repeat : 'off',
    rate: rates.includes(Number(input.rate)) ? Number(input.rate) : 1,
    eqEnabled: Boolean(input.eqEnabled),
    eqValues: FREQUENCIES.map((_, i) => Math.min(12, Math.max(-12, Number(input.eqValues?.[i]) || 0))),
    eqPreset: input.eqPreset === 'custom' || Object.hasOwn(PRESETS, input.eqPreset) ? input.eqPreset : 'flat',
    theme: ['aurora', 'violet', 'sunset'].includes(input.theme) ? input.theme : 'aurora',
    lastTrackId: typeof input.lastTrackId === 'string' ? input.lastTrackId : null,
    positions: input.positions && typeof input.positions === 'object' ? input.positions : {}
  };
}
export function trackMatches(track, view, query) {
  if (view === 'favorites' && !track.favorite) return false;
  if (view === 'video' && track.type !== 'video') return false;
  if (view === 'recent' && !track.lastPlayedAt) return false;
  const haystack = `${track.title} ${track.artist} ${track.album || ''} ${track.format}`.toLocaleLowerCase();
  return !query || haystack.includes(query.toLocaleLowerCase().trim());
}
export function chooseNext(queue, currentId, { shuffle = false, repeat = 'off', ended = false } = {}, random = Math.random) {
  if (!queue.length) return null;
  if (ended && repeat === 'one' && queue.includes(currentId)) return currentId;
  if (shuffle) {
    const other = queue.filter(id => id !== currentId);
    if (!other.length) return ended && repeat === 'off' ? null : queue[0];
    return other[Math.floor(random() * other.length)];
  }
  const index = queue.indexOf(currentId);
  if (index < queue.length - 1) return queue[index + 1];
  return !ended || repeat === 'all' ? queue[0] : null;
}
