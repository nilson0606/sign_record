// Real browser + Web Audio input. Deterministic player/helper fixtures isolate session behavior.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { normalizeMasks } from '../scoring.mjs';
import {rescoreRecording} from '../recording-process.mjs';
import {PITCH_DETECTOR_VERSION} from '../audio.mjs';
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
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, args: ['--mute-audio','--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fixture}`] });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.YT = { Player: class {
      constructor(id, options) { this.options = options; this.videoId = options.videoId; this.time = 0; this.state = -1; window.fixturePlayer = this; setTimeout(() => options.events.onReady({ target: this }), 5); }
      cueVideoById(videoId) { this.videoId = videoId; this.time = 0; this.state = 5; }
      getCurrentTime() { return this.time + (this.state === 1 ? (performance.now() - this.started) / 1000 : 0); }
      getPlayerState() { return this.state; }
      getVideoData() { return {video_id:this.videoId}; }
      isMuted() { return false; }
      getVolume() { return 100; }
      seekTo(t) { this.lastSeek = t; setTimeout(() => { this.time = t; this.started = performance.now(); }, this.seekDelay || 0); }
      playVideo() { this.lastPlayPosition = this.time; this.started = performance.now(); this.state = 1; this.options.events.onStateChange({ data: 1 }); }
      pauseVideo() { this.time = this.getCurrentTime(); this.state = 2; this.options.events.onStateChange({ data: 2 }); }
      endVideo() { this.time = this.getCurrentTime(); this.state = 0; this.options.events.onStateChange({ data: 0 }); }
      buffer() { this.time = this.getCurrentTime(); this.state = 3; this.options.events.onStateChange({ data: 3 }); }
    }};
  });
  const page=await context.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let serial=0, hasPreview=true, backingRequests=0, harmonyRequests=0, vocalMode='all', missingHarmony=false; const stemRequests=[],playbackTraces=[];
  let fixturePitch='yin',fixtureHz=440;
  const ref=()=>({version:1,videoId:'M7lc1UVf-VE',title:'Recording fixture',cacheId:`M7lc1UVf-VE_30_${vocalMode}_${fixturePitch}_v1`,step:.1,duration:30,rangeSeconds:30,frames:Array(300).fill(fixtureHz),pitchMethod:fixturePitch,beats:[],bpm:0,hasPreview,vocalMode});
  await page.route('http://127.0.0.1:4274/**',async route=>{
    const req=route.request(),url=new URL(req.url());let value={};
    if(url.pathname==='/session')value={token:'fixture',features:['library','library-location','separation-progress','rebuild-song','lead-vocals','score-masks','pitch-methods','separation-models','recording-mp3','playback-trace']};
    else if(url.pathname==='/playback-trace'){playbackTraces.push(req.postDataJSON());value={saved:true};}
    else if(url.pathname==='/library/location')value={configured:true,path:'C:/fixture'};
    else if(url.pathname==='/library')value={songs:[{...ref(),id:ref().cacheId,seconds:30,bytes:1000}]};
    else if(url.pathname.endsWith('/backing')) {harmonyRequests++;stemRequests.push('backing');await route.fulfill({status:missingHarmony?404:200,body:missingHarmony?'missing':melData,contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':site}});return;}
    else if(url.pathname.endsWith('/accompaniment')) {backingRequests++;stemRequests.push('accompaniment');await route.fulfill({body:bsData,contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':site}});return;}
    else if(url.pathname==='/recordings/mp3'){assert.ok(req.postDataBuffer().length>1000);await route.fulfill({body:Buffer.from('ID3fixture'),contentType:'audio/mpeg',headers:{'Access-Control-Allow-Origin':site}});return;}
    else if(req.method()==='DELETE')value={cleared:true};
    else if(req.method()==='POST')value={id:String(++serial).padStart(32,'0')};
    else if(url.pathname.endsWith('/reference'))value=ref();
    else value={stage:'ready',ready:true};
    await route.fulfill({json:value,headers:{'Access-Control-Allow-Origin':site}});
  });
  await page.goto(site+'/?tracePlayback=1');
  await page.locator('#recording-settings > summary').click();
  assert.equal(await page.locator('#prepare-settings').getAttribute('open'),null);
  await page.locator('#prepare-settings > summary').click();
  async function loadSavedVersion(){
    if(!await page.locator('#library-panel').evaluate(el=>el.open)) await page.locator('#library-panel > summary').click();
    await page.locator('#library-refresh').click();
    await page.locator(`[data-song-id="${ref().cacheId}"]`).click();
    await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  }
  await page.evaluate(async()=>{
    const script=document.querySelector('script[src*="app."]').src;
    const {RecordingStore}=await import(new URL('recording-store.mjs',script));
    window.recordStore=new RecordingStore();
    window.recorderCreated=0;const NativeRecorder=window.MediaRecorder;window.MediaRecorder=class extends NativeRecorder{constructor(...args){super(...args);window.recorderCreated++;}};
  });
  const records=()=>page.evaluate(()=>recordStore.list());
  async function waitRecords(count){const end=Date.now()+20000;while(Date.now()<end){if((await records()).filter(x=>x.complete).length===count)return;await delay(50);}assert.fail('Recording did not finish saving: '+JSON.stringify({status:await page.locator('#recording-status').textContent(),rows:(await records()).map(r=>({complete:r.complete,seconds:r.seconds,clock:r.captureClock,error:r.captureError}))}));}
  async function expectLatestSaved(){
    const latest=(await records()).find(row=>row.complete);
    assert.ok(latest);
    await page.waitForFunction(id=>document.querySelector('#post-recording').value===id,latest.id);
    assert.equal(await page.locator('#score-recording').inputValue(),latest.id);
    assert.equal(await page.locator('#post-audio').getAttribute('src'),null);
    assert.ok(await page.locator('#selected-recording-preview').isEnabled());
  }
  async function start(){await page.locator('#sing-start').click();await page.waitForFunction(()=>document.querySelector('#recording-status').textContent.includes('● 錄音中'));}
  async function delay(ms){await page.waitForTimeout(ms);}
  async function spectrum(id,offset=.35,track='mix'){return page.evaluate(async ({id,offset,track})=>{
    const rows=await recordStore.list(),row=rows.find(x=>x.id===id),blob=id==='preview'?await(await fetch(document.querySelector('#post-audio').src)).blob():await recordStore.blob(row,track),ctx=new AudioContext();
    const audio=await ctx.decodeAudioData(await blob.arrayBuffer()),samples=audio.getChannelData(0),rate=audio.sampleRate;
    const from=Math.floor(rate*offset),length=Math.min(Math.floor(rate*.5),samples.length-from);
    function power(hz){let c=0,s=0;for(let i=0;i<length;i++){c+=samples[from+i]*Math.cos(2*Math.PI*hz*i/rate);s+=samples[from+i]*Math.sin(2*Math.PI*hz*i/rate);}return 2*Math.hypot(c,s)/length;}
    const result={voice:power(440),backing:power(660),harmony:power(880),duration:audio.duration,bytes:blob.size};await ctx.close();return result;
  },{id,offset,track});}
  await loadSavedVersion();
  await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  assert.equal(await page.locator('#recording-mode').inputValue(),'mix');
  await page.locator('#recording-mode').selectOption('voice');
  assert.equal(await page.locator('#recording-delay').inputValue(),'200');
  assert.equal(await page.locator('#recording-manual').isChecked(),false);
  assert.ok(await page.locator('#recording-voice-level').isDisabled());
  // Testing the microphone alone must not store audio.
  await page.locator('#mic-start').click();await delay(1500);assert.equal((await records()).length,0);
  const micBefore=playbackTraces.find(x=>x.stage==='mic-before'),micAfter=playbackTraces.find(x=>x.stage==='mic-after-1s');
  assert.ok(micBefore && micAfter,'Mic transitions must reach the local diagnostic endpoint');
  assert.equal(micAfter.youtube.videoId,'M7lc1UVf-VE');assert.equal(micAfter.youtube.videoId,micBefore.youtube.videoId);
  assert.equal(micAfter.youtube.muted,false);assert.equal(micAfter.youtube.volume,100);
  assert.ok(micAfter.media.every(x=>x.paused),'Opening mic must not start any local stem or recording');
  assert.ok(!('deviceId' in micAfter.capture));assert.ok(!('groupId' in micAfter.capture));assert.ok(!('token' in micAfter));

  await page.locator('#voice-output-enabled').check();
  await page.waitForFunction(()=>document.querySelector('#voice-output-status').textContent.startsWith('低延遲歌聲輸出中'));
  // A post-processing preview left playing must not overlap a new singing take.
  await page.evaluate(async base64=>{const a=document.querySelector('#post-audio');a.src=URL.createObjectURL(new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'audio/wav'}));a.loop=true;a.hidden=false;await a.play();},melData.toString('base64'));
  assert.equal(await page.locator('#post-audio').evaluate(a=>a.paused),false);
  await start();
  assert.equal(await page.locator('#post-audio').evaluate(a=>a.paused),true);
  assert.equal(await page.locator('#post-audio').getAttribute('src'),null);
  await delay(1600);
  const chunksDuring=await records();assert.equal(chunksDuring.length,1);assert.equal(chunksDuring[0].complete,false);
  assert.ok((await spectrum(chunksDuring[0].id)).duration>1,'in-progress PCM chunks must already have a playable WAV header');
  await page.locator('#mic-stop').click();await waitRecords(1);await expectLatestSaved();
  assert.equal(await page.locator('#voice-output-enabled').isChecked(),false);
  await page.waitForFunction(()=>fixturePlayer.getCurrentTime()<=.05);
  assert.ok(await page.locator('#finish-song').isEnabled());
  const voice=(await records())[0],voiceAudio=await spectrum(voice.id);
  assert.ok(voiceAudio.voice>.05,JSON.stringify(voiceAudio));assert.ok(voiceAudio.backing<.01,JSON.stringify(voiceAudio));assert.equal(backingRequests,0);
  await page.locator('#finish-song').click();await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('已結算'));
  assert.equal((await records()).length,1,'manual scoring after stopping must not duplicate recording');
  assert.equal(voice.appliedDelayMs,200,await page.locator('#recording-status').textContent());assert.equal(voice.post.offsetMs,200);assert.equal(voice.mime,'audio/wav');assert.equal(voice.rawMime,'audio/wav');assert.equal(voice.captureClock.source,'audio-worklet-pcm');
  await page.locator('#recording-mode').selectOption('mix');
  await page.locator('#recording-manual').check();
  await page.locator('#recording-voice-level').fill('60');await page.locator('#recording-backing-level').fill('80');
  assert.match(await page.locator('#recording-balance-help').textContent(),/±3 dB/);

  await start();assert.ok(await page.locator('#recording-manual').isDisabled());await delay(1000);
  await page.evaluate(()=>fixturePlayer.pauseVideo());await delay(900);
  const pauseSeconds=(await records())[0].seconds;
  const balanceStatus=await page.locator('#recording-balance-status').textContent();assert.match(balanceStatus,/人聲修正.*配樂／和音修正/,await page.locator('#recording-status').textContent());
  await page.evaluate(()=>fixturePlayer.seekTo(10));await delay(60);
  await page.evaluate(()=>fixturePlayer.playVideo());await delay(900);
  await page.evaluate(()=>fixturePlayer.endVideo());await waitRecords(2);await expectLatestSaved();
  await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('已結算'));
  const mixed=(await records()).find(x=>x.mode==='mix'),mixedAudio=await spectrum(mixed.id);
  assert.ok(mixedAudio.voice>.03&&mixedAudio.backing>mixedAudio.voice*1.1,JSON.stringify(mixedAudio));
  assert.deepEqual(mixed.balance,{manual:true,voice:60,backing:80});assert.equal(voice.balance.manual,false);
  assert.ok(mixed.seconds<2.6&&mixed.seconds>1.5,JSON.stringify(mixed));
  const afterSeek=await spectrum(mixed.id,1.3);assert.ok(afterSeek.voice>.03&&afterSeek.backing<.01,JSON.stringify(afterSeek));
  assert.ok(backingRequests>0);assert.ok(pauseSeconds<1.8);
  // Four-stem versions mix only accompaniment + harmony, using the same gain bus.
  vocalMode='lead';await loadSavedVersion();
  await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  const beforeStems=stemRequests.length;
  await start();await delay(1000);await page.evaluate(()=>fixturePlayer.pauseVideo());await delay(200);
  await page.evaluate(()=>fixturePlayer.seekTo(1));await delay(60);await page.evaluate(()=>fixturePlayer.playVideo());await delay(800);
  await page.locator('#finish-song').click();await waitRecords(3);
  await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('已結算'));
  const harmonyRecord=(await records())[0],harmonyAudio=await spectrum(harmonyRecord.id);
  assert.deepEqual(harmonyRecord.stems,['accompaniment','backing']);
  assert.deepEqual(stemRequests.slice(beforeStems),['accompaniment','backing']);
  assert.ok(harmonyAudio.voice>.03&&harmonyAudio.backing>.03&&harmonyAudio.harmony>.03,JSON.stringify(harmonyAudio));
  assert.ok(Math.abs(harmonyAudio.backing/harmonyAudio.harmony-1)<.1,JSON.stringify(harmonyAudio));
  const harmonyAfterSeek=await spectrum(harmonyRecord.id,1.2);
  assert.ok(harmonyAfterSeek.backing>.03&&harmonyAfterSeek.harmony>.03,JSON.stringify(harmonyAfterSeek));
  const rawVoice=await spectrum(harmonyRecord.id,.35,'voice');assert.ok(rawVoice.voice>.03&&rawVoice.backing<.01&&rawVoice.harmony<.01,JSON.stringify(rawVoice));
  assert.ok(harmonyRecord.rawBytes>1000&&harmonyRecord.post.samples.length>5);
  assert.equal(harmonyRecord.post.segments.length,2);
  assert.equal(await page.locator('#score-settings').getAttribute('open'),null);
  await page.locator('#score-settings > summary').click();
  assert.equal(await page.locator('#score-settings #post-difficulty').count(),1);
  assert.equal(await page.locator('#score-settings #post-reference-source').count(),1);
  // A previous release's analysis must not hide a detector fix on explicit rescore.
  await page.evaluate(async id=>{
    const row=(await recordStore.list()).find(r=>r.id===id);
    row.post.audioAnalysis={version:1,source:'decoded-voice-v1',duration:row.seconds,samples:[{offset:.3,hz:110}]};
    await recordStore.save(row);
  },harmonyRecord.id);
  const oldRecordingList=await page.locator('#recording-list li').first().elementHandle();
  await page.locator('#recordings-panel > summary').click();
  await page.locator('#recording-refresh').click();
  await oldRecordingList.waitForElementState('hidden');
  await page.locator('#recordings-panel > summary').click();
  await page.locator('#score-recording').selectOption(harmonyRecord.id);
  assert.equal(await page.locator('#post-recording').inputValue(),harmonyRecord.id);
  await page.locator('#post-delay').fill('100');
  assert.equal(await page.locator('#remix-delay').inputValue(),'100');
  await page.locator('#post-rescore').click();await page.waitForFunction(()=>document.querySelector('#rescore-status').textContent.includes('重評完成'));
  const rescored=(await records()).find(r=>r.id===harmonyRecord.id);
  assert.equal(rescored.postResult.delayMs,100);assert.equal(rescored.postResult.source,'decoded-voice-v1');assert.ok(rescored.post.audioAnalysis.samples.length>20);
  assert.equal(rescored.post.audioAnalysis.detectorVersion,PITCH_DETECTOR_VERSION);
  assert.ok(rescored.post.audioAnalysis.samples.some(s=>s.hz>435&&s.hz<445));
  await page.locator('#post-delay').fill('175');await page.locator('#post-rescore').click();await page.waitForFunction(()=>document.querySelector('#post-score').textContent.includes('校正 175 ms'));
  assert.match(await page.locator('#post-score').textContent(),/同音檔 0 ms 進拍/);
  const original175=(await records()).find(r=>r.id===harmonyRecord.id).postResult;
  // Only loading a saved alternative changes the available comparison reference.
  await page.locator('#post-reference-source').selectOption('current');
  assert.match(await page.locator('#post-reference-info').textContent(),/目前已載入：YIN/);
  fixturePitch='rmvpe';fixtureHz=523.25;
  await loadSavedVersion();
  await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.includes('RMVPE 音高'));
  assert.match(await page.locator('#post-reference-info').textContent(),/目前已載入：RMVPE/);
  await page.locator('#post-rescore').click();
  await page.waitForFunction(()=>document.querySelector('#post-score').textContent.includes('改用已載入基準 RMVPE'));
  const updated=(await records()).find(r=>r.id===harmonyRecord.id);
  assert.equal(updated.postResult.referenceSource,'current');assert.equal(updated.postResult.reference.pitchMethod,'rmvpe');
  // The relaxed profile now gives partial credit at this ~300-cent mismatch.
  // Switching reference must reduce pitch credit using the selected profile.
  const updatedExpected=rescoreRecording({...updated.post,reference:updated.postResult.reference,scoring:updated.postResult.scoring},175);
  assert.equal(updated.postResult.pitch,updatedExpected.pitch);
  assert.equal(updated.postResult.baseline.pitch,rescoreRecording({...updated.post,reference:updated.postResult.reference,scoring:updated.postResult.scoring},0).pitch);
  assert.ok(updated.postResult.pitch<original175.pitch);
  assert.deepEqual(updated.post.reference,harmonyRecord.post.reference,'old snapshot and remix stem identity must survive');
  assert.deepEqual(updated.post.audioAnalysis,rescored.post.audioAnalysis,'reuse the same voice analysis');
  await page.locator('#post-reference-source').selectOption('original');await page.locator('#post-rescore').click();
  await page.waitForFunction(()=>document.querySelector('#post-score').textContent.includes('錄音當時基準 YIN'));
  assert.equal((await records()).find(r=>r.id===harmonyRecord.id).postResult.pitch,original175.pitch);
  // Re-score one saved voice in all profiles without mutating the original take or audio.
  assert.equal(await page.locator('#post-difficulty').inputValue(),'relaxed');
  const difficultyScores={};
  for(const [difficulty,label] of [['strict','嚴格'],['standard','標準'],['relaxed','寬鬆']]){
    await page.locator('#post-difficulty').selectOption(difficulty);
    await page.locator('#post-rescore').click();
    await page.waitForFunction(()=>!document.querySelector('#post-rescore').disabled);
    const row=(await records()).find(r=>r.id===harmonyRecord.id),r=row.postResult;
    const scoring={...row.post.scoring,difficulty};
    const expected=rescoreRecording({...row.post,scoring,reference:r.reference},175);
    assert.equal(r.scoring.difficulty,difficulty);assert.equal(r.score,expected.score);assert.equal(r.rhythm,expected.rhythm);
    assert.deepEqual(r.baseline,rescoreRecording({...row.post,scoring,reference:r.reference},0));
    assert.deepEqual(row.post.scoring,harmonyRecord.post.scoring);assert.equal(row.bytes,harmonyRecord.bytes);assert.equal(row.appliedDelayMs,200);
    assert.match(await page.locator('#post-score').textContent(),new RegExp(label));difficultyScores[difficulty]=r.score;
  }
  assert.ok(difficultyScores.strict<=difficultyScores.standard&&difficultyScores.standard<=difficultyScores.relaxed);
  await page.locator('#post-difficulty').selectOption('strict');
  await page.locator('#post-recording').selectOption(voice.id);
  await page.locator('#post-recording').selectOption(harmonyRecord.id);
  assert.equal(await page.locator('#post-difficulty').inputValue(),'relaxed');
  assert.match(await page.locator('#post-score').textContent(),/寬鬆/,'saved result must retain its actual difficulty');
  const diagnosticDownload=page.waitForEvent('download');await page.locator('#post-diagnostic').click();
  const diagnostic=await diagnosticDownload,stream=await diagnostic.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const report=JSON.parse(Buffer.concat(chunks).toString());assert.equal(report.format,'karaoke-recording-diagnostic');assert.equal(report.recording.id,harmonyRecord.id);
  assert.ok(Buffer.from(report.audio.voice.base64,'base64').length>1000);assert.ok(Buffer.from(report.audio.mix.base64,'base64').length>1000);
  await page.waitForFunction(()=>document.querySelector('#rescore-status').textContent.includes('診斷檔已下載'));
  await page.locator('#post-remix').click();await page.waitForFunction(()=>document.querySelector('#post-status').textContent.includes('已另存校正後錄音'));
  const remixed=(await records()).find(r=>r.parentId===harmonyRecord.id);assert.ok(remixed&&remixed.mime==='audio/wav');
  const remixedAudio=await spectrum(remixed.id);assert.ok(remixedAudio.voice>.02&&remixedAudio.backing>.02&&remixedAudio.harmony>.02,JSON.stringify(remixedAudio));
  assert.ok(await page.locator('#post-audio').isVisible());assert.ok(await page.locator('#post-rescore').isEnabled());assert.ok(await page.locator('#post-difficulty').isEnabled());
  assert.equal(remixed.rawBytes,harmonyRecord.rawBytes);assert.equal(remixed.rawMime,harmonyRecord.rawMime);
  assert.deepEqual(remixed.balance,harmonyRecord.balance);assert.equal(remixed.post.offsetMs,175);
  const blobHash=(row,track='mix')=>page.evaluate(async({row,track})=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await(await recordStore.blob(row,track)).arrayBuffer()))).join(','),{row,track});
  const originalRemixHash=await blobHash(remixed);
  assert.equal(await blobHash(remixed,'voice'),await blobHash(harmonyRecord,'voice'));
  const mp3download=page.waitForEvent('download');await page.locator('#post-mp3').click();assert.ok((await mp3download).suggestedFilename().endsWith('+175ms.mp3'));
  await page.waitForFunction(()=>document.querySelector('#post-status').textContent.includes('MP3 已轉換'));
  await page.evaluate(id=>recordStore.delete(id),remixed.id);
  await page.locator('#post-recording').selectOption(harmonyRecord.id);
  assert.equal(await page.locator('#post-softening').inputValue(),'off');
  const sourceBeforeSoftening=(await records()).find(r=>r.id===harmonyRecord.id);
  await page.locator('#score-settings > summary').click();
  await page.locator('#remix-delay').fill('175');
  assert.equal(await page.locator('#post-delay').inputValue(),'175');
  await page.locator('#post-softening').selectOption('light');
  await page.locator('#post-remix').click();await page.waitForFunction(()=>document.querySelector('#post-status').textContent.includes('歌聲柔化：輕度'));
  const softened=(await records()).find(r=>r.parentId===harmonyRecord.id&&r.vocalSoftening?.strength==='light');assert.ok(softened);
  assert.ok(await page.locator('#post-softening').isEnabled());
  assert.match(await page.locator('#post-recording').locator('option:checked').textContent(),/柔化輕度/);
  assert.deepEqual((await records()).find(r=>r.id===harmonyRecord.id),sourceBeforeSoftening,'softening must preserve source and its scoring data');
  const softDownload=page.waitForEvent('download');await page.locator('#post-mp3').click();assert.ok((await softDownload).suggestedFilename().endsWith('_柔化輕度+175ms.mp3'));
  await page.waitForFunction(()=>document.querySelector('#post-status').textContent.includes('MP3 已轉換'));
  // A saved product remains editable; repeated rendering replaces settings instead of compounding them.
  await page.locator('#post-voice-level').fill('150');await page.locator('#post-backing-level').fill('50');
  assert.equal(await page.locator('#post-voice-value').textContent(),'150%');
  await page.locator('#post-effects-panel > summary').click();
  await page.locator('#post-eq-low').fill('3');await page.locator('#post-eq-mid').fill('-2');await page.locator('#post-eq-high').fill('1');
  await page.locator('#post-compression').selectOption('light');await page.locator('#post-reverb').fill('8');
  await page.locator('#post-region-add').click();
  await page.locator('#post-regions [data-field=start]').fill('0.2');await page.locator('#post-regions [data-field=end]').fill('0.6');await page.locator('#post-regions [data-field=volume]').fill('70');
  await page.locator('#post-remix').click();await page.waitForFunction(id=>document.querySelector('#post-recording').value!==id,softened.id);
  const child=(await records()).find(r=>r.parentId===softened.id);assert.ok(child?.post&&child.rawBytes);
  assert.deepEqual(child.postVolume,{voice:150,backing:50});assert.equal(child.vocalSoftening.strength,'light');
  assert.deepEqual(child.vocalEffects,{version:1,eq:{low:3,mid:-2,high:1},compression:'light',reverb:8,regions:[{start:.2,end:.6,volume:70}]});
  assert.equal(await page.locator('#post-eq-low').inputValue(),'3');assert.equal(await page.locator('#post-compression').inputValue(),'light');assert.equal(await page.locator('#post-reverb').inputValue(),'8');assert.equal(await page.locator('#post-regions [data-field=volume]').inputValue(),'70');
  assert.equal(await blobHash(child,'voice'),await blobHash(harmonyRecord,'voice'));
  assert.equal(await page.locator('#post-voice-level').inputValue(),'150');assert.equal(await page.locator('#post-backing-level').inputValue(),'50');
  // Solo preview retains saved processing, excludes both backing tracks, and never writes a take.
  const beforeSolo=await records(),stemsBeforeSolo=stemRequests.length;
  await page.locator('#selected-recording-voice').click();
  await page.waitForFunction(()=>document.querySelector('#post-status').textContent.startsWith('只聽人聲：'));
  const solo=await spectrum('preview'),fullChild=await spectrum(child.id);
  // Region gain ramps create small spectral sidebands even in a pure voice.
  assert.ok(solo.voice>.05&&solo.backing<solo.voice*.01&&solo.harmony<solo.voice*.01,JSON.stringify(solo));
  assert.ok(fullChild.backing>solo.backing*10&&fullChild.harmony>solo.harmony*10,'solo must exclude the actual accompaniment and harmony');
  assert.ok(Math.abs(solo.voice/fullChild.voice-1)<.03,'saved voice volume and softening survive solo playback');
  assert.equal(solo.duration,fullChild.duration);assert.equal(stemRequests.length,stemsBeforeSolo,'solo needs no library backing tracks');
  assert.deepEqual(await records(),beforeSolo,'preview must not modify recordings');
  const previewHash=()=>page.evaluate(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(document.querySelector('#post-audio').src)).arrayBuffer()))).join(','));
  const savedSoloHash=await previewHash();
  await page.locator('#post-voice-level').fill('0');await page.locator('#remix-delay').fill('-100');await page.locator('#post-softening').selectOption('strong');
  await page.locator('#selected-recording-voice').click();await page.waitForFunction(()=>!document.querySelector('#selected-recording-voice').disabled);
  assert.equal(await previewHash(),savedSoloHash,'unsaved settings must not change saved-product preview');
  await page.locator('#selected-recording-preview').click();await page.waitForFunction(()=>!document.querySelector('#selected-recording-preview').disabled);
  assert.equal(await previewHash(),await blobHash(child),'ordinary preview switches back to full saved mix');
  await page.locator('#post-recording').selectOption(voice.id);
  await page.locator('#selected-recording-voice').click();await page.waitForFunction(()=>!document.querySelector('#selected-recording-voice').disabled);
  assert.equal(await previewHash(),await blobHash(voice),'voice-only recordings use the already processed saved audio');
  const legacy=await page.evaluate(async()=>{
    const row={id:crypto.randomUUID(),title:'Legacy mix without source',mode:'mix',mime:'audio/wav',created:Date.now(),seconds:1,bytes:3,complete:true};
    await recordStore.save(row,new Blob(['wav']),0);return row;
  });
  const recordingsWereOpen=await page.locator('#recordings-panel').evaluate(el=>el.open);
  if(!recordingsWereOpen)await page.locator('#recordings-panel > summary').click();
  await page.locator('#recording-refresh').click();
  if(!recordingsWereOpen)await page.locator('#recordings-panel > summary').click();
  await page.locator('#post-recording').selectOption(legacy.id);
  assert.ok(await page.locator('#selected-recording-voice').isDisabled());assert.ok(await page.locator('#selected-recording-preview').isEnabled());
  await page.evaluate(id=>recordStore.delete(id),legacy.id);
  await page.locator('#post-recording').selectOption(child.id);
  await page.evaluate(id=>recordStore.delete(id),softened.id);
  await page.locator('#post-remix').click();await page.waitForFunction(id=>document.querySelector('#post-recording').value!==id,child.id);
  const grandchild=(await records()).find(r=>r.parentId===child.id);assert.equal(await blobHash(grandchild),await blobHash(child),'same settings produce identical audio even after source product is deleted');
  assert.equal(grandchild.seconds,child.seconds,'reverb tails do not grow across saved generations');
  const countBeforeInvalid=(await records()).length;
  await page.locator('#post-region-add').click();
  await page.locator('#post-regions [data-field=start]').last().fill('0.3');await page.locator('#post-regions [data-field=end]').last().fill('0.7');
  await page.locator('#post-remix').click();await page.waitForFunction(()=>document.querySelector('#post-status').textContent.includes('不可重疊'));
  assert.equal((await records()).length,countBeforeInvalid,'invalid regions do not save a new product');
  await page.locator('#post-effects-reset').click();
  assert.equal(await page.locator('#post-regions input').count(),0);assert.equal(await page.locator('#post-compression').inputValue(),'off');
  await page.locator('#post-softening').selectOption('off');
  await page.locator('#post-voice-level').fill('100');await page.locator('#post-backing-level').fill('100');
  await page.locator('#post-remix').click();await page.waitForFunction(id=>document.querySelector('#post-recording').value!==id,grandchild.id);
  const restored=(await records()).find(r=>r.parentId===grandchild.id);assert.equal(await blobHash(restored),originalRemixHash,'turning effects off restores rendering from the untouched raw source');
  for(const row of [child,grandchild,restored])await page.evaluate(id=>recordStore.delete(id),row.id);

  assert.equal(await page.locator('#post-tuning').count(),0,'MIDI option is removed');
  assert.equal(softened.vocalTuning,undefined,'new remixes do not generate synth effects');

  await page.evaluate(id=>recordStore.delete(id),harmonyRecord.id);
  assert.equal(await page.evaluate(async row=>(await recordStore.blob(row,'voice')).size,harmonyRecord),0);
  // A missing harmony file must fail before recording instead of silently omitting it.
  missingHarmony=true;const beforeMissing=await page.evaluate(()=>recorderCreated);
  await page.locator('#sing-start').click();await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('無法取得錄音所需'));
  assert.equal(await page.evaluate(()=>recorderCreated),beforeMissing);assert.equal((await records()).length,2);
  missingHarmony=false;
  // Restarting saves the old recording and creates another one; finishing saves once.
  await page.locator('#recording-mode').selectOption('voice');await page.locator('#recording-delay').fill('0');await start();await delay(650);
  await start();await waitRecords(3);await delay(650);await page.locator('#finish-song').click();await waitRecords(4);await expectLatestSaved();
  await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('已結算'));
  assert.equal(new Set((await records()).map(x=>x.id)).size,4);
  const unshifted=(await records())[0];const unshiftedMix=await spectrum(unshifted.id,0),unshiftedRaw=await spectrum(unshifted.id,0,'voice');
  assert.equal(unshiftedMix.duration,unshiftedRaw.duration);assert.equal(unshiftedMix.duration,unshifted.captureClock.frames/unshifted.captureClock.sampleRate);
  // Off leaves microphone scoring available and writes no audio.
  const beforeOff=await page.evaluate(()=>recorderCreated);
  await page.locator('#recording-mode').selectOption('off');await page.locator('#sing-start').click();await delay(650);await page.locator('#finish-song').click();
  await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('已結算'));assert.equal((await records()).length,4);
  assert.equal(await page.evaluate(()=>recorderCreated),beforeOff,'off must not even construct a MediaRecorder');
  const selectionBeforeFailure=await page.locator('#post-recording').inputValue();
  // Storage exhaustion must preserve a downloadable in-memory backup, never report saved.
  await page.locator('#recording-mode').selectOption('voice');await start();
  await page.evaluate(()=>{window.storeSave=Object.getPrototypeOf(recordStore).save;Object.getPrototypeOf(recordStore).save=async()=>{throw new DOMException('Fixture quota','QuotaExceededError');};});
  await delay(1200);await page.locator('#finish-song').click();
  await page.waitForFunction(()=>document.querySelector('#recording-status').textContent.includes('錄音未完整保存'));
  assert.ok(await page.locator('#recording-rescue').isVisible());
  assert.equal(await page.locator('#post-recording').inputValue(),selectionBeforeFailure);
  const rescueDownload=page.waitForEvent('download');await page.locator('#recording-rescue a').first().click();assert.ok((await rescueDownload).suggestedFilename().endsWith('.wav'));
  await page.evaluate(()=>{Object.getPrototypeOf(recordStore).save=window.storeSave;});
  assert.equal((await records()).filter(r=>r.complete).length,4);
  for(const partial of (await records()).filter(r=>!r.complete))await page.evaluate(id=>recordStore.delete(id),partial.id);
  // Direct fixture cleanup bypasses the UI delete action; refresh its list so
  // later preview clicks cannot target a stale, already deleted partial take.
  const beforeCleanupRefresh=await page.locator('#recording-list li').first().elementHandle();
  await page.evaluate(()=>document.querySelector('#recording-refresh').click());
  await beforeCleanupRefresh.waitForElementState('hidden');
  // Waiting for autoplay cannot create a misleading empty recording.
  await page.evaluate(()=>{window.playOriginal=fixturePlayer.playVideo;fixturePlayer.playVideo=()=>{};});
  await page.locator('#sing-start').click();await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('影片已回到開頭'));
  await page.locator('#mic-stop').click();await delay(200);assert.equal((await records()).length,4);
  await page.evaluate(()=>{fixturePlayer.playVideo=window.playOriginal;});await page.locator('#finish-song').click();
  await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('歌曲已保留'));
  // Same-name scores are selected independently and deletion never affects recordings.
  await page.evaluate(()=>{localStorage.setItem('karaoke.scores.v1',JSON.stringify([{title:'Same song',score:70},{title:'Same song',score:80},{title:'Other song',score:90}]));window.dispatchEvent(new StorageEvent('storage',{key:'karaoke.scores.v1'}));});
  await page.locator('#history-panel summary').click();
  await page.locator('#score-history input[value="1"]').check();
  assert.ok(await page.locator('#history-select-all').evaluate(x=>x.indeterminate));
  await page.locator('#delete-history-selected').click();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('karaoke.scores.v1'))),[{title:'Same song',score:70},{title:'Other song',score:90}]);
  await page.locator('#history-select-all').check();assert.equal(await page.locator('#score-history input:checked').count(),2);
  await page.locator('#history-select-all').uncheck();assert.ok(await page.locator('#delete-history-selected').isDisabled());
  await page.locator('#clear-history').click();assert.equal(await page.evaluate(()=>localStorage.getItem('karaoke.scores.v1')),null);assert.equal((await records()).length,4);
  await page.locator('#recordings-panel summary').click();
  await page.locator('#recording-list').getByRole('button',{name:'試聽',exact:true}).first().click();
  await page.waitForFunction(()=>document.querySelector('#recording-audio').currentTime>.1).catch(async error=>{console.error('Preview failure',await page.evaluate(()=>{const a=document.querySelector('#recording-audio');return {time:a.currentTime,duration:a.duration,paused:a.paused,ready:a.readyState,error:a.error?.message,status:document.querySelector('#recording-status').textContent,src:a.src};}));throw error;});
  const downloaded=page.waitForEvent('download');await page.locator('#recording-list').getByRole('button',{name:'下載',exact:true}).first().click();
  assert.ok((await downloaded).suggestedFilename().endsWith('+0ms.wav'));
  // Reload preserves all recordings; delete only removes the selected recording.
  await page.locator('#recording-mode').selectOption('off');
  await page.reload();assert.equal(await page.locator('#recording-mode').inputValue(),'off');assert.ok(await page.locator('#recording-manual').isChecked());assert.equal(await page.locator('#recording-voice-level').inputValue(),'60');assert.equal(await page.locator('#recording-backing-level').inputValue(),'80');await page.locator('#recordings-panel summary').click();await page.waitForFunction(()=>document.querySelectorAll('#recording-list li button').length===16);
  await page.evaluate(async()=>{
    const {RecordingStore}=await import(new URL('recording-store.mjs',document.querySelector('script[src*="app."]').src));
    window.recordStore=new RecordingStore();
  });
  const beforeSelected=await records(),chosen=beforeSelected[1];
  await page.locator('#post-recording').selectOption(chosen.id);
  await page.locator('#recording-list').getByRole('button',{name:'試聽',exact:true}).first().click();
  await page.waitForFunction(()=>document.querySelector('#recording-audio').currentTime>.1);
  await page.locator('#selected-recording-preview').click();
  assert.ok(await page.locator('#recording-audio').evaluate(a=>a.paused));
  await page.waitForFunction(()=>document.querySelector('#post-audio').currentTime>.1);
  const selectedDownload=page.waitForEvent('download');await page.locator('#selected-recording-download').click();
  const savedDownload=await selectedDownload,selectedStream=await savedDownload.createReadStream(),selectedChunks=[];
  for await(const chunk of selectedStream)selectedChunks.push(chunk);
  const expectedBytes=await page.evaluate(async id=>{const row=(await recordStore.list()).find(r=>r.id===id);return Array.from(new Uint8Array(await (await recordStore.blob(row)).arrayBuffer()));},chosen.id);
  assert.equal(audioHash(Buffer.concat(selectedChunks)),audioHash(Buffer.from(expectedBytes)));
  await page.waitForFunction(()=>!document.querySelector('#selected-recording-edit').disabled);
  await page.locator('#selected-recording-edit').click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'remix-delay');
  const positions=await page.locator('#selected-recording-actions button').evaluateAll(bs=>bs.map(b=>b.getBoundingClientRect().y));
  assert.ok(positions.every(y=>Math.abs(y-positions[0])<1),'five actions share one horizontal row');
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#selected-recording-delete').click();
  assert.equal((await records()).length,4);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#selected-recording-delete').click();
  await page.waitForFunction(()=>document.querySelectorAll('#recording-list li button').length===12);
  assert.deepEqual((await records()).map(r=>r.id).sort(),beforeSelected.filter(r=>r.id!==chosen.id).map(r=>r.id).sort());

  const lowerRows=await records(),lowerSelected=lowerRows[1];
  await page.locator('#post-recording').selectOption(lowerSelected.id);
  await page.locator('#selected-recording-preview').click();
  await page.waitForFunction(()=>document.querySelector('#post-audio').currentTime>.1);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#recording-list li').nth(1).getByRole('button',{name:'刪除',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#recording-list li button').length===8);
  const remaining=await records();
  assert.ok(!remaining.some(r=>r.id===lowerSelected.id));
  assert.equal(await page.locator('#post-recording').inputValue(),remaining[0].id);
  assert.equal(await page.locator('#score-recording').inputValue(),remaining[0].id);
  assert.equal(await page.locator('#post-audio').getAttribute('src'),null);
  assert.ok(await page.locator('#post-audio').isHidden());
  // Deleting another row must preserve the selected recording.
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#recording-list li').nth(1).getByRole('button',{name:'刪除',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#recording-list li button').length===4);
  assert.equal(await page.locator('#post-recording').inputValue(),remaining[0].id);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#recording-delete-all').click();await page.waitForFunction(()=>document.querySelector('#recording-status').textContent.includes('已刪除 1 筆'));
  assert.equal(await page.locator('#post-recording').inputValue(),'');
  assert.equal(await page.locator('#score-recording').inputValue(),'');
  assert.ok(await page.locator('#post-rescore').isDisabled());
  assert.ok(await page.locator('#post-remix').isDisabled());

  for(const action of ['preview','voice','download','edit','delete'])assert.ok(await page.locator('#selected-recording-'+action).isDisabled());
  const peak=await page.evaluate(async()=>{
    const script=document.querySelector('script[src*="app."]').src;
    const {createRecordingMix}=await import(new URL('recording-mix.mjs',script));
    const ctx=new OfflineAudioContext(1,48000,48000),mic=ctx.createConstantSource(),backing=ctx.createConstantSource();mic.offset.value=1;backing.offset.value=1;
    const mix=createRecordingMix(ctx,mic,ctx.destination,{mode:'mix',settings:{manual:true,voice:100,backing:100},voiced:()=>true});
    backing.connect(mix.input);mic.start();backing.start();const out=await ctx.startRendering();
    return out.getChannelData(0).reduce((peak,x)=>Math.max(peak,Math.abs(x)),0);
  });assert.ok(peak<=.981&&peak>.5,peak);
  const shifts=await page.evaluate(async()=>{
    const script=document.querySelector('script[src*="app."]').src;
    const {remixRecording}=await import(new URL('recording-process.mjs',script));
    const context=new AudioContext(),rate=context.sampleRate,raw=context.createBuffer(1,rate,rate),samples=raw.getChannelData(0);
    for(let i=Math.floor(.4*rate);i<Math.floor(.5*rate);i++)samples[i]=.2*Math.sin(2*Math.PI*440*i/rate);
    const meta={seconds:1,mode:'voice',balance:{manual:true,voice:100,backing:0},post:{samples:[],segments:[{offset:0,songTime:0,duration:1}]}};
    const result=[];
    for(const delay of [0,100,-100,150]){const audio=await remixRecording(raw,[],meta,delay);result.push({delay,onset:audio.getChannelData(0).findIndex(x=>Math.abs(x)>.01)/rate,duration:audio.duration});}
    await context.close();return result;
  });
  assert.ok(Math.abs(shifts[0].onset-shifts[1].onset-.1)<.002,JSON.stringify(shifts));
  assert.ok(Math.abs(shifts[2].onset-shifts[0].onset-.1)<.002,JSON.stringify(shifts));
  assert.ok(shifts[2].duration>=1.1);assert.ok(Math.abs(shifts[0].onset-shifts[3].onset-.15)<.002,JSON.stringify(shifts));
  const softeningSpectrum=await page.evaluate(async()=>{
    const script=document.querySelector('script[src*="app."]').src;
    const {remixRecording}=await import(new URL('recording-process.mjs',script));
    const c=new AudioContext({sampleRate:48000}),rate=c.sampleRate,raw=c.createBuffer(1,rate*2,rate),back=c.createBuffer(1,rate*2,rate);
    for(let i=0;i<raw.length;i++){raw.getChannelData(0)[i]=.08*Math.sin(2*Math.PI*300*i/rate)+.08*Math.sin(2*Math.PI*6000*i/rate);back.getChannelData(0)[i]=.04*Math.sin(2*Math.PI*9000*i/rate);}
    const original=raw.getChannelData(0).slice();
    const meta={seconds:2,mode:'mix',balance:{manual:true,voice:100,backing:100},post:{segments:[{offset:0,songTime:0,duration:2}],samples:[]}};
    const power=(buffer,hz)=>{const a=buffer.getChannelData(0);let re=0,im=0;for(let i=rate;i<rate*2;i++){re+=a[i]*Math.cos(2*Math.PI*hz*i/rate);im+=a[i]*Math.sin(2*Math.PI*hz*i/rate);}return 2*Math.hypot(re,im)/rate;};
    const values=[];let off;
    for(const softening of ['off','light','medium','strong']){const rendered=await remixRecording(raw,[back],meta,0,{softening});if(softening==='off')off=rendered;values.push({softening,low:power(rendered,300),high:power(rendered,6000),backing:power(rendered,9000),duration:rendered.duration});}
    const implicit=await remixRecording(raw,[back],meta,0);
    const unchanged=original.every((v,i)=>v===raw.getChannelData(0)[i]);const offIdentical=implicit.getChannelData(0).every((v,i)=>v===off.getChannelData(0)[i]);await c.close();return{values,unchanged,offIdentical};
  });
  assert.ok(softeningSpectrum.unchanged&&softeningSpectrum.offIdentical);
  const softValues=softeningSpectrum.values;
  for(let i=1;i<softValues.length;i++){assert.ok(softValues[i].high<softValues[i-1].high*.95,JSON.stringify(softValues));assert.ok(Math.abs(softValues[i].low/softValues[0].low-1)<.03);assert.ok(Math.abs(softValues[i].backing/softValues[0].backing-1)<.01);assert.equal(softValues[i].duration,softValues[0].duration);}
  assert.ok(softValues[2].high<softValues[1].high*.65&&softValues[3].high<softValues[2].high*.5,JSON.stringify(softValues));
  const volumes=await page.evaluate(async()=>{
    const {remixRecording}=await import(new URL('recording-process.mjs',document.querySelector('script[src*="app."]').src));
    const c=new AudioContext({sampleRate:48000}),rate=c.sampleRate;
    const sine=hz=>{const b=c.createBuffer(1,rate,rate);for(let i=0;i<rate;i++)b.getChannelData(0)[i]=.03*Math.sin(2*Math.PI*hz*i/rate);return b;};
    const raw=sine(440),tracks=[sine(660),sine(880)],meta={seconds:1,mode:'mix',post:{segments:[{offset:0,songTime:0,duration:1}],samples:[]}};
    const power=(a,hz)=>{let re=0,im=0;for(let i=rate/2;i<rate;i++){re+=a[i]*Math.cos(2*Math.PI*hz*i/rate);im+=a[i]*Math.sin(2*Math.PI*hz*i/rate);}return 4*Math.hypot(re,im)/rate;};
    const results=[];
    for(const volume of [undefined,{voice:100,backing:100},{voice:50,backing:150},{voice:0,backing:100},{voice:100,backing:0},{voice:0,backing:0}]){
      const out=await remixRecording(raw,tracks,meta,0,{volume}),a=out.getChannelData(0);
      results.push({voice:power(a,440),backing:power(a,660),harmony:power(a,880),peak:Math.max(...a.map(Math.abs))});
    }
    const delayed=await remixRecording(raw,tracks,meta,-500);
    const reset=await remixRecording(raw,tracks,{...meta,seconds:delayed.duration,sourceSeconds:1},0);
    await c.close();return{results,resetDuration:reset.duration};
  });
  const [base,neutral,adjusted,muteVoice,muteBacking,silent]=volumes.results;
  assert.deepEqual(base,neutral);assert.ok(Math.abs(adjusted.voice/base.voice-.5)<.002);
  assert.ok(Math.abs(adjusted.backing/base.backing-1.5)<.002);assert.ok(Math.abs(adjusted.harmony/base.harmony-1.5)<.002);
  assert.ok(muteVoice.voice<1e-5&&muteVoice.backing>.01&&muteVoice.harmony>.01);
  assert.ok(muteBacking.voice>.01&&muteBacking.backing<1e-5&&muteBacking.harmony<1e-5);
  assert.equal(silent.peak,0);assert.equal(volumes.resetDuration,1);
  console.log('SOFTENING',JSON.stringify(softeningSpectrum));
  await page.setViewportSize({width:1280,height:900});await page.locator('#recording-post').screenshot({path:'test-results/recording-post.png'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({shifts,voiceAudio,mixedAudio,harmonyAudio,harmonyAfterSeek,harmonyRequests,balanceStatus,peak,manualAutoRatio:true,defaultAuto:true,incrementalSave:true,pauseResume:true,seekBeyondBacking:true,quotaRecovery:true,emptyRecordingAvoided:true,stopRewind:true,automaticFinish:true,restartSeparate:true,off:true,selectiveAndAllScoreDeletion:true,persistence:true,download:true,deleteOne:true,errors}));
} finally {await browser?.close();server.kill();await rm(fixture,{force:true});}
