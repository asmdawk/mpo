const { app, BrowserWindow, dialog, ipcMain, protocol, Menu, nativeImage } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { VIDEO, supported, stableId, mediaMime, parseByteRange, cleanSettings, parsePlaylist } = require('./core.cjs');

app.setName('ZigZak Player');
protocol.registerSchemesAsPrivileged([{scheme:'zigzak-media',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
const grants = new Map();
let win, stateFile, demo, ready = false, saveChain = Promise.resolve();
let closeRequested = false, closeAllowed = false, closeTimer;
const pendingPaths = [];
const filters = [{name:'Музыка и видео',extensions:['mp3','mp4','wav','flac','ogg','oga','m4a','aac','opus','webm','m4v','mov','mkv','aif','aiff']}];
const own = event => !!win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
const guard = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {if (!own(event)) throw new Error('Access denied'); return fn(...args);});

async function createTrack(file, existing = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !supported(file)) return null;
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return null;
    const id = stableId(file);
    let metadata = {};
    try {
      const { parseFile } = await import('music-metadata');
      metadata = await parseFile(file, {duration:true, skipCovers:false});
    } catch {}
    const common = metadata.common || {};
    const title = (common.title || path.basename(file,path.extname(file))).slice(0,400);
    const artist = (common.artist || (VIDEO.has(path.extname(file).toLowerCase()) ? 'Локальное видео' : 'Неизвестный исполнитель')).slice(0,400);
    let artwork;
    const picture = common.picture?.[0];
    if (picture && picture.data?.length < 3 * 1024 * 1024 && /^image\/(png|jpe?g|webp|gif)$/.test(picture.format)) artwork = `data:${picture.format};base64,${Buffer.from(picture.data).toString('base64')}`;
    grants.set(id, file);
    return {id,path:file,url:`zigzak-media://file/${id}`,title,artist,album:String(common.album || '').slice(0,400),duration:Number.isFinite(metadata.format?.duration) ? metadata.format.duration : 0,format:path.extname(file).slice(1).toUpperCase(),type:VIDEO.has(path.extname(file).toLowerCase()) ? 'video' : 'audio',favorite:!!existing.favorite,addedAt:Number(existing.addedAt) || Date.now(),lastPlayedAt:Number(existing.lastPlayedAt)||0,...(artwork ? {artwork} : {})};
  } catch { return null; }
}

async function importPaths(paths, existing = new Map()) {
  const unique = [...new Set(paths.filter(p=>typeof p === 'string' && p.length < 32768))].slice(0,10000);
  const tracks = [];
  for (let i=0;i<unique.length;i+=6) {
    const group = await Promise.all(unique.slice(i,i+6).map(p=>createTrack(p, existing.get(p))));
    tracks.push(...group.filter(Boolean));
  }
  return tracks;
}

async function walkFolder(dir, depth = 0, results = []) {
  if (depth > 12 || results.length >= 10000) return results;
  let entries; try {entries = await fsp.readdir(dir,{withFileTypes:true});} catch {return results;}
  for (const entry of entries) {
    if (results.length >= 10000) break;
    const full = path.join(dir,entry.name);
    if (entry.isDirectory()) await walkFolder(full,depth+1,results);
    else if (entry.isFile() && supported(full)) results.push(full);
  }
  return results;
}

async function initializeState() {
  stateFile = path.join(app.getPath('userData'),'library.json');
  const demoPath = path.join(__dirname,'../renderer/assets/demo.wav');
  demo = await createTrack(demoPath);
  if (demo) {
    grants.delete(demo.id);
    Object.assign(demo,{id:'zigzak-demo',url:'zigzak-media://file/zigzak-demo',title:'Neon Skyline',artist:'ZigZak Originals',album:'First light',artwork:'assets/neon.svg',isDemo:true});
    grants.set(demo.id,demo.path);
  }
}

async function initialState() {
  let saved;
  try { const stat = await fsp.stat(stateFile); if (stat.size < 25*1024*1024) saved=JSON.parse(await fsp.readFile(stateFile,'utf8')); } catch {}
  let tracks = demo ? [demo] : [];
  if (Array.isArray(saved?.tracks)) {
    const valid=saved.tracks.filter(t=>t && typeof t.path==='string').slice(0,10000);
    const paths=valid.map(t=>t.isDemo ? demo?.path : t.path).filter(Boolean);
    tracks=await importPaths(paths,new Map(valid.map(t=>[t.isDemo ? demo?.path : t.path,t])));
    tracks=tracks.map(t=>t.path===demo?.path ? {...demo,favorite:t.favorite,addedAt:t.addedAt,lastPlayedAt:t.lastPlayedAt} : t);
  }
  return {tracks,settings:cleanSettings(saved?.settings),demo,version:app.getVersion()};
}

async function saveState(state) {
  if (!state || !Array.isArray(state.tracks)) return;
  const tracks = state.tracks.slice(0,10000).filter(t=>t && grants.has(t.id)).map(t=>({path:grants.get(t.id),favorite:!!t.favorite,addedAt:Number(t.addedAt)||Date.now(),lastPlayedAt:Number(t.lastPlayedAt)||0,isDemo:t.id===demo?.id}));
  const data=JSON.stringify({version:1,tracks,settings:cleanSettings(state.settings)});
  saveChain=saveChain.catch(()=>{}).then(async()=>{
    await fsp.mkdir(path.dirname(stateFile),{recursive:true});
    const temporary=`${stateFile}.tmp`;
    await fsp.writeFile(temporary,data,'utf8');
    await fsp.rename(temporary,stateFile);
  });
  return saveChain;
}

function registerProtocol() {
  protocol.handle('zigzak-media', async request => {
    const headers={'Access-Control-Allow-Origin':'*','Accept-Ranges':'bytes','Cache-Control':'no-store'};
    try {
      const url=new URL(request.url);
      const id=url.pathname.replace(/^\//,'');
      const file=url.hostname==='file' ? grants.get(id) : null;
      if (!file || !['GET','HEAD'].includes(request.method)) return new Response(null,{status:404,headers});
      const stat=await fsp.stat(file);
      const range=parseByteRange(request.headers.get('Range'),stat.size);
      if (range===false) return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${stat.size}`}});
      const start=range?.start ?? 0, end=range?.end ?? stat.size-1;
      headers['Content-Type']=mediaMime(file);
      headers['Content-Length']=String(Math.max(0,end-start+1));
      if (range) headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
      if(request.method==='HEAD' || !stat.size) return new Response(null,{status:range?206:200,headers});
      const stream=fs.createReadStream(file,{start,end});
      return new Response(Readable.toWeb(stream),{status:range?206:200,headers});
    } catch { return new Response(null,{status:404,headers}); }
  });
}

function registerIpc() {
  guard('state:get',initialState);
  guard('state:save',saveState);
  guard('files:open',async()=>{
    const {canceled,filePaths}=await dialog.showOpenDialog(win,{title:'Добавить в ZigZak Player',properties:['openFile','multiSelections'],filters});
    return canceled?[]:importPaths(filePaths);
  });
  guard('folder:open',async()=>{
    const {canceled,filePaths}=await dialog.showOpenDialog(win,{title:'Выберите папку с музыкой или видео',properties:['openDirectory']});
    return canceled?[]:importPaths(await walkFolder(filePaths[0]));
  });
  guard('files:import',async paths=>Array.isArray(paths)?importPaths(paths):[]);
  guard('playlist:import',async()=>{
    const {canceled,filePaths}=await dialog.showOpenDialog(win,{title:'Открыть плейлист',properties:['openFile'],filters:[{name:'Плейлисты',extensions:['m3u','m3u8','json']}]});
    if(canceled)return [];
    const stat=await fsp.stat(filePaths[0]);
    if(stat.size>10*1024*1024)throw new Error('Плейлист слишком большой');
    return importPaths(parsePlaylist(await fsp.readFile(filePaths[0],'utf8'),filePaths[0]));
  });
  guard('playlist:export',async tracks=>{
    if(!Array.isArray(tracks))return false;
    const {canceled,filePath}=await dialog.showSaveDialog(win,{title:'Сохранить плейлист',defaultPath:'ZigZak Playlist.m3u8',filters:[{name:'Плейлист M3U8',extensions:['m3u8']}]});
    if(canceled || !filePath)return false;
    const entries=tracks.filter(t=>t && grants.has(t.id)).map(t=>`#EXTINF:${Math.round(Number(t.duration)||-1)},${String(t.title||'').replace(/[\r\n]/g,' ')}\n${grants.get(t.id).replace(/[\r\n]/g,'')}`);
    await fsp.writeFile(filePath,'#EXTM3U\n'+entries.join('\n')+'\n','utf8');
    return true;
  });
  ipcMain.on('window:action',(event,action)=>{
    if(!own(event))return;
    if(action==='minimize')win.minimize();
    if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();
    if(action==='close')win.close();
    if(action==='close-ready' && closeRequested)void finishClose();
    if(action==='fullscreen')win.setFullScreen(!win.isFullScreen());
  });
}

async function finishClose() {
  if(closeAllowed)return;
  closeAllowed=true;
  clearTimeout(closeTimer);
  try {await saveChain;} catch {}
  win?.close();
}

async function queueFiles(paths) {
  const filtered=paths.filter(p=>typeof p==='string' && path.isAbsolute(p) && supported(p));
  if(!ready){pendingPaths.push(...filtered);return;}
  const tracks=await importPaths(filtered);
  if(tracks.length)win?.webContents.send('files:added',tracks);
}

function createWindow() {
  closeRequested=false;closeAllowed=false;
  win=new BrowserWindow({width:1440,height:920,minWidth:1024,minHeight:700,backgroundColor:'#0b0d11',frame:false,title:'ZigZak Player',icon:nativeImage.createFromPath(path.join(__dirname,'../resources/icon.png')),show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:false}});
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((webContents,permission,callback)=>callback(webContents===win?.webContents && permission==='fullscreen'));
  win.webContents.session.setPermissionCheckHandler((webContents,permission)=>webContents===win?.webContents && permission==='fullscreen');
  win.webContents.on('did-finish-load',()=>{ready=true; if(pendingPaths.length)queueFiles(pendingPaths.splice(0));});
  win.on('enter-full-screen',()=>win.webContents.send('window:fullscreen',true));
  win.on('leave-full-screen',()=>win.webContents.send('window:fullscreen',false));
  win.once('ready-to-show',()=>win.show());
  win.on('close',event=>{
    if(closeAllowed)return;
    event.preventDefault();
    if(closeRequested)return;
    closeRequested=true;
    win.webContents.send('window:before-close');
    closeTimer=setTimeout(()=>void finishClose(),1800);
  });
  win.on('closed',()=>{ready=false;win=null;});
  win.loadFile(path.join(__dirname,'../renderer/index.html'));
}

const lock=app.requestSingleInstanceLock();
if(!lock)app.quit();
else {
  app.on('second-instance',(_event,argv)=>{if(win){if(win.isMinimized())win.restore();win.focus();}queueFiles(argv.slice(1));});
  app.whenReady().then(async()=>{
    Menu.setApplicationMenu(null);
    await initializeState();
    registerProtocol();registerIpc();createWindow();
    queueFiles(process.argv.slice(app.isPackaged?1:2));
    app.on('activate',()=>{if(!win)createWindow();});
  }).catch(error=>{dialog.showErrorBox('ZigZak Player',String(error.message||error));app.quit();});
  app.on('window-all-closed',()=>app.quit());
}
