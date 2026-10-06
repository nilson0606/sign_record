import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const port='4391',site='http://localhost:'+port;
const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:port},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,stemDelay=0;
const ref={version:1,videoId:'M7lc1UVf-VE',title:'分段錄音隔離測試',duration:8,step:.1,frames:Array(80).fill(440),beats:[],cacheId:'segment-fixture',hasPreview:true,separationModel:'demucs',pitchMethod:'rmvpe',separationMethod:'single',vocalMode:'all',rangeSeconds:0};
function wav(){const rate=48000,n=rate*8,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(.06*Math.sin(2*Math.PI*660*i/rate)*32767),44+i*2);return b;}
try{
 await new Promise((ok,no)=>{server.stdout.once('data',ok);server.stderr.once('data',x=>no(Error(x.toString())));server.once('error',no);});
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.route('http://127.0.0.1:4274/**',async r=>{
  const req=r.request(),url=new URL(req.url()),headers={'Access-Control-Allow-Origin':site,'Access-Control-Allow-Headers':'X-Karaoke-Token, Content-Type','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS'};
  requests.push(req.method()+' '+url.pathname);
  if(req.method()==='OPTIONS')return r.fulfill({status:204,headers});
  let json;if(url.pathname==='/session')json={token:'fixture',features:['separation-progress','pitch-methods']};
  else if(url.pathname==='/library/location')json={configured:true,path:'fixture-only'};
  else if(url.pathname==='/library')json={songs:[]};
  else if(url.pathname==='/jobs'&&req.method()==='POST')json={id:'fixture-job'};
  else if(url.pathname==='/jobs/fixture-job/reference')json=ref;
  else if(url.pathname==='/jobs/fixture-job')json={ready:true,cached:true,stage:'ready',message:'Ready'};
  else if(url.pathname==='/library/segment-fixture/accompaniment'){if(stemDelay)await new Promise(resolve=>setTimeout(resolve,stemDelay));return r.fulfill({body:wav(),contentType:'audio/wav',headers});}
  else return r.fulfill({status:404,json:{error:'Unexpected fixture request'},headers});
  return r.fulfill({json,headers});
 });
 async function initialize(){await page.evaluate(async()=>{
  const {createKaraokeSession}=await import('/session.mjs');
  window.fixtureMic=null;let time=0,anchor=0,state=2,muted=false;
  window.fixturePlayer={getCurrentTime:()=>state===1?Math.min(8,time+(performance.now()-anchor)/1000):time,getPlayerState:()=>state,seekTo(t){time=t;anchor=performance.now();},pauseVideo(){time=this.getCurrentTime();state=2;fixtureSession?.playerState(2);},playVideo(){if(time>=8)time=0;anchor=performance.now();state=1;fixtureSession?.playerState(1);},isMuted:()=>muted,mute(){muted=true;},unMute(){muted=false;},setPlaybackRate(){},getPlaybackRate:()=>1};
  setInterval(()=>{if(state===1&&fixturePlayer.getCurrentTime()>=8){time=8;state=0;fixtureSession.playerState(0);}},20);
  window.fixtureSession=createKaraokeSession({reference:()=>null,voiced:()=>true,context:()=>fixtureMic?.context,stream:()=>fixtureMic?.stream,inputSource:()=>fixtureMic?.gain,player:()=>fixturePlayer,micReady:()=>!!fixtureMic,stopBeats(){},loadVideo:async()=>true,cancelCalibration(){},
   async startMic(){if(fixtureMic)return;const context=new AudioContext({sampleRate:48000,sinkId:{type:'none'}}),osc=context.createOscillator(),gain=context.createGain(),dest=context.createMediaStreamDestination();osc.frequency.value=440;gain.gain.value=.15;osc.connect(gain);gain.connect(dest);osc.start();await context.resume();fixtureMic={context,osc,gain,stream:dest.stream};fixtureSession.micStarted();},
   async stopMic(){await fixtureSession.stopRecording();if(fixtureMic){await fixtureMic.context.close();fixtureMic=null;}fixtureSession.micStopped();}
  });
  const {BrowserRecordingStore}=await import('/recording-store.mjs');window.fixtureStore=new BrowserRecordingStore();
  window.hash=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(',');
 });
 await page.locator('#url').fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');await page.locator('#prepare-song').click();await page.waitForFunction(()=>!document.getElementById('sing-start').disabled);
 }
 await page.goto(site);await initialize();const $=id=>page.locator('#'+id);
 await $('segment-open').click();assert.equal(await $('segment-delay').inputValue(),'200');
 // Split without interrupting playback; precise edits and undo retain one boundary.
 await page.evaluate(()=>{fixturePlayer.seekTo(3.6);fixturePlayer.playVideo();});await $('segment-split').click();assert.equal(await page.evaluate(()=>fixturePlayer.getPlayerState()),1);
 await page.evaluate(()=>fixturePlayer.pauseVideo());await $('segment-boundary-panel').locator('summary').click();await $('segment-boundary-time').fill('00:04.000');await $('segment-boundary-time').dispatchEvent('change');assert.equal(await $('segment-part').locator('option').count(),2);
 await $('segment-earlier').click();assert.equal(await $('segment-boundary-time').inputValue(),'00:03.900');await $('segment-undo').click();assert.equal(await $('segment-boundary-time').inputValue(),'00:04.000');
 // Dragging changes both adjacent sections; undo restores exact original timing.
 const marker=page.locator('.segment-marker').first(),rect=await marker.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+20,rect.y+rect.height/2);await page.mouse.up();assert.notEqual(await $('segment-boundary-time').inputValue(),'00:04.000');await $('segment-undo').click();assert.equal(await $('segment-boundary-time').inputValue(),'00:04.000');
 // Cancellation during slow stem preparation cannot adopt an old take or start later.
 stemDelay=700;await $('segment-record').click();await $('segment-stop').click();await page.waitForFunction(()=>!document.getElementById('segment-record').disabled);await page.waitForTimeout(800);assert.equal((await page.evaluate(()=>fixtureStore.list())).length,0);assert.equal(await page.evaluate(()=>fixturePlayer.isMuted()),false);stemDelay=0;
 const beforeScore=await page.evaluate(()=>localStorage.getItem('karaoke.scores.v1'));
 await $('segment-record-settings').locator('summary').click();await $('segment-tail').selectOption('1');await $('segment-preroll').selectOption('3');await $('segment-part').selectOption('0');
 await $('segment-record').click();await page.waitForFunction(()=>fixturePlayer.isMuted()&&fixturePlayer.getPlayerState()===1);await page.evaluate(()=>fixturePlayer.pauseVideo());await page.waitForTimeout(250);await page.evaluate(()=>fixturePlayer.playVideo());await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('本段已保存'),{},{timeout:20000});
 assert.equal(await page.evaluate(()=>fixturePlayer.isMuted()),false);assert.equal(await $('segment-take').locator('option').count(),2);
 const first=(await page.evaluate(()=>fixtureStore.list()))[0];assert.ok(first.segmentTake);assert.equal(first.appliedDelayMs,0);assert.ok(first.seconds>=4.9);
 const firstHash=await page.evaluate(async row=>hash(await fixtureStore.blob(row,'voice')),first);
 await $('segment-part').selectOption('1');await $('segment-record').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('本段已保存'),{},{timeout:20000});
 assert.equal(await page.evaluate(()=>localStorage.getItem('karaoke.scores.v1')),beforeScore,'segment mode never writes whole-song scores');
 assert.match(await $('segment-coverage').textContent(),/所有段落/);
 // Default mix uses +200 once, has exact song length, and saves clean source for post.
 await $('segment-output-panel').locator('summary').click();await $('segment-compose').click();await page.waitForFunction(()=>!document.getElementById('segment-export').disabled);
 assert.match(await $('segment-status').textContent(),/200 ms/);await $('segment-export').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('已另存完整成品'));
 await page.evaluate(async()=>{await document.getElementById('segment-audio').play();fixturePlayer.playVideo();});assert.equal(await $('segment-audio').evaluate(el=>el.paused),true,'video playback stops composed preview');await page.evaluate(()=>fixturePlayer.pauseVideo());
 const mix=(await page.evaluate(()=>fixtureStore.list())).find(r=>r.segmentComposition);assert.ok(mix);assert.equal(mix.mode,'mix');assert.equal(mix.appliedDelayMs,200);assert.equal(mix.seconds,8);assert.deepEqual(mix.stems,['accompaniment']);
 const audio=await page.evaluate(async meta=>{const c=new AudioContext({sinkId:{type:'none'}}),buffer=await c.decodeAudioData(await(await fixtureStore.blob(meta)).arrayBuffer());await c.close();return {length:buffer.length,rate:buffer.sampleRate};},mix);assert.equal(audio.length/audio.rate,8);
 assert.equal(await page.evaluate(async row=>hash(await fixtureStore.blob(row,'voice')),first),firstHash);
 assert.equal(await $('post-recording').inputValue(),mix.id,'new composition integrates with post editing');
 await $('post-remix').click();await page.waitForFunction(id=>document.getElementById('post-recording').value!==id,mix.id);await page.waitForFunction(()=>!document.getElementById('post-remix').disabled);
 const edited=(await page.evaluate(()=>fixtureStore.list())).find(r=>r.parentId===mix.id);assert.ok(edited);assert.equal(edited.appliedDelayMs,200);assert.equal(edited.seconds,8);assert.equal(await page.evaluate(async r=>hash(await fixtureStore.blob(r,'voice')),edited),await page.evaluate(async r=>hash(await fixtureStore.blob(r,'voice')),mix));
 await $('segment-output').selectOption('voice');assert.equal(await $('segment-export').isDisabled(),true);await $('segment-compose').click();await page.waitForFunction(()=>!document.getElementById('segment-export').disabled);await $('segment-export').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('已另存完整成品'));
 const voice=(await page.evaluate(()=>fixtureStore.list())).find(r=>r.segmentComposition&&r.mode==='voice');assert.ok(voice);assert.equal(voice.appliedDelayMs,200);assert.deepEqual(voice.stems,[]);
 const alignment=await page.evaluate(async({voice,mix})=>{
  const c=new AudioContext({sampleRate:48000,sinkId:{type:'none'}}),decode=async(r,track)=>c.decodeAudioData(await(await fixtureStore.blob(r,track)).arrayBuffer());
  const v=await decode(voice),m=await decode(mix),raw=await decode(voice,'voice'),a=v.getChannelData(0),b=m.getChannelData(0),r=raw.getChannelData(0);let delayError=0,backError=0;
  for(let i=100;i<a.length-10000;i++){delayError=Math.max(delayError,Math.abs(a[i]-r[i+9600]));backError=Math.max(backError,Math.abs(b[i]-a[i]-.06*Math.sin(2*Math.PI*660*i/48000)));}
  await c.close();return {delayError,backError};
 },{voice,mix});assert.ok(alignment.delayError<.00012,JSON.stringify(alignment));assert.ok(alignment.backError<.00012,JSON.stringify(alignment));
 // A moved cut beyond a take's handles is rejected until explicitly allowing gaps.
 await $('segment-boundary-time').fill('00:00.200');await $('segment-boundary-time').dispatchEvent('change');await $('segment-compose').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('尚未完整涵蓋'));assert.equal(await $('segment-export').isDisabled(),true);await $('segment-undo').click();
 await $('segment-part').selectOption('0');await $('segment-join').click();await page.waitForFunction(()=>!document.getElementById('segment-export').disabled);await page.evaluate(()=>{const a=document.getElementById('segment-audio');a.currentTime=7.1;a.dispatchEvent(new Event('timeupdate'));});assert.equal(await $('segment-audio').evaluate(el=>el.paused),true,'join audition stops after the selected interval');
 await page.evaluate(()=>{fixturePlayer.seekTo(7.2);fixturePlayer.playVideo();});await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>fixturePlayer.getPlayerState()),1,'audio audition endpoint does not stop later video playback');await page.evaluate(()=>fixturePlayer.pauseVideo());
 // Persisted decisions reopen. No real user library or profile is touched.
 await page.reload();await initialize();await $('segment-open').click();assert.equal(await $('segment-part').locator('option').count(),2);assert.match(await $('segment-coverage').textContent(),/所有段落/);
 await mkdir('test-results',{recursive:true});await $('player-section').screenshot({path:'test-results/recording-segments.png'});assert.ok(await $('player-section').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 // Whole-song start still records and scores through the existing path.
 await $('recording-settings').locator('summary').click();await $('recording-mode').selectOption('voice');await $('sing-start').click();await page.waitForFunction(()=>document.getElementById('score-status').textContent.includes('演唱中'));
 assert.equal(await $('segment-tools').isHidden(),true);assert.equal(await $('segment-open').isVisible(),true);
 await page.evaluate(()=>{for(let t=0;t<7;t+=.1)fixtureSession.sample(t,440);fixturePlayer.seekTo(7);});await $('finish-song').click();await page.waitForFunction(()=>document.getElementById('score-status').textContent.includes('已結算'));
 assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('karaoke.scores.v1')).length));
 assert.deepEqual(errors,[]);assert.ok(!requests.some(r=>r.startsWith('DELETE /library')));
 console.log(JSON.stringify({splitWhilePlaying:true,dragPreciseUndo:true,cancelPreparation:true,pauseResume:true,realPCM:true,twoSegmentCapture:true,default200ms:true,backingClockUnchanged:true,missingCoverageBlocked:true,fullLength:true,rawUnchanged:true,pureVoice:true,postEdit:true,reload:true,wholeSongScoring:true,errors}));
}finally{await browser?.close();server.kill();}
