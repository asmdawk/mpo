import { chromium, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.ttf':'font/ttf','.wav':'audio/wav','.mp3':'audio/mpeg','.mp4':'video/mp4'};
const server = http.createServer(async(req,res)=>{
  try {
    const file=path.resolve(root, '.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    const stat=await fsp.stat(file); let start=0,end=stat.size-1,status=200;
    const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
    const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes'};
    if(range){start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;status=206;headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;}
    headers['Content-Length']=end-start+1;
    res.writeHead(status,headers);fs.createReadStream(file,{start,end}).pipe(res);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1440,height:920}});
const errors=[]; const checks=[];
page.on('pageerror',error=>errors.push(error.message));
const check=async(name,fn)=>{await fn();checks.push(name);console.log(`PASS ${name}`);};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);
  await check('initial library and local assets',async()=>{await expect(page.locator('.track-row')).toHaveCount(1);await expect(page.locator('#now-title')).toHaveText('Neon Skyline');await page.waitForFunction(()=>document.querySelector('#media').duration>20);});
  await check('real demo playback advances and pauses',async()=>{await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('#media').currentTime>0.3);await expect(page.locator('#app')).toHaveClass(/playing/);await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('#media').paused);});
  await check('seek, volume and keyboard controls',async()=>{await page.locator('#seek').fill('500');await page.locator('#seek').dispatchEvent('input');await page.locator('#seek').dispatchEvent('change');expect(await page.locator('#media').evaluate(el=>el.currentTime)).toBeGreaterThan(11);await page.locator('#volume').fill('36');await page.locator('#volume').dispatchEvent('input');expect(await page.locator('#media').evaluate(el=>el.volume)).toBeCloseTo(.36);await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('m');expect(await page.locator('#media').evaluate(el=>el.muted)).toBe(true);await page.keyboard.press('m');expect(await page.locator('#media').evaluate(el=>el.muted)).toBe(false);});
  await check('favorites and search filters',async()=>{await page.locator('#favorite-button').click();await page.locator('[data-action=view-favorites]').click();await expect(page.locator('.track-row')).toHaveCount(1);await page.locator('#search').fill('nothing like this');await expect(page.locator('.track-row')).toHaveCount(0);await page.locator('#search').fill('neon');await expect(page.locator('.track-row')).toHaveCount(1);await page.locator('#search').fill('');await page.locator('[data-action=view-library]').click();});
  await check('EQ presets and playback rate',async()=>{await page.locator('[data-action=equalizer]').first().click();await expect(page.locator('#eq-dialog')).toBeVisible();await expect(page.locator('#eq-bands input')).toHaveCount(10);await page.locator('#eq-enabled').check();await page.locator('#eq-preset').selectOption('bass');await expect(page.locator('[data-band="0"]')).toHaveValue('6');await page.locator('#speed').selectOption('1.25');expect(await page.locator('#media').evaluate(el=>el.playbackRate)).toBe(1.25);await page.locator('[data-action=close-eq]').click();});
  await check('import and play actual MP3',async()=>{await page.locator('#file-input').setInputFiles(path.join(root,'tests/fixtures/sample.mp3'));await expect(page.locator('.track-row')).toHaveCount(2);await page.locator('.track-row').filter({has:page.locator('.track-format',{hasText:'MP3'})}).click();await page.waitForFunction(()=>{const m=document.querySelector('#media');return m.currentTime>.2 && !m.paused && m.duration>3;});await page.locator('#play-button').click();});
  await check('import and decode actual MP4 H264/AAC',async()=>{await page.locator('#file-input').setInputFiles(path.join(root,'tests/fixtures/sample.mp4'));await expect(page.locator('.track-row')).toHaveCount(3);await page.locator('.track-row').filter({has:page.locator('.track-format',{hasText:'MP4'})}).click();await page.waitForFunction(()=>{const m=document.querySelector('#media');return m.currentTime>.2 && !m.paused && m.videoWidth===480;});await expect(page.locator('#app')).toHaveClass(/is-video/);await page.locator('#play-button').click();});
  await check('video view filters',async()=>{await page.locator('[data-action=view-video]').click();await expect(page.locator('.track-row')).toHaveCount(1);await expect(page.locator('.track-row .track-format')).toHaveText('MP4');await page.locator('[data-action=view-library]').click();});
  await check('dialogs and hotkeys',async()=>{await page.locator('[data-action=help]').click();await expect(page.locator('#help-dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#help-dialog')).not.toBeVisible();await page.keyboard.press('Control+f');await expect(page.locator('#search')).toBeFocused();await page.locator('#search').blur();});
  await check('Aurora, Violet and Sunset themes apply and persist',async()=>{
    const colors=[];
    for(const theme of ['aurora','violet','sunset']){
      const control=page.locator(`[data-action="theme"][data-theme="${theme}"]`);
      await control.click();
      await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
      await expect(control).toHaveAttribute('aria-pressed','true');
      await expect(page.locator('[data-action="theme"].active')).toHaveCount(1);
      colors.push(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--mint').trim()));
    }
    expect(new Set(colors).size).toBe(3);
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('zigzak-browser')||'{}').settings?.theme==='sunset');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme','sunset');
    await expect(page.locator('[data-action="theme"][data-theme="sunset"]')).toHaveAttribute('aria-pressed','true');
  });
  await check('no horizontal overflow at desktop sizes',async()=>{for(const viewport of [{width:1440,height:920},{width:1024,height:700}]){await page.setViewportSize(viewport);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);for(const selector of ['#play-button','#search','#seek','.add-button','[data-action="theme"][data-theme="aurora"]','[data-action="theme"][data-theme="violet"]','[data-action="theme"][data-theme="sunset"]']){const control=page.locator(selector);expect(await control.isVisible()).toBe(true);const bounds=await control.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width+1);expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height+1);}}});
  const preview=await browser.newPage({viewport:{width:1440,height:920}});
  await preview.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);
  await expect(preview.locator('.track-row')).toHaveCount(1);
  await expect(preview.locator('html')).toHaveAttribute('data-theme','aurora');
  await preview.locator('[data-action=play-demo]').click();
  await preview.waitForFunction(()=>document.querySelector('#media').currentTime>.5);
  await preview.evaluate(()=>document.fonts.ready);
  await preview.waitForTimeout(500);
  await preview.screenshot({path:path.join(root,'tests/preview.png')});
  await check('no runtime JavaScript exceptions',async()=>expect(errors).toEqual([]));
  console.log(JSON.stringify({passed:checks.length,errors},null,2));
} finally {await browser.close();server.close();}
