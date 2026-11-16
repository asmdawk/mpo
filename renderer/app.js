import { FREQUENCIES, PRESETS, normalizedSettings, timeLabel, plural, trackMatches, chooseNext } from './model.js';

const $ = id => document.getElementById(id);
const media = $('media');
const app = $('app');
const bridge = window.zigzak;
const DEMO = { id: 'zigzak-demo', path: '', url: new URL('assets/demo.wav', import.meta.url).href, title: 'Neon Skyline', artist: 'ZigZak Originals', album: 'Первый запуск', duration: 24, format: 'WAV', type: 'audio', favorite: false, addedAt: 1, artwork: 'assets/neon.svg' };
const state = { tracks: [], settings: normalizedSettings(), current: null, view: 'library', query: '', queue: [], history: [], shufflePlayed: new Set(), demo: DEMO, busy: false };
let audioContext, source, analyser, eqFilters = [], eqGain, visualFrame;
let saveTimer, toastTimer, sleepTimer, loadingPosition = 0, dragDepth = 0, failedTracks = new Set();
let importing = false, destroyed = false, loadingTrack = false, initialized = false;
let visualizerColor = '#7df6df';
const pendingFiles = [];
const icons = {
  heart: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  remove: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  playing: '<span class="playing-bars" aria-label="Воспроизводится"><i></i><i></i><i></i></span>'
};
function text(id, value) { if ($(id)) $(id).textContent = value; }
function toast(message, error = false) {
  if (!$('toast')) return;
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  $('toast').classList.toggle('error', error);
  toastTimer = setTimeout(() => $('toast')?.classList.remove('visible'), 4200);
}
function setTheme(theme, save = true) {
  const chosen = ['aurora', 'violet', 'sunset'].includes(theme) ? theme : 'aurora';
  state.settings.theme = chosen;
  document.documentElement.dataset.theme = chosen;
  document.querySelectorAll('[data-action="theme"][data-theme]').forEach(button => {
    const active = button.dataset.theme === chosen;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  visualizerColor = getComputedStyle(document.documentElement).getPropertyValue('--mint').trim() || '#7df6df';
  if (save) persist();
}
function persist(immediate = false) {
  clearTimeout(saveTimer);
  const save = async () => {
    const payload = { tracks: state.tracks, settings: state.settings };
    try {
      if (bridge) await bridge.saveState(payload);
      else localStorage.setItem('zigzak-browser', JSON.stringify({ ...payload, tracks: payload.tracks.filter(t => !t.url.startsWith('blob:')) }));
    } catch { toast('Не удалось сохранить библиотеку. Проверьте доступ к папке приложения.', true); }
  };
  if (immediate) return save();
  saveTimer = setTimeout(save, 500);
}
function currentTrack() { return state.tracks.find(t => t.id === state.current) || null; }
function visibleTracks() {
  const list = state.tracks.filter(t => trackMatches(t, state.view, state.query));
  return state.view === 'recent' ? list.sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0)) : list;
}
function renderLibrary() {
  const visible = visibleTracks();
  const titles = { library: ['Моя библиотека', 'Вся ваша музыка и видео в одном месте'], favorites: ['Избранное', 'То, к чему хочется возвращаться'], video: ['Видео', 'Большой экран для ваших историй'], recent: ['Недавно слушали', 'Продолжайте с любимого момента'] };
  text('section-title', titles[state.view][0]);
  text('section-subtitle', titles[state.view][1]);
  text('track-count', `${visible.length} ${plural(visible.length, ['файл', 'файла', 'файлов'])}`);
  const totalSeconds = visible.reduce((sum, t) => sum + (Number(t.duration) || 0), 0);
  text('library-duration', totalSeconds >= 3600 ? `${Math.floor(totalSeconds / 3600)} ч ${Math.floor(totalSeconds % 3600 / 60)} мин` : `${Math.ceil(totalSeconds / 60)} мин`);
  text('library-count', state.tracks.length);
  text('favorites-count', state.tracks.filter(t => t.favorite).length);
  text('video-count', state.tracks.filter(t => t.type === 'video').length);
  text('recent-count', state.tracks.filter(t => t.lastPlayedAt).length);
  document.querySelectorAll('[data-view]').forEach(el => {
    const active = el.dataset.view === state.view;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  const list = $('track-list');
  if (list) {
    const fragment = document.createDocumentFragment();
    visible.forEach((track, index) => {
      const row = document.createElement('div');
      row.className = `track-row${track.id === state.current ? ' selected current' : ''}`;
      row.dataset.action = 'play-track'; row.dataset.id = track.id;
      row.tabIndex = 0; row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Воспроизвести ${track.title}`);
      const number = document.createElement('span'); number.className = 'track-number';
      if (track.id === state.current && !media.paused) number.innerHTML = icons.playing; else number.textContent = String(index + 1).padStart(2, '0');
      const cover = document.createElement('div'); cover.className = `track-cover cover-${index % 5}`;
      if (track.artwork) { const img = document.createElement('img'); img.src = track.artwork; img.alt = ''; img.loading = 'lazy'; img.addEventListener('error', () => img.remove(), { once: true }); cover.append(img); }
      else cover.textContent = track.type === 'video' ? '▶' : '♪';
      const meta = document.createElement('div'); meta.className = 'track-meta';
      const title = document.createElement('span'); title.className = 'track-name'; title.textContent = track.title;
      const artist = document.createElement('span'); artist.className = 'track-artist'; artist.textContent = track.artist || (track.type === 'video' ? 'Видео' : 'Неизвестный исполнитель');
      meta.append(title, artist);
      const format = document.createElement('span'); format.className = 'track-format'; format.textContent = track.format;
      const duration = document.createElement('span'); duration.className = 'track-duration'; duration.textContent = track.duration ? timeLabel(track.duration) : '—';
      const favorite = document.createElement('button'); favorite.className = `track-favorite${track.favorite ? ' active' : ''}`;
      favorite.dataset.action = 'favorite-track'; favorite.dataset.id = track.id; favorite.innerHTML = icons.heart;
      favorite.title = track.favorite ? 'Убрать из избранного' : 'Добавить в избранное'; favorite.setAttribute('aria-label', favorite.title); favorite.setAttribute('aria-pressed', String(Boolean(track.favorite)));
      const remove = document.createElement('button'); remove.className = 'track-remove'; remove.dataset.action = 'remove-track'; remove.dataset.id = track.id; remove.innerHTML = icons.remove; remove.title = 'Убрать из библиотеки'; remove.setAttribute('aria-label', remove.title);
      row.append(number, cover, meta, format, duration, favorite, remove); fragment.append(row);
    });
    list.replaceChildren(fragment);
  }
  const empty = $('empty-state');
  if (empty) {
    empty.classList.toggle('hidden', visible.length > 0);
    empty.hidden = visible.length > 0;
    const emptyTitle = empty.querySelector('[data-empty-title]');
    const emptyText = empty.querySelector('[data-empty-text]');
    if (emptyTitle) emptyTitle.textContent = state.query ? 'Ничего не найдено' : state.view === 'favorites' ? 'Ваше избранное' : state.view === 'recent' ? 'История начинается здесь' : state.view === 'video' ? 'Время большого экрана' : 'Ваша музыка — ваши правила';
    if (emptyText) emptyText.textContent = state.query ? 'Попробуйте другое название или исполнителя.' : state.view === 'favorites' ? 'Нажмите на сердце рядом с треком — он появится здесь.' : state.view === 'recent' ? 'Включите любой трек: здесь появится история прослушивания.' : 'Добавьте файлы или перетащите их прямо в окно.';
  }
}
function updateControls() {
  const playing = !media.paused && Boolean(state.current);
  app?.classList.toggle('playing', playing);
  if ($('play-button')) { $('play-button').dataset.state = playing ? 'playing' : 'paused'; $('play-button').title = playing ? 'Пауза · Пробел' : 'Воспроизвести · Пробел'; $('play-button').setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести'); }
  for (const [id, value] of [['shuffle-button', state.settings.shuffle], ['repeat-button', state.settings.repeat !== 'off'], ['mute-button', state.settings.muted], ['favorite-button', currentTrack()?.favorite]]) {
    if ($(id)) { $(id).classList.toggle('active', Boolean(value)); $(id).setAttribute('aria-pressed', String(Boolean(value))); }
  }
  if ($('repeat-button')) { $('repeat-button').dataset.repeat = state.settings.repeat; $('repeat-button').title = `Повтор: ${{ off: 'выключен', all: 'всей очереди', one: 'одного трека' }[state.settings.repeat]}`; }
  if ($('mute-button')) $('mute-button').dataset.state = state.settings.muted || !state.settings.volume ? 'muted' : 'audible';
  if ($('volume')) { $('volume').value = state.settings.volume; $('volume').style.setProperty('--progress', `${state.settings.volume}%`); }
  text('volume-value', `${Math.round(state.settings.volume)}%`);
  if ($('speed')) $('speed').value = state.settings.rate;
  updateTime();
}
function updateCurrent() {
  const track = currentTrack();
  text('now-title', track?.title || 'Выберите трек'); text('now-artist', track?.artist || 'Музыка начинается с вас');
  text('now-format', track?.format || 'ZIGZAK');
  text('artwork-title', track?.title || 'Ваш ритм. Ваш мир.'); text('artwork-subtitle', track?.artist || 'Добавьте любимую музыку');
  const art = $('artwork');
  const artwork = track?.artwork || 'assets/neon.svg';
  if (art) { if (art.tagName === 'IMG') { art.src = artwork; art.alt = track ? `Обложка: ${track.title}` : 'ZigZak Player'; art.onerror = () => { if (!art.src.endsWith('/assets/neon.svg')) art.src = 'assets/neon.svg'; }; } else art.style.backgroundImage = `url(${JSON.stringify(artwork)})`; }
  const miniCover = document.querySelector('.mini-cover');
  if (miniCover) { miniCover.src = artwork; miniCover.onerror = () => { if (!miniCover.src.endsWith('/assets/neon.svg')) miniCover.src = 'assets/neon.svg'; }; }
  const badge = document.querySelector('.artwork-badge');
  if (badge) badge.textContent = track?.id === state.demo.id ? 'ZIGZAK ORIGINALS' : track?.type === 'video' ? 'ВАШЕ ВИДЕО' : 'ВАША МУЗЫКА';
  app?.classList.toggle('is-video', track?.type === 'video');
  if ($('video-stage')) $('video-stage').setAttribute('aria-label', track?.type === 'video' ? `Видео: ${track.title}` : 'Видеоплеер');
  if (navigator.mediaSession && track && window.MediaMetadata) {
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album || 'ZigZak Player', artwork: track.artwork ? [{ src: new URL(track.artwork, location.href).href }] : [] }); } catch { /* Optional OS integration. */ }
  }
  updateControls();
}
function updateTime() {
  const duration = Number.isFinite(media.duration) ? media.duration : currentTrack()?.duration || 0;
  const position = Number.isFinite(media.currentTime) ? media.currentTime : 0;
  text('elapsed', timeLabel(position)); text('duration', timeLabel(duration));
  const progress = duration ? Math.min(1000, Math.round(position / duration * 1000)) : 0;
  if ($('seek') && !$('seek').matches(':active')) { $('seek').value = progress; $('seek').style.setProperty('--progress', `${progress / 10}%`); }
  if (navigator.mediaSession?.setPositionState && duration > 0) { try { navigator.mediaSession.setPositionState({ duration, position: Math.min(position, duration), playbackRate: media.playbackRate }); } catch { /* Unavailable for a transient media state. */ } }
}
async function initAudio() {
  if (!audioContext) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    audioContext = new AudioCtor();
    source = audioContext.createMediaElementSource(media);
    eqFilters = FREQUENCIES.map(frequency => { const filter = audioContext.createBiquadFilter(); filter.type = 'peaking'; filter.frequency.value = frequency; filter.Q.value = 1.1; return filter; });
    eqGain = audioContext.createGain();
    analyser = audioContext.createAnalyser(); analyser.fftSize = 128; analyser.smoothingTimeConstant = 0.85;
    source.connect(eqFilters[0]);
    eqFilters.forEach((filter, i) => filter.connect(eqFilters[i + 1] || eqGain));
    eqGain.connect(analyser); analyser.connect(audioContext.destination); applyEQ();
  }
  if (audioContext.state === 'suspended') await audioContext.resume();
}
function applyEQ() {
  eqFilters.forEach((filter, i) => { filter.gain.value = state.settings.eqEnabled ? state.settings.eqValues[i] : 0; });
  if (eqGain) { const boost = state.settings.eqEnabled ? Math.max(0, ...state.settings.eqValues) : 0; eqGain.gain.value = Math.pow(10, -boost / 20); }
}
function drawVisualizer() {
  cancelAnimationFrame(visualFrame);
  const canvas = $('visualizer');
  if (!canvas || !analyser || media.paused) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const values = new Uint8Array(analyser.frequencyBinCount);
  const draw = () => {
    if (destroyed || media.paused) return;
    const width = canvas.clientWidth || 280, height = canvas.clientHeight || 50;
    const scale = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) { canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale); }
    context.setTransform(scale, 0, 0, scale, 0, 0); context.clearRect(0, 0, width, height);
    analyser.getByteFrequencyData(values);
    const bars = Math.min(48, values.length), gap = 3, barWidth = Math.max(1, width / bars - gap);
    context.fillStyle = visualizerColor;
    for (let i = 0; i < bars; i++) { const barHeight = Math.max(2, values[i] / 255 * height); context.globalAlpha = 0.4 + values[i] / 425; context.fillRect(i * width / bars, height - barHeight, barWidth, barHeight); }
    context.globalAlpha = 1; visualFrame = requestAnimationFrame(draw);
  };
  draw();
}
async function playTrack(id, { autoplay = true, reset = false, queue = false, recordHistory = true } = {}) {
  const track = state.tracks.find(t => t.id === id);
  if (!track) return;
  if (queue) { state.queue = visibleTracks().map(t => t.id); state.shufflePlayed.clear(); }
  if (!state.queue.includes(id)) state.queue = state.tracks.map(t => t.id);
  const changed = state.current !== id;
  if (changed && state.current) { if (recordHistory) { state.history.push(state.current); if (state.history.length > 200) state.history.shift(); } rememberPosition(); }
  if (changed || !media.getAttribute('src')) {
    loadingTrack = true;
    loadingPosition = !reset ? Number(state.settings.positions[id]) || 0 : 0;
    state.current = id;
    media.pause(); media.src = track.url;
    media.playbackRate = state.settings.rate;
    media.load();
  } else if (reset) media.currentTime = 0;
  state.settings.lastTrackId = id;
  updateCurrent(); renderLibrary();
  if (autoplay) {
    try {
      await initAudio();
      await media.play();
      state.shufflePlayed.add(track.id);
      track.lastPlayedAt = Date.now(); failedTracks.delete(track.id);
      renderLibrary(); persist();
    } catch (error) {
      if (error.name !== 'AbortError') { toast(error.name === 'NotAllowedError' ? 'Нажмите «Воспроизвести», чтобы включить звук.' : 'Не удалось воспроизвести файл. Попробуйте другой формат или проверьте его доступность.', true); updateControls(); }
    }
  }
}
async function togglePlay() {
  if (!currentTrack()) { const first = visibleTracks()[0] || state.tracks[0]; if (first) await playTrack(first.id, { queue: true }); else await openFiles(); return; }
  if (media.paused) { if (media.ended) media.currentTime = 0; await playTrack(state.current); } else media.pause();
}
function rememberPosition() {
  if (!state.current || loadingTrack || !Number.isFinite(media.currentTime)) return;
  state.settings.positions[state.current] = media.ended ? 0 : Math.floor(media.currentTime);
  const entries = Object.entries(state.settings.positions);
  if (entries.length > 1000) state.settings.positions = Object.fromEntries(entries.slice(-1000));
}
async function nextTrack(ended = false) {
  const queue = (state.queue.length ? state.queue : state.tracks.map(t => t.id)).filter(id => state.tracks.some(t => t.id === id) && !failedTracks.has(id));
  let id;
  if (state.settings.shuffle && !(ended && state.settings.repeat === 'one')) {
    let remaining = queue.filter(item => !state.shufflePlayed.has(item));
    if (!remaining.length) {
      if (ended && state.settings.repeat === 'off') { media.pause(); updateControls(); return; }
      state.shufflePlayed.clear();
      remaining = queue.filter(item => item !== state.current);
      if (!remaining.length) remaining = [...queue];
    }
    id = remaining[Math.floor(Math.random() * remaining.length)];
  } else id = chooseNext(queue, state.current, { repeat: state.settings.repeat, ended });
  if (!id) { media.pause(); updateControls(); return; }
  await playTrack(id, { reset: true });
}
async function previousTrack() {
  if (media.currentTime > 3) { media.currentTime = 0; updateTime(); return; }
  const queue = state.queue.filter(id => state.tracks.some(t => t.id === id));
  let id;
  if (state.settings.shuffle) { while (state.history.length && !id) { const previous = state.history.pop(); if (state.tracks.some(t => t.id === previous)) id = previous; } }
  if (!id) { const index = queue.indexOf(state.current); id = queue[(index - 1 + queue.length) % queue.length]; }
  if (id) await playTrack(id, { reset: true, recordHistory: false });
}
function addTracks(tracks) {
  if (!Array.isArray(tracks)) return;
  let added = 0;
  for (const track of tracks) {
    if (track && typeof track.id === 'string' && typeof track.url === 'string' && !state.tracks.some(t => t.id === track.id)) { state.tracks.push(track); added++; }
  }
  if (added) { state.view = 'library'; state.query = ''; if ($('search')) $('search').value = ''; renderLibrary(); if (!state.current) void playTrack(tracks[0].id, { autoplay: false }); persist(); }
  toast(added ? `Добавлено: ${added} ${plural(added, ['файл', 'файла', 'файлов'])}` : tracks.length ? 'Эти файлы уже в библиотеке' : 'Поддерживаемые медиафайлы не найдены');
}
async function openFiles() {
  if (!bridge) { $('file-input')?.click(); return; }
  if (importing) return;
  try { importing = true; const tracks = await bridge.openFiles(); if (tracks?.length) addTracks(tracks); } catch { toast('Не удалось открыть файлы.', true); } finally { importing = false; }
}
async function openFolder() {
  if (!bridge) { $('folder-input')?.click(); return; }
  if (importing) return;
  try { importing = true; toast('Читаем медиафайлы в папке…'); const tracks = await bridge.openFolder(); if (tracks?.length) addTracks(tracks); } catch { toast('Не удалось прочитать папку.', true); } finally { importing = false; }
}
async function importPlaylist() {
  if (!bridge) { $('playlist-input')?.click(); return; }
  try { const tracks = await bridge.importPlaylist(); if (tracks?.length) addTracks(tracks); } catch { toast('Не удалось импортировать плейлист.', true); }
}
async function exportPlaylist() {
  if (!state.tracks.length) { toast('Сначала добавьте файлы в библиотеку'); return; }
  try {
    if (bridge) { if (await bridge.exportPlaylist(state.tracks)) toast('Плейлист сохранён'); }
    else { const blob = new Blob([JSON.stringify({ name: 'ZigZak Playlist', tracks: state.tracks }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'ZigZak-Playlist.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); toast('Плейлист сохранён'); }
  } catch { toast('Не удалось сохранить плейлист.', true); }
}
function toggleFavorite(id = state.current) {
  const track = state.tracks.find(t => t.id === id);
  if (!track) return;
  track.favorite = !track.favorite; renderLibrary(); updateControls(); persist();
}
function removeTrack(id) {
  const index = state.tracks.findIndex(t => t.id === id);
  if (index < 0) return;
  const [removed] = state.tracks.splice(index, 1);
  state.queue = state.queue.filter(item => item !== id); delete state.settings.positions[id];
  if (id === state.current) { media.pause(); media.removeAttribute('src'); media.load(); state.current = null; const next = state.tracks[index] || state.tracks[index - 1]; if (next) void playTrack(next.id, { autoplay: false }); }
  if (removed.url.startsWith('blob:')) URL.revokeObjectURL(removed.url);
  renderLibrary(); updateCurrent(); persist(); toast('Файл убран из библиотеки');
}
function clearLibrary() {
  media.pause(); media.removeAttribute('src'); media.load();
  state.tracks.forEach(t => { if (t.url.startsWith('blob:')) URL.revokeObjectURL(t.url); });
  state.tracks = []; state.current = null; state.queue = []; state.settings.lastTrackId = null; state.settings.positions = {};
  renderLibrary(); updateCurrent(); persist(); toast('Библиотека очищена. Ваши файлы остаются на диске.');
}
function setVolume(value) { state.settings.volume = Math.max(0, Math.min(100, Number(value) || 0)); if (state.settings.volume > 0) state.settings.muted = false; media.volume = state.settings.volume / 100; media.muted = state.settings.muted; updateControls(); persist(); }
function toggleMute() { state.settings.muted = !state.settings.muted; media.muted = state.settings.muted; updateControls(); persist(); }
function seekBy(seconds) { if (Number.isFinite(media.duration)) { media.currentTime = Math.min(media.duration, Math.max(0, media.currentTime + seconds)); updateTime(); rememberPosition(); persist(); } }
async function fullscreen() {
  if (!currentTrack()) return;
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await (currentTrack().type === 'video' ? $('video-stage') : app).requestFullscreen(); } catch { if (bridge) bridge.windowAction('fullscreen'); else toast('Полноэкранный режим недоступен', true); }
}
function openDialog(id) { const dialog = $(id); if (!dialog) return; if (!dialog.open) dialog.showModal(); }
function closeDialog(id) { $(id)?.close(); }
function setupEQ() {
  const container = $('eq-bands');
  if (container) {
    FREQUENCIES.forEach((frequency, index) => {
      const band = document.createElement('label'); band.className = 'eq-band';
      const value = document.createElement('output'); value.className = 'eq-value'; value.value = `${state.settings.eqValues[index] > 0 ? '+' : ''}${state.settings.eqValues[index]}`;
      const slider = document.createElement('input'); slider.type = 'range'; slider.min = '-12'; slider.max = '12'; slider.step = '1'; slider.value = state.settings.eqValues[index]; slider.dataset.band = index;
      slider.setAttribute('aria-label', `Эквалайзер ${frequency} Гц`); slider.setAttribute('orient', 'vertical');
      const label = document.createElement('span'); label.textContent = frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
      band.append(value, slider, label); container.append(band);
      slider.addEventListener('input', () => { state.settings.eqValues[index] = Number(slider.value); state.settings.eqPreset = 'custom'; value.value = `${Number(slider.value) > 0 ? '+' : ''}${slider.value}`; if ($('eq-preset')) $('eq-preset').value = 'custom'; applyEQ(); persist(); });
    });
  }
  if ($('eq-preset')) {
    $('eq-preset').replaceChildren();
    for (const [key, preset] of Object.entries(PRESETS)) { const option = document.createElement('option'); option.value = key; option.textContent = preset.name; $('eq-preset').append(option); }
    const custom = document.createElement('option'); custom.value = 'custom'; custom.textContent = 'Свой профиль'; $('eq-preset').append(custom);
    $('eq-preset').value = state.settings.eqPreset;
    $('eq-preset').addEventListener('change', () => {
      const preset = PRESETS[$('eq-preset').value]; if (!preset) return;
      state.settings.eqPreset = $('eq-preset').value; state.settings.eqValues = [...preset.values];
      document.querySelectorAll('[data-band]').forEach(slider => { const v = state.settings.eqValues[Number(slider.dataset.band)]; slider.value = v; slider.previousElementSibling.value = `${v > 0 ? '+' : ''}${v}`; }); applyEQ(); persist();
    });
  }
  if ($('eq-enabled')) { $('eq-enabled').checked = state.settings.eqEnabled; $('eq-enabled').addEventListener('change', () => { state.settings.eqEnabled = $('eq-enabled').checked; applyEQ(); persist(); }); }
}
async function browserFiles(files) {
  const supported = /\.(mp3|mp4|wav|m4a|ogg|oga|flac|aac|webm|m4v|opus)$/i;
  const tracks = Array.from(files).filter(f => supported.test(f.name)).map((file, i) => ({ id: `browser-${file.name}-${file.size}-${file.lastModified}`, path: '', url: URL.createObjectURL(file), title: file.name.replace(/\.[^.]+$/, ''), artist: /\.(mp4|webm|m4v)$/i.test(file.name) ? 'Локальное видео' : 'Локальный файл', duration: 0, format: file.name.split('.').pop().toUpperCase(), type: /\.(mp4|webm|m4v)$/i.test(file.name) ? 'video' : 'audio', favorite: false, addedAt: Date.now() + i }));
  addTracks(tracks);
}
const actions = {
  theme: button => setTheme(button.dataset.theme),
  'open-files': openFiles, 'open-folder': openFolder, 'import-playlist': importPlaylist, 'export-playlist': exportPlaylist,
  play: togglePlay, previous: previousTrack, next: () => nextTrack(false),
  shuffle: () => { state.settings.shuffle = !state.settings.shuffle; state.shufflePlayed.clear(); if (state.current) state.shufflePlayed.add(state.current); updateControls(); persist(); toast(state.settings.shuffle ? 'Случайный порядок включён' : 'Случайный порядок выключен'); },
  repeat: () => { state.settings.repeat = { off: 'all', all: 'one', one: 'off' }[state.settings.repeat]; updateControls(); persist(); toast(`Повтор: ${{ off: 'выключен', all: 'всей очереди', one: 'одного трека' }[state.settings.repeat]}`); },
  mute: toggleMute, favorite: () => toggleFavorite(), fullscreen,
  equalizer: () => openDialog('eq-dialog'), 'close-eq': () => closeDialog('eq-dialog'),
  help: () => openDialog('help-dialog'), 'close-help': () => closeDialog('help-dialog'),
  'clear-search': () => { state.query = ''; if ($('search')) $('search').value = ''; renderLibrary(); },
  'clear-library': clearLibrary,
  'play-track': el => playTrack(el.dataset.id, { queue: true }), 'favorite-track': el => toggleFavorite(el.dataset.id), 'remove-track': el => removeTrack(el.dataset.id),
  'play-demo': () => { if (!state.tracks.some(t => t.id === state.demo.id)) { state.tracks.push({ ...state.demo }); renderLibrary(); persist(); } return playTrack(state.demo.id, { queue: true }); },
  minimize: () => bridge?.windowAction('minimize'), maximize: () => bridge?.windowAction('maximize'), close: () => bridge?.windowAction('close')
};
for (const view of ['library', 'favorites', 'video', 'recent']) actions[`view-${view}`] = () => { state.view = view; renderLibrary(); };
function bindEvents() {
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled) return;
    const handler = actions[target.dataset.action];
    if (handler) { event.preventDefault(); Promise.resolve(handler(target)).catch(() => toast('Не удалось выполнить действие. Попробуйте ещё раз.', true)); }
  });
  document.addEventListener('keydown', event => {
    const target = event.target;
    if (target.closest('.track-row') && ['Enter', ' '].includes(event.key) && !target.closest('button')) { event.preventDefault(); void playTrack(target.closest('.track-row').dataset.id, { queue: true }); return; }
    const typing = target.matches('input, textarea, select, [contenteditable=true]');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); void openFiles(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); $('search')?.focus(); return; }
    if (typing || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]')) return;
    if (target.closest('button') && [' ', 'Enter'].includes(event.key)) return;
    switch (event.key.toLowerCase()) {
      case ' ': event.preventDefault(); void togglePlay(); break;
      case 'arrowleft': event.preventDefault(); seekBy(-5); break;
      case 'arrowright': event.preventDefault(); seekBy(5); break;
      case 'arrowup': event.preventDefault(); setVolume(state.settings.volume + 5); break;
      case 'arrowdown': event.preventDefault(); setVolume(state.settings.volume - 5); break;
      case 'm': toggleMute(); break;
      case 'f': void fullscreen(); break;
      case 'n': void nextTrack(false); break;
      case 'p': void previousTrack(); break;
    }
  });
  $('search')?.addEventListener('input', event => { state.query = event.target.value; renderLibrary(); });
  $('volume')?.addEventListener('input', event => setVolume(event.target.value));
  $('seek')?.addEventListener('input', event => { if (Number.isFinite(media.duration)) { media.currentTime = Number(event.target.value) / 1000 * media.duration; event.target.style.setProperty('--progress', `${Number(event.target.value) / 10}%`); updateTime(); } });
  $('seek')?.addEventListener('change', () => { rememberPosition(); persist(); });
  $('speed')?.addEventListener('change', event => { state.settings.rate = Number(event.target.value); media.playbackRate = state.settings.rate; persist(); toast(`Скорость: ${state.settings.rate}×`); });
  $('sleep')?.addEventListener('change', event => { clearTimeout(sleepTimer); const minutes = Number(event.target.value); if (minutes > 0) { sleepTimer = setTimeout(() => { media.pause(); event.target.value = '0'; toast('Таймер сна остановил воспроизведение'); }, minutes * 60_000); toast(`Таймер сна: ${minutes} мин`); } else toast('Таймер сна выключен'); });
  $('file-input')?.addEventListener('change', async event => { await browserFiles(event.target.files); event.target.value = ''; });
  $('folder-input')?.addEventListener('change', async event => { await browserFiles(event.target.files); event.target.value = ''; });
  $('playlist-input')?.addEventListener('change', async event => {
    try { const file = event.target.files[0]; if (!file) return; const data = JSON.parse(await file.text()); const tracks = Array.isArray(data) ? data : data.tracks; if (!Array.isArray(tracks)) throw new Error(); addTracks(tracks.filter(t => t.id === DEMO.id).map(t => ({ ...DEMO, favorite: Boolean(t.favorite) }))); toast('В браузерном предпросмотре импортируются только встроенные файлы. Откройте .exe для полного импорта.'); } catch { toast('Не удалось прочитать плейлист.', true); } event.target.value = '';
  });
  document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
  document.addEventListener('dragenter', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth++; app?.classList.add('drag-over'); } });
  document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) app?.classList.remove('drag-over'); });
  document.addEventListener('drop', async event => { event.preventDefault(); dragDepth = 0; app?.classList.remove('drag-over'); const files = Array.from(event.dataTransfer?.files || []); if (!files.length) return; try { if (bridge?.importDropped) addTracks(await bridge.importDropped(files)); else await browserFiles(files); } catch { toast('Не удалось добавить перетащенные файлы.', true); } });
  media.addEventListener('loadedmetadata', () => { loadingTrack = false; const track = currentTrack(); if (track && Number.isFinite(media.duration)) { track.duration = media.duration; if (loadingPosition > 0 && loadingPosition < media.duration - 1) media.currentTime = loadingPosition; loadingPosition = 0; updateTime(); renderLibrary(); persist(); } });
  media.addEventListener('timeupdate', updateTime);
  media.addEventListener('play', () => { updateControls(); renderLibrary(); drawVisualizer(); if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing'; });
  media.addEventListener('pause', () => { updateControls(); renderLibrary(); rememberPosition(); persist(); cancelAnimationFrame(visualFrame); if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused'; });
  media.addEventListener('ended', () => { rememberPosition(); persist(); void nextTrack(true); });
  media.addEventListener('error', () => { loadingTrack = false; if (!media.getAttribute('src')) return; if (state.current) failedTracks.add(state.current); updateControls(); toast('Файл недоступен или его кодек не поддерживается. Выберите другой файл.', true); });
  media.addEventListener('dblclick', () => void fullscreen());
  for (const id of ['eq-dialog', 'help-dialog']) $(id)?.addEventListener('click', event => { if (event.target === $(id)) { const bounds = $(id).getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $(id).close(); } });
  document.addEventListener('fullscreenchange', () => app?.classList.toggle('is-fullscreen', Boolean(document.fullscreenElement)));
  window.addEventListener('beforeunload', () => { rememberPosition(); if (!bridge) void persist(true); destroyed = true; cancelAnimationFrame(visualFrame); });
  if (bridge?.onFullscreen) bridge.onFullscreen(value => app?.classList.toggle('is-fullscreen', Boolean(value)));
  if (navigator.mediaSession?.setActionHandler) for (const [action, handler] of Object.entries({ play: () => void playTrack(state.current || state.tracks[0]?.id), pause: () => media.pause(), previoustrack: () => void previousTrack(), nexttrack: () => void nextTrack(false), seekbackward: details => seekBy(-(details.seekOffset || 10)), seekforward: details => seekBy(details.seekOffset || 10), seekto: details => { if (Number.isFinite(media.duration)) media.currentTime = details.seekTime; } })) { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* OS support varies. */ } }
}
async function initialize() {
  try {
    if (bridge?.onFiles) bridge.onFiles(tracks => { if (initialized) addTracks(tracks); else if (Array.isArray(tracks)) pendingFiles.push(...tracks); });
    if (bridge?.onBeforeClose) bridge.onBeforeClose(async () => {
      try { if (initialized) { rememberPosition(); await persist(true); } }
      finally { bridge.windowAction('close-ready'); }
    });
    let initial;
    if (bridge) initial = await bridge.getInitialState();
    else { try { initial = JSON.parse(localStorage.getItem('zigzak-browser') || 'null'); } catch { /* Use defaults. */ } initial = initial || { tracks: [DEMO], settings: {} }; }
    state.demo = initial.demo || DEMO;
    state.tracks = Array.isArray(initial.tracks) ? initial.tracks : [state.demo];
    state.settings = normalizedSettings(initial.settings);
    setTheme(state.settings.theme, false);
    media.crossOrigin = 'anonymous'; media.volume = state.settings.volume / 100; media.muted = state.settings.muted; media.playbackRate = state.settings.rate;
    setupEQ(); bindEvents(); renderLibrary();
    const track = state.tracks.find(t => t.id === state.settings.lastTrackId) || state.tracks[0];
    if (track) await playTrack(track.id, { autoplay: false }); else updateCurrent();
    initialized = true;
    if (pendingFiles.length) addTracks(pendingFiles.splice(0));
    text('app-version', `v${initial.version || '1.0.0'}`);
    app?.classList.add('ready');
  } catch (error) { console.error('ZigZak initialization:', error); toast('Не удалось загрузить библиотеку. Перезапустите приложение.', true); }
}
void initialize();
