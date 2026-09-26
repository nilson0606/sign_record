// Real browser + Web Audio input. Deterministic player/helper fixtures isolate session behavior.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { normalizeMasks } from '../scoring.mjs';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT || 'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { chromium } = require('playwright');
const site = `http://localhost:${process.env.PORT || 4273}`;
const root = path.resolve(import.meta.dirname, '..');
const rate = 48000, data = Buffer.alloc(44 + rate * 3 * 2);
data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
for (let i = 0; i < rate * 3; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 10000), 44 + i * 2);
const bsData=Buffer.from(data);
for(let i=0;i<rate*3;i++)bsData.writeInt16LE(Math.round(Math.sin(2*Math.PI*660*i/rate)*10000),44+i*2);
const melData=Buffer.from(data);
for(let i=0;i<rate*3;i++)melData.writeInt16LE(Math.round(Math.sin(2*Math.PI*880*i/rate)*10000),44+i*2);
const audioHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixture = path.join(tmpdir(), `karaoke-flow-${process.pid}.wav`); await writeFile(fixture, data);
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.stderr.once('data', chunk => reject(new Error(chunk.toString()))); });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, args: ['--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fixture}`] });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.YT = { Player: class {
      constructor(id, options) { this.options = options; this.time = 0; this.state = -1; window.fixturePlayer = this; setTimeout(() => options.events.onReady({ target: this }), 5); }
      cueVideoById(videoId) { this.videoId = videoId; this.time = 0; this.state = 5; }
      getCurrentTime() { return this.time + (this.state === 1 ? (performance.now() - this.started) / 1000 : 0); }
      getPlayerState() { return this.state; }
      seekTo(t) { this.lastSeek = t; setTimeout(() => { this.time = t; this.started = performance.now(); }, this.seekDelay || 0); }
      playVideo() { this.lastPlayPosition = this.time; this.started = performance.now(); this.state = 1; this.options.events.onStateChange({ data: 1 }); }
      pauseVideo() { this.time = this.getCurrentTime(); this.state = 2; this.options.events.onStateChange({ data: 2 }); }
      endVideo() { this.time = this.getCurrentTime(); this.state = 0; this.options.events.onStateChange({ data: 0 }); }
      buffer() { this.time = this.getCurrentTime(); this.state = 3; this.options.events.onStateChange({ data: 3 }); }
    }};
  });
  const page = await context.newPage(), errors = [], requests = [], removed = [], previewPaths = [];
  const playingHash=()=>page.evaluate(async()=>{const bytes=await(await fetch(document.querySelector('#stem-audio').src)).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');});
  page.on('pageerror', error => errors.push(error.message));
  const bareRequests=[];
  if(process.env.KARAOKE_SITE_DIR) {
    // A returning browser may still have stale responses at these pre-versioning URLs.
    await page.route(site+'/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      if(/^\/[a-z-]+\.(?:mjs|css)$/.test(pathname)) {
        bareRequests.push(pathname);
        await route.fulfill({body:pathname.endsWith('.css')?'body{display:none}':"throw new Error('Cached old release loaded')",contentType:pathname.endsWith('.css')?'text/css':'text/javascript'});
      } else await route.fallback();
    });
  }

  let serial=0, firstPoll=true, failMaskSave=false;
  const library=new Map(), jobs=new Map(), masks=new Map();
  const key=r=>[r.videoId,r.seconds,r.separationModel||'demucs',r.separationMethod||'single',r.pitchMethod||'yin',r.vocalMode||'all'].join('_');
  function saved(r,hasPreview=true){return {version:1,videoId:r.videoId,cacheId:key(r),title:r.title||'試聽測試歌曲',step:.1,duration:30,frames:Array(300).fill(440),rangeSeconds:r.seconds,separationModel:r.separationModel||'demucs',separationMethod:r.separationMethod||'single',pitchMethod:r.pitchMethod||'yin',vocalMode:r.vocalMode||'all',hasPreview,beats:[],bpm:0};}
  const legacy=[];
  for(const model of ['demucs','bs-roformer','mel-roformer'])for(const method of ['single','residual']){
    const r=saved({videoId:'M7lc1UVf-VE',seconds:30,separationModel:model,separationMethod:method,pitchMethod:'yin',vocalMode:'lead',title:'既有版本 · '+model+' · '+method});
    library.set(r.cacheId,r);legacy.push(r);
  }
  await page.route('http://127.0.0.1:4274/**',async route=>{
    const req=route.request(),url=new URL(req.url());let value={};
    if(url.pathname==='/session')value={token:'fixture',features:['library','library-location','separation-progress','rebuild-song','lead-vocals','score-masks','mel-roformer','residual-separation','pitch-methods','separation-models']};
    else if(url.pathname==='/library/location')value={configured:true,path:'C:/fixture-only'};
    else if(url.pathname==='/library')value={songs:[...library.values()].map(r=>({...r,id:r.cacheId,seconds:r.rangeSeconds,bytes:1000}))};
    else if(url.pathname.endsWith('/masks')&&req.method()==='POST'){
      if(failMaskSave){await route.fulfill({status:400,json:{error:'Fixture disk write failure'},headers:{'Access-Control-Allow-Origin':site}});return;}
      const ref=library.get(url.pathname.split('/')[2]);const rows=normalizeMasks(req.postDataJSON().masks,ref.duration);masks.set(ref.videoId+'_'+ref.rangeSeconds,rows);value={masks:rows};
    }else if(req.method()==='DELETE')value={cleared:true};
    else if(url.pathname==='/jobs'&&req.method()==='POST'){
      const r=req.postDataJSON();requests.push(r);const id=String(++serial).padStart(32,'0');
      const ref=library.get(key(r))||saved(r,serial!==1);if(serial>1)ref.hasPreview=true;
      library.set(ref.cacheId,ref);jobs.set(id,ref);value={id};
    }else if(url.pathname.endsWith('/reference')){
      const ref=jobs.get(url.pathname.split('/')[2]);value={...ref,masks:masks.get(ref.videoId+'_'+ref.rangeSeconds)||[]};
    }else if(url.pathname.startsWith('/library/')){
      previewPaths.push(url.pathname);await route.fulfill({body:url.pathname.includes('mel-roformer')?melData:url.pathname.includes('bs-roformer')?bsData:data,contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':site}});return;
    }else if(url.pathname.startsWith('/jobs/')&&firstPoll){firstPoll=false;value={stage:'separating',progress:100,ready:false};}
    else value={stage:'ready',ready:true};
    await route.fulfill({json:value,headers:{'Access-Control-Allow-Origin':site}});
  });
  await page.goto(site+'/');
  for(const id of ['voice-settings','recording-settings','prepare-settings','timing-section','score-settings'])assert.equal(await page.locator('#'+id).evaluate(el=>el.open),false);
  assert.equal(await page.locator('#prepare-settings #mask-panel').count(),1);
  assert.equal(await page.locator('#prepare-settings #preview-panel').count(),1);
  assert.equal(await page.locator('#player-section #mask-panel').count(),0);
  for(const id of ['sing-start','finish-song','total-score','pitch-score','rhythm-score','coverage-score','score-status','recording-status'])assert.equal(await page.locator('#player-section #'+id).count(),1);
  assert.equal(await page.locator('#score-section').evaluate(el=>el.previousElementSibling.classList.contains('clock-row')),true);
  assert.ok(await page.locator('#recording-mode').isHidden());
  assert.ok(await page.locator('#capture-mode').isHidden());
  assert.equal(await page.locator('#prepare-section #library-panel').count(),0);
  assert.equal(await page.locator('#library-section #library-panel').count(),1);
  assert.ok(await page.locator('#mic-start').isVisible());
  assert.ok(await page.locator('#recording-status').isVisible());
  assert.ok(await page.evaluate(()=>document.querySelector('#voice-settings').compareDocumentPosition(document.querySelector('#local-section'))&Node.DOCUMENT_POSITION_FOLLOWING));
  assert.ok(await page.locator('#prepare-song').isVisible());
  assert.ok(await page.locator('#score-difficulty').isHidden());
  const duplicates=await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(x=>x.id);return ids.filter((x,i)=>ids.indexOf(x)!==i);});assert.deepEqual(duplicates,[]);
  await page.locator('#prepare-settings > summary').click();
  assert.ok(await page.locator('#preview-vocals').isVisible());assert.ok(await page.locator('#mask-start').isVisible());
  assert.equal(await page.locator('#prepare-settings select:visible').count(),0);
  await page.locator('#url').fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');
  await page.locator('#prepare-song').click();
  await page.waitForFunction(()=>document.querySelector('#prepare-progress-label').textContent.includes('100%'));
  assert.ok(await page.locator('#preview-vocals').isDisabled());
  await page.locator('#prepare-settings > summary').click();
  assert.ok(await page.locator('#prepare-progress-panel').isVisible());assert.ok(await page.locator('#cancel-song').isVisible());
  await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  assert.equal(requests[0].seconds,0);assert.equal(requests[0].pitchMethod,'rmvpe');assert.equal(requests[0].preview,true);
  assert.equal(requests[0].separationModel||'demucs','demucs');assert.equal(requests[0].separationMethod||'single','single');assert.equal(requests[0].vocalMode||'all','all');
  await page.locator('#prepare-settings > summary').click();
  assert.ok(await page.locator('#preview-build').isEnabled());await page.locator('#preview-build').click();
  await page.waitForFunction(()=>!document.querySelector('#preview-vocals').disabled);
  await page.locator('#preview-vocals').click();await page.waitForFunction(()=>!document.querySelector('#stem-audio').paused);
  assert.equal(await playingHash(),audioHash(data));
  const src=await page.locator('#stem-audio').getAttribute('src');
  await page.locator('#prepare-settings > summary').click();
  assert.equal(await page.locator('#stem-audio').getAttribute('src'),src);assert.equal(await page.locator('#stem-audio').evaluate(el=>el.paused),false);
  // Deep links expand containing details without replacing the player or audio nodes.
  await page.evaluate(()=>{window.previewNode=document.querySelector('#stem-audio');location.hash='#mask-panel';});
  await page.waitForFunction(()=>document.querySelector('#prepare-settings').open);
  assert.equal(await page.evaluate(()=>previewNode===document.querySelector('#stem-audio')),true);
  await page.locator('#mask-start').fill('2');await page.locator('#mask-end').fill('4');await page.locator('#mask-add').click();
  await page.waitForFunction(()=>document.querySelector('#mask-list').children.length===1);
  failMaskSave=true;await page.locator('#mask-start').fill('6');await page.locator('#mask-end').fill('8');await page.locator('#mask-add').click();
  await page.waitForFunction(()=>document.querySelector('#mask-status').textContent.includes('未保存'));
  assert.equal(await page.locator('#mask-list li').count(),1);failMaskSave=false;
  await page.locator('#library-panel > summary').click();
  for(const r of legacy){
    await page.locator(`[data-song-id="${r.cacheId}"]`).click();
    await page.waitForFunction(id=>document.querySelector(`[data-song-id="${id}"]`)?.getAttribute('aria-current')==='true',r.cacheId);
    const request=requests.at(-1);assert.equal(request.seconds,30);assert.equal(request.pitchMethod||'yin','yin');assert.equal(request.vocalMode,'lead');assert.equal(request.separationModel||'demucs',r.separationModel);assert.equal(request.separationMethod||'single',r.separationMethod);
    await page.locator('#preview-lead').click();await page.waitForFunction(()=>!document.querySelector('#stem-audio').paused);
    assert.equal(await playingHash(),audioHash(r.separationModel==='mel-roformer'?melData:r.separationModel==='bs-roformer'?bsData:data));
  }
  await page.locator('#rebuild-song').click();await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  assert.equal(requests.at(-1).force,true);assert.equal(requests.at(-1).seconds,30);assert.equal(requests.at(-1).separationModel,'mel-roformer');
  // A normal preparation returns to the agreed preset after viewing a legacy version.
  await page.locator('#prepare-song').click();await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  assert.equal(requests.at(-1).seconds,0);assert.equal(requests.at(-1).pitchMethod,'rmvpe');assert.equal(requests.at(-1).separationModel||'demucs','demucs');
  await page.locator('.section-nav a[href="#timing-section"]').click();assert.equal(await page.locator('#timing-section').evaluate(el=>el.open),true);
  await page.locator('#timing-section > summary').click();
  await page.locator('#score-settings > summary').focus();await page.keyboard.press('Enter');assert.ok(await page.locator('#score-difficulty').isVisible());
  await page.locator('#score-difficulty').selectOption('strict');await page.locator('#score-settings > summary').click();assert.equal(await page.locator('#score-difficulty').inputValue(),'strict');
  // Collapsing tools during a take must not stop capture, playback or recording.
  await page.locator('#sing-start').click();await page.waitForFunction(()=>document.querySelector('#recording-status').textContent.includes('● 錄音中'));
  await page.evaluate(()=>{window.playerBeforeFold=fixturePlayer;});
  await page.locator('#prepare-settings > summary').click();
  await page.locator('#timing-section > summary').click();await page.locator('#timing-section > summary').click();
  await page.locator('#score-settings > summary').click();await page.locator('#score-settings > summary').click();
  assert.equal(await page.evaluate(()=>fixturePlayer===playerBeforeFold&&fixturePlayer.getPlayerState()===1),true);
  for(const id of ['voice-settings','recording-settings']){await page.locator('#'+id+' > summary').click();await page.locator('#'+id+' > summary').click();}
  assert.match(await page.locator('#recording-status').textContent(),/● 錄音中/);assert.ok(await page.locator('#mic-stop').isEnabled());
  await page.locator('#finish-song').click();await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('已結算'));
  assert.ok(await page.locator('#mic-stop').isDisabled());
  await page.locator('#library-panel > summary').click();
  // Verify the real desktop section order in both themes.
  for(const theme of ['current','warm'])for(const width of [1440]){
    await page.setViewportSize({width,height:1100});await page.locator('#theme-select').selectOption(theme);
    const order=['player-section','voice-section','prepare-section','library-section','recording-post','timing-section','recording-section'];
    assert.deepEqual(await page.locator('.layout > [id]').evaluateAll(nodes=>nodes.map(n=>n.id)),order);
    const playerBox=await page.locator('#player-section').boundingBox(),voiceBox=await page.locator('#voice-section').boundingBox();
    assert.ok(Math.abs(playerBox.y-voiceBox.y)<1);
    assert.ok(voiceBox.x>=playerBox.x+playerBox.width);
    assert.ok(Math.abs(playerBox.width-voiceBox.width)<1);
    let bottom=Math.max(playerBox.y+playerBox.height,voiceBox.y+voiceBox.height);
    for(const id of order.slice(2)){const box=await page.locator('#'+id).boundingBox();assert.ok(box.y>=bottom);assert.ok(Math.abs(box.x-playerBox.x)<1);assert.ok(Math.abs(box.width-(voiceBox.x+voiceBox.width-playerBox.x))<1);bottom=box.y+box.height;}
    await page.locator('#player-section').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
    await page.screenshot({path:`test-results/ui-v15-${theme}-${width}-performance.png`});
    await page.locator('#prepare-section').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:`test-results/ui-v15-${theme}-${width}-closed.png`});
    await page.locator('#prepare-settings > summary').click();
    await page.locator('#prepare-section').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('#prepare-settings').screenshot({path:`test-results/ui-v15-${theme}-${width}-open.png`});
    await page.locator('#prepare-settings > summary').click();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(bareRequests,[]);
  console.log('UI folds, fixed preparation preset, visible progress, preview continuity, masks and failed saves, six legacy model/flow versions, legacy rebuild, keyboard/deep-link navigation, recording continuity and both desktop themes passed.');
} finally {await browser?.close();server.kill();await rm(fixture,{force:true});}
