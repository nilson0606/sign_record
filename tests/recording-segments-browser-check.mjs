import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const port='4391',site='http://localhost:'+port;
const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:port},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,stemDelay=0;
const ref={version:1,videoId:'M7lc1UVf-VE',title:'分段錄音隔離測試',duration:8,step:.1,frames:Array(80).fill(440),beats:[],cacheId:'segment-fixture',hasPreview:true,separationModel:'demucs',pitchMethod:'rmvpe',separationMethod:'single',vocalMode:'all',rangeSeconds:0};
function wav(){const rate=48000,n=rate*8,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(.06*Math.sin(2*Math.PI*660.37*i/rate)*32767),44+i*2);return b;}
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
  window.guideEvents=[];
  const BaseContext=window.AudioContext;
  window.AudioContext=class extends BaseContext{createBufferSource(){const node=super.createBufferSource(),connect=node.connect.bind(node),start=node.start.bind(node),stop=node.stop.bind(node);let monitor=false;node.connect=(dest,...args)=>{monitor=dest===this.destination;return connect(dest,...args);};node.start=(...args)=>{if(monitor)guideEvents.push({action:'start',offset:args[1],rate:node.playbackRate.value});return start(...args);};node.stop=(...args)=>{if(monitor)guideEvents.push({action:'stop'});return stop(...args);};return node;}};
  const {createKaraokeSession}=await import('/session.mjs');
  window.fixtureMic=null;let time=0,anchor=0,state=2,muted=false;
  window.fixturePlayer={getCurrentTime:()=>state===1?Math.min(8,time+(performance.now()-anchor)/1000):time,getPlayerState:()=>state,seekTo(t){time=t;anchor=performance.now();},pauseVideo(){time=this.getCurrentTime();state=2;fixtureSession?.playerState(2);},playVideo(){if(time>=8)time=0;anchor=performance.now();state=1;fixtureSession?.playerState(1);},isMuted:()=>muted,mute(){muted=true;},unMute(){muted=false;},setPlaybackRate(){},getPlaybackRate:()=>1};
  setInterval(()=>{if(state===1&&fixturePlayer.getCurrentTime()>=8){time=8;state=0;fixtureSession.playerState(0);}},20);
  window.fixtureSession=createKaraokeSession({reference:()=>null,voiced:()=>true,context:()=>fixtureMic?.context,stream:()=>fixtureMic?.stream,inputSource:()=>fixtureMic?.gain,player:()=>fixturePlayer,micReady:()=>!!fixtureMic,stopBeats(){},loadVideo:async()=>true,cancelCalibration(){},
   async startMic(){if(fixtureMic)return;const context=new AudioContext({sampleRate:48000,sinkId:{type:'none'}}),osc=context.createOscillator(),gain=context.createGain(),dest=context.createMediaStreamDestination();osc.frequency.value=443.27;gain.gain.value=.15;osc.connect(gain);gain.connect(dest);osc.start();await context.resume();fixtureMic={context,osc,gain,stream:dest.stream};fixtureSession.micStarted();},
   async stopMic(){await fixtureSession.stopRecording();if(fixtureMic){await fixtureMic.context.close();fixtureMic=null;}fixtureSession.micStopped();}
  });
  const {BrowserRecordingStore}=await import('/recording-store.mjs');window.fixtureStore=new BrowserRecordingStore();
  window.hash=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(',');
 });
 await page.locator('#url').fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');await page.locator('#prepare-song').click();await page.waitForFunction(()=>!document.getElementById('sing-start').disabled);
 }
 await page.goto(site);await initialize();const $=id=>page.locator('#'+id);
 await $('segment-open').click();assert.equal(await $('segment-delay').inputValue(),'200');
 for(const id of ['segment-guide-mode','segment-guide-mode-player','sing-guide-mode'])assert.equal(await $(id).inputValue(),'original');
 assert.equal(await $('sing-guide-mode').isHidden(),true);
 for(const id of ['segment-take-mode-player','segment-take-mode-selected'])assert.equal(await $(id).inputValue(),'mix');
 assert.equal(await $('sing-start').isHidden(),true);assert.equal(await $('segment-side').isVisible(),true);
 assert.equal(await $('voice-section').isHidden(),true);assert.equal(await $('segment-player-tools').isVisible(),true);assert.equal(await $('segment-listen-player').isDisabled(),true);
 const layout=await page.evaluate(()=>{const rect=id=>document.getElementById(id).getBoundingClientRect(),left=rect('player-section'),right=rect('segment-side'),video=document.querySelector('#player-section .video-shell').getBoundingClientRect(),controls=rect('segment-section');return{equal:Math.abs(left.width-right.width)<1,aligned:Math.abs(left.top-right.top)<1,right:right.left>=left.right,videoAbove:video.bottom<=controls.top};});assert.deepEqual(layout,{equal:true,aligned:true,right:true,videoAbove:true});
 // Every split can be undone to one section, including after a page reload.
 for(const t of [1,2,4,6]){await page.evaluate(t=>fixturePlayer.seekTo(t),t);await $('segment-split').click();}
 for(const count of [4,3,2,1]){await $('segment-undo').click();assert.equal(await $('segment-part').locator('option').count(),count);}
 assert.equal(await $('segment-undo').isDisabled(),true);
 for(const t of [1,2,4,6]){await page.evaluate(t=>fixturePlayer.seekTo(t),t);await $('segment-split').click();}
 await page.reload();await initialize();await $('segment-open').click();
 assert.equal(await $('segment-undo').isEnabled(),true,'undo history survives reload');
 for(const count of [4,3,2,1]){await $('segment-undo').click();assert.equal(await $('segment-part').locator('option').count(),count);}
 await page.reload();await initialize();await $('segment-open').click();assert.equal(await $('segment-undo').isDisabled(),true,'popped history stays popped after reload');
 // A legacy two-section draft, expanded to five, must undo all the way to one.
 await page.evaluate(()=>fixturePlayer.seekTo(4));await $('segment-split').click();
 await page.evaluate(()=>{const key='karaoke.segment-draft.v1.segment-fixture',draft=JSON.parse(localStorage.getItem(key));delete draft.undoHistory;localStorage.setItem(key,JSON.stringify(draft));});
 await page.reload();await initialize();await $('segment-open').click();
 for(const t of [1,2,6]){await page.evaluate(t=>fixturePlayer.seekTo(t),t);await $('segment-split').click();}
 for(const count of [4,3,2]){await $('segment-undo').click();assert.equal(await $('segment-part').locator('option').count(),count);}
 assert.equal(await $('segment-undo').isEnabled(),true,'remaining legacy boundary must still be removable with undo');
 await page.reload();await initialize();await $('segment-open').click();
 assert.equal(await $('segment-undo').isEnabled(),true,'legacy two-section draft remains undoable after reload');
 await $('segment-undo').click();assert.equal(await $('segment-part').locator('option').count(),1);assert.equal(await $('segment-undo').isDisabled(),true);
 await page.reload();await initialize();await $('segment-open').click();assert.equal(await $('segment-part').locator('option').count(),1);
 // Merging all boundaries is itself undoable.
 for(const t of [2,4,6]){await page.evaluate(t=>fixturePlayer.seekTo(t),t);await $('segment-split').click();}
 await $('segment-merge-all').click();assert.equal(await $('segment-part').locator('option').count(),1);
 await page.reload();await initialize();await $('segment-open').click();await $('segment-undo').click();assert.equal(await $('segment-part').locator('option').count(),4);
 await $('segment-merge-all').click();assert.equal(await $('segment-part').locator('option').count(),1);
 // Split without interrupting playback; precise edits and undo retain one boundary.
 await page.evaluate(()=>{fixturePlayer.seekTo(3.6);fixturePlayer.playVideo();});await $('segment-split').click();assert.equal(await page.evaluate(()=>fixturePlayer.getPlayerState()),1);
 await page.evaluate(()=>fixturePlayer.pauseVideo());await $('segment-boundary-panel').locator('summary').click();await $('segment-boundary-time').fill('00:04.000');await $('segment-boundary-time').dispatchEvent('change');assert.equal(await $('segment-part').locator('option').count(),2);
 await $('segment-earlier').click();assert.equal(await $('segment-boundary-time').inputValue(),'00:03.900');await $('segment-undo').click();assert.equal(await $('segment-boundary-time').inputValue(),'00:04.000');
 // Dragging changes both adjacent sections; undo restores exact original timing.
 const marker=page.locator('.segment-marker').first(),rect=await marker.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+20,rect.y+rect.height/2);await page.mouse.up();assert.notEqual(await $('segment-boundary-time').inputValue(),'00:04.000');await $('segment-undo').click();assert.equal(await $('segment-boundary-time').inputValue(),'00:04.000');
 // Cancellation during slow stem preparation cannot adopt an old take or start later.
 await $('segment-guide-mode-player').selectOption('backing');assert.equal(await $('segment-guide-mode').inputValue(),'backing');
 stemDelay=700;await $('segment-record').click();
 assert.ok(await page.evaluate(()=>{const r=document.querySelector('#player-section .video-shell').getBoundingClientRect(),nav=document.querySelector('.section-nav').getBoundingClientRect();return r.top>=nav.bottom&&r.bottom<innerHeight;}),'record button brings the video into view');
 assert.equal(await $('segment-listen-player').isDisabled(),true);await $('segment-stop-player').click();await page.waitForFunction(()=>!document.getElementById('segment-record').disabled);await page.waitForTimeout(800);assert.equal((await page.evaluate(()=>fixtureStore.list())).length,0);assert.equal(await page.evaluate(()=>fixturePlayer.isMuted()),false);stemDelay=0;
 const beforeScore=await page.evaluate(()=>localStorage.getItem('karaoke.scores.v1'));
 await $('segment-record-settings').locator('summary').click();await $('segment-tail').selectOption('1');await $('segment-preroll').selectOption('3');await $('segment-part').selectOption('0');
 await $('segment-record').click();await page.waitForFunction(()=>fixturePlayer.isMuted()&&fixturePlayer.getPlayerState()===1);await page.evaluate(()=>fixturePlayer.pauseVideo());await page.waitForTimeout(250);await page.evaluate(()=>fixturePlayer.playVideo());await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('本段已保存'),{},{timeout:20000});
 assert.equal(await page.evaluate(()=>fixturePlayer.isMuted()),false);assert.equal(await $('segment-take').locator('option').count(),2);
 const first=(await page.evaluate(()=>fixtureStore.list()))[0];assert.ok(first.segmentTake);assert.equal(first.appliedDelayMs,0);assert.ok(first.seconds>=4.9);
 assert.equal(await $('post-recording').locator('option').count(),0,'single segments stay outside post processing');assert.equal(await $('recording-list').locator('button').count(),0);
 const firstHash=await page.evaluate(async row=>hash(await fixtureStore.blob(row,'voice')),first);
 // A single recorded take is immediately playable even while another section is unrecorded.
 await $('segment-listen-player').click();await page.waitForFunction(()=>!document.getElementById('segment-take-audio').paused);
 assert.equal(await page.evaluate(()=>fixturePlayer.getPlayerState()),2);
 await page.evaluate(async()=>{const c=new AudioContext({sinkId:{type:'none'}});window.previewMixBuffer=await c.decodeAudioData(await(await fetch(document.getElementById('segment-take-audio').src)).arrayBuffer());await c.close();});
 await $('segment-take-mode-selected').selectOption('voice');assert.equal(await $('segment-take-audio').isHidden(),true);
 for(const id of ['segment-take-mode-player','segment-take-mode-selected'])assert.equal(await $(id).inputValue(),'voice');
 await $('segment-listen-selected').click();await page.waitForFunction(()=>!document.getElementById('segment-take-audio').paused);
 const takeAlignment=await page.evaluate(async row=>{
   const c=new AudioContext({sinkId:{type:'none'}}),voice=await c.decodeAudioData(await(await fetch(document.getElementById('segment-take-audio').src)).arrayBuffer()),raw=await c.decodeAudioData(await(await fixtureStore.blob(row,'voice')).arrayBuffer());
   const v=voice.getChannelData(0),m=previewMixBuffer.getChannelData(0),r=raw.getChannelData(0),rate=voice.sampleRate;let delayError=0,backError=0,backEnergy=0;
   for(let i=100;i<v.length-10000;i++){const t=i/rate,s=row.post.segments.find(s=>t>=s.offset&&t<s.offset+s.duration),b=s?s.songTime+t-s.offset:0,expected=s&&b<8 ? .06*Math.sin(2*Math.PI*660.37*b) : 0;delayError=Math.max(delayError,Math.abs(v[i]-r[i+Math.round(.2*rate)]));backError=Math.max(backError,Math.abs(m[i]-v[i]-expected));backEnergy+=Math.abs(m[i]-v[i]);}
   await c.close();return {delayError,backError,backEnergy,length:voice.length,mixLength:previewMixBuffer.length,rawLength:raw.length};
 },first);
 assert.ok(takeAlignment.delayError<.00012,JSON.stringify(takeAlignment));assert.ok(takeAlignment.backError<.012,JSON.stringify(takeAlignment));assert.ok(takeAlignment.backEnergy>100);assert.equal(takeAlignment.length,takeAlignment.rawLength);assert.equal(takeAlignment.mixLength,takeAlignment.length);
 assert.equal(await page.evaluate(async row=>hash(await fixtureStore.blob(row,'voice')),first),firstHash,'preview modes preserve the source');
 await page.evaluate(()=>fixturePlayer.playVideo());assert.equal(await $('segment-take-audio').evaluate(el=>el.paused),true);await page.evaluate(()=>fixturePlayer.pauseVideo());
 // Leaving a section during a slow read must not play its recording later.
 await page.evaluate(async()=>{const {BrowserRecordingStore}=await import('/recording-store.mjs');window.originalBlob=BrowserRecordingStore.prototype.blob;BrowserRecordingStore.prototype.blob=async function(...args){await new Promise(resolve=>window.releaseTakeRead=resolve);return originalBlob.apply(this,args);};});
 await $('segment-listen-player').click();await page.waitForFunction(()=>!!window.releaseTakeRead);await $('segment-part').selectOption('1');
 await page.evaluate(async()=>{const {BrowserRecordingStore}=await import('/recording-store.mjs');BrowserRecordingStore.prototype.blob=originalBlob;releaseTakeRead();});
 await page.waitForTimeout(100);assert.equal(await $('segment-take-audio').isHidden(),true);assert.equal(await $('segment-listen-player').isDisabled(),true);
 await $('segment-guide-mode').selectOption('original');assert.equal(await $('segment-guide-mode-player').inputValue(),'original');
 const segmentGuideStarts=await page.evaluate(()=>guideEvents.filter(e=>e.action==='start').length);
 await page.evaluate(()=>fixturePlayer.mute());
 await $('segment-part').selectOption('1');await $('segment-record').click();await page.waitForFunction(()=>fixturePlayer.getPlayerState()===1&&!fixturePlayer.isMuted());
 await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('本段已保存'),{},{timeout:20000});
 assert.equal(await page.evaluate(()=>guideEvents.filter(e=>e.action==='start').length),segmentGuideStarts,'original guide does not add a second accompaniment');
 assert.equal(await page.evaluate(()=>fixturePlayer.isMuted()),true,'restore previously muted player');await page.evaluate(()=>fixturePlayer.unMute());
 // A later section uses its saved song position, not accompaniment from time zero.
 await $('segment-take-mode-player').selectOption('mix');await $('segment-listen-player').click();await page.waitForFunction(()=>!document.getElementById('segment-take-audio').paused);
 const laterTake=await page.evaluate(async()=>{const id=document.getElementById('segment-take').value,row=(await fixtureStore.list()).find(r=>r.id===id),c=new AudioContext({sinkId:{type:'none'}}),mix=await c.decodeAudioData(await(await fetch(document.getElementById('segment-take-audio').src)).arrayBuffer()),raw=await c.decodeAudioData(await(await fixtureStore.blob(row,'voice')).arrayBuffer()),m=mix.getChannelData(0),v=raw.getChannelData(0);let error=0;for(let i=100;i<m.length-10000;i++){const t=i/mix.sampleRate,s=row.post.segments.find(s=>t>=s.offset&&t<s.offset+s.duration),expected=s ? .06*Math.sin(2*Math.PI*660.37*(s.songTime+t-s.offset)) : 0;error=Math.max(error,Math.abs(m[i]-v[i+9600]-expected));}await c.close();return {start:row.post.segments[0].songTime,error};});assert.ok(laterTake.start>.8);assert.ok(laterTake.error<.012,JSON.stringify(laterTake));
 assert.equal(await page.evaluate(()=>localStorage.getItem('karaoke.scores.v1')),beforeScore,'segment mode never writes whole-song scores');
 assert.match(await $('segment-coverage').textContent(),/所有段落/);
 // Default mix uses +200 once, has exact song length, and saves clean source for post.
 await $('segment-compose').click();await page.waitForFunction(()=>!document.getElementById('segment-export').disabled);
 assert.equal(await $('post-recording').locator('option').count(),0,'trial composition is not published');assert.equal((await page.evaluate(()=>fixtureStore.list())).filter(r=>r.segmentComposition).length,0);
 assert.match(await $('segment-status').textContent(),/200 ms/);await $('segment-export').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('已存到錄音後處理'));assert.equal(await $('segment-export').isDisabled(),true);
 await page.evaluate(async()=>{await document.getElementById('segment-audio').play();fixturePlayer.playVideo();});assert.equal(await $('segment-audio').evaluate(el=>el.paused),true,'video playback stops composed preview');await page.evaluate(()=>fixturePlayer.pauseVideo());
 const mix=(await page.evaluate(()=>fixtureStore.list())).find(r=>r.segmentComposition);assert.ok(mix);assert.equal(mix.mode,'mix');assert.equal(mix.appliedDelayMs,200);assert.equal(mix.seconds,8);assert.deepEqual(mix.stems,['accompaniment']);
 const audio=await page.evaluate(async meta=>{const c=new AudioContext({sinkId:{type:'none'}}),buffer=await c.decodeAudioData(await(await fixtureStore.blob(meta)).arrayBuffer());await c.close();return {length:buffer.length,rate:buffer.sampleRate};},mix);assert.equal(audio.length/audio.rate,8);
 assert.equal(await page.evaluate(async row=>hash(await fixtureStore.blob(row,'voice')),first),firstHash);
 assert.equal(await $('post-recording').inputValue(),mix.id,'new composition integrates with post editing');
 assert.equal(await $('post-recording').locator('option').count(),1);
 await $('post-remix').click();await page.waitForFunction(id=>document.getElementById('post-recording').value!==id,mix.id);await page.waitForFunction(()=>!document.getElementById('post-remix').disabled);
 const edited=(await page.evaluate(()=>fixtureStore.list())).find(r=>r.parentId===mix.id);assert.ok(edited);assert.equal(edited.appliedDelayMs,200);assert.equal(edited.seconds,8);assert.equal(await page.evaluate(async r=>hash(await fixtureStore.blob(r,'voice')),edited),await page.evaluate(async r=>hash(await fixtureStore.blob(r,'voice')),mix));
 await $('segment-output').selectOption('voice');assert.equal(await $('segment-export').isDisabled(),true);await $('segment-compose').click();await page.waitForFunction(()=>!document.getElementById('segment-export').disabled);assert.equal(await $('post-recording').locator('option').count(),2,'another trial does not enter post menu');await $('segment-export').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('已存到錄音後處理'));
 const voice=(await page.evaluate(()=>fixtureStore.list())).find(r=>r.segmentComposition&&r.mode==='voice');assert.ok(voice);assert.equal(voice.appliedDelayMs,200);assert.deepEqual(voice.stems,[]);
 const alignment=await page.evaluate(async({voice,mix})=>{
  const c=new AudioContext({sampleRate:48000,sinkId:{type:'none'}}),decode=async(r,track)=>c.decodeAudioData(await(await fixtureStore.blob(r,track)).arrayBuffer());
  const v=await decode(voice),m=await decode(mix),raw=await decode(voice,'voice'),a=v.getChannelData(0),b=m.getChannelData(0),r=raw.getChannelData(0);let delayError=0,backError=0;
  for(let i=100;i<a.length-10000;i++){delayError=Math.max(delayError,Math.abs(a[i]-r[i+9600]));backError=Math.max(backError,Math.abs(b[i]-a[i]-.06*Math.sin(2*Math.PI*660.37*i/48000)));}
  await c.close();return {delayError,backError};
 },{voice,mix});assert.ok(alignment.delayError<.00012,JSON.stringify(alignment));assert.ok(alignment.backError<.00012,JSON.stringify(alignment));
 // A moved cut beyond a take's handles is rejected until explicitly allowing gaps.
 await $('segment-boundary-time').fill('00:00.200');await $('segment-boundary-time').dispatchEvent('change');await $('segment-compose').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('尚未完整涵蓋'));assert.equal(await $('segment-export').isDisabled(),true);await $('segment-undo').click();
 await $('segment-part').selectOption('0');await $('segment-join').click();await page.waitForFunction(()=>!document.getElementById('segment-export').disabled);await page.evaluate(()=>{const a=document.getElementById('segment-audio');a.currentTime=7.1;a.dispatchEvent(new Event('timeupdate'));});assert.equal(await $('segment-audio').evaluate(el=>el.paused),true,'join audition stops after the selected interval');
 await page.evaluate(()=>{fixturePlayer.seekTo(7.2);fixturePlayer.playVideo();});await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>fixturePlayer.getPlayerState()),1,'audio audition endpoint does not stop later video playback');await page.evaluate(()=>fixturePlayer.pauseVideo());
 // Persisted decisions reopen. No real user library or profile is touched.
 // Old drafts and recorded take labels must display current segment numbers after reload.
 await page.evaluate(()=>{const key='karaoke.segment-draft.v1.segment-fixture',d=JSON.parse(localStorage.getItem(key));d.parts.forEach((p,i)=>{delete p.autoName;p.name='第 1 段'+'（後段）'.repeat(i);});for(const h of d.undoHistory)h.parts.forEach((p,i)=>{delete p.autoName;p.name='第 1 段'+'（後段）'.repeat(i);});localStorage.setItem(key,JSON.stringify(d));});
 await page.reload();await initialize();await $('segment-open').click();assert.equal(await $('segment-part').locator('option').count(),2);assert.match(await $('segment-coverage').textContent(),/所有段落/);
 await $('segment-part').selectOption('1');assert.equal(await $('segment-name').inputValue(),'第 2 段');assert.match(await $('segment-selected-summary').textContent(),/^第 2 段/);assert.match(await $('segment-take-info').textContent(),/本段錄音：第 2 段/);
 await $('segment-boundary-panel').locator('summary').click();await $('segment-name').fill('副歌');await $('segment-name').dispatchEvent('change');
 await $('segment-part').selectOption('0');assert.equal(await $('segment-name').inputValue(),'第 1 段');await $('segment-part').selectOption('1');assert.equal(await $('segment-name').inputValue(),'副歌');
 await $('segment-undo').click();assert.equal(await $('segment-name').inputValue(),'第 2 段');await $('segment-save').click();await $('segment-part').selectOption('0');
 await $('segment-listen-player').click();await page.waitForFunction(()=>!document.getElementById('segment-take-audio').paused);assert.equal(await $('segment-take-audio').isVisible(),true);
 const savedParts=await page.evaluate(()=>JSON.parse(localStorage.getItem('karaoke.segment-draft.v1.segment-fixture')).parts);
 await $('segment-merge-all').click();assert.equal(await $('segment-part').locator('option').count(),1);
 await $('segment-undo').click();assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('karaoke.segment-draft.v1.segment-fixture')).parts),savedParts,'undo restores all take selections');
 assert.equal(await page.evaluate(async row=>hash(await fixtureStore.blob(row,'voice')),first),firstHash,'merging boundaries preserves recordings');
 // All six versions of one section remain selectable; overlapping adjacent takes stay out.
 const extraTakes=await page.evaluate(async row=>{const mix=await fixtureStore.blob(row),voice=await fixtureStore.blob(row,'voice'),ids=[];for(let i=0;i<5;i++){const copy={...row,id:crypto.randomUUID(),created:Date.now()+i};await fixtureStore.saveRemix(copy,mix,voice);ids.push(copy.id);}return ids;},first);
 await $('segment-refresh').click();await page.waitForFunction(()=>document.getElementById('segment-take-count').textContent.includes('6 個'));
 assert.equal(await $('segment-take').locator('option').count(),7);for(const id of extraTakes)await $('segment-take').selectOption(id);
 await page.reload();await initialize();await $('segment-open').click();assert.equal(await $('segment-take').locator('option').count(),7);
 await $('segment-part').selectOption('1');assert.equal(await $('segment-take').locator('option').count(),2);assert.ok(!(await $('segment-take').locator('option').evaluateAll(opts=>opts.map(o=>o.value))).includes(first.id),'preroll overlap must not offer another section');
 await $('segment-part').selectOption('0');await $('segment-take').selectOption(first.id);
 // Delete only the selected fixture version; cancellation, failure and other takes are preserved.
 const duplicate=await page.evaluate(async row=>{const copy={...row,id:crypto.randomUUID(),created:Date.now(),segmentTake:{...row.segmentTake,name:'刪除測試版'}};await fixtureStore.saveRemix(copy,await fixtureStore.blob(row),await fixtureStore.blob(row,'voice'));return copy;},first);
 await $('segment-refresh').click();await page.waitForFunction(id=>[...document.getElementById('segment-take').options].some(o=>o.value===id),duplicate.id);
 await $('segment-take').selectOption(duplicate.id);
 // Existing cross-section choices from older drafts are preserved, not silently replaced.
 await page.evaluate(id=>{const key='karaoke.segment-draft.v1.segment-fixture',d=JSON.parse(localStorage.getItem(key));d.parts[1].takeId=id;localStorage.setItem(key,JSON.stringify(d));},duplicate.id);
 await page.reload();await initialize();await $('segment-open').click();await $('segment-part').selectOption('1');assert.equal(await $('segment-take').inputValue(),duplicate.id);assert.match(await $('segment-take').locator('option:checked').textContent(),/沿用已選錄音/);await $('segment-part').selectOption('0');
 page.once('dialog',async d=>{assert.match(d.message(),/刪除測試版/);assert.match(d.message(),/2 段/);await d.dismiss();});await $('segment-delete-selected').click();assert.ok((await page.evaluate(()=>fixtureStore.list())).some(r=>r.id===duplicate.id));
 await page.evaluate(async()=>{const {RecordingStore}=await import('/recording-store.mjs');window.originalDelete=RecordingStore.prototype.delete;RecordingStore.prototype.delete=async()=>{throw Error('fixture delete failure');};});
 page.once('dialog',d=>d.accept());await $('segment-delete-selected').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('fixture delete failure'));assert.equal(await $('segment-take').inputValue(),duplicate.id);
 await page.evaluate(async()=>{const {RecordingStore}=await import('/recording-store.mjs');RecordingStore.prototype.delete=originalDelete;});
 page.once('dialog',d=>d.accept());await $('segment-delete-player').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.startsWith('已刪除此版錄音'));
 assert.ok(!(await page.evaluate(()=>fixtureStore.list())).some(r=>r.id===duplicate.id));assert.equal(await $('segment-listen-player').isDisabled(),true);
 await $('segment-undo').click();assert.ok(await page.evaluate(id=>{const d=JSON.parse(localStorage.getItem('karaoke.segment-draft.v1.segment-fixture'));return [d,...d.undoHistory].every(p=>p.parts.every(s=>s.takeId!==id));},duplicate.id),'undo cannot revive deleted source choices');
 assert.equal(await page.evaluate(async row=>hash(await fixtureStore.blob(row,'voice')),first),firstHash);
 assert.ok((await page.evaluate(()=>fixtureStore.list())).some(r=>r.id===mix.id),'saved composition survives source deletion');
 await page.reload();await initialize();await $('segment-open').click();assert.ok(!(await $('segment-take').locator('option').evaluateAll(options=>options.map(o=>o.value))).includes(duplicate.id));
 for(let i=0;i<savedParts.length;i++){await $('segment-part').selectOption(String(i));await $('segment-take').selectOption(savedParts[i].takeId);}
 await $('segment-part').selectOption('0');await $('segment-listen-player').click();await page.waitForFunction(()=>!document.getElementById('segment-take-audio').paused);
 await mkdir('test-results',{recursive:true});await page.evaluate(()=>{document.querySelector('.section-nav').style.position='static';document.getElementById('theme-select').value='warm';document.documentElement.dataset.theme='warm';document.getElementById('player-section').scrollIntoView({behavior:'instant',block:'start'});});await page.screenshot({path:'test-results/recording-segments-layout.png'});for(const id of ['player-section','segment-side'])assert.ok(await $(id).evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 // Whole-song start still records and scores through the existing path.
 await $('segment-whole').click();assert.equal(await $('voice-section').isVisible(),true);assert.equal(await $('segment-player-tools').isHidden(),true);assert.equal(await $('segment-take-audio').evaluate(el=>el.paused),true);assert.equal(await $('sing-start').isVisible(),true);assert.equal(await $('segment-side').isHidden(),true);await $('recording-settings').locator('summary').click();// Backing guide also works when no recording is saved; cancellation cannot start stale audio.
 await $('recording-mode').selectOption('off');await $('sing-guide-mode').selectOption('backing');
 stemDelay=700;await $('sing-start').click();await page.waitForFunction(()=>document.getElementById('score-status').textContent.includes('正在準備演唱時帶唱'));
 await page.evaluate(()=>{fixtureSession.stopRecording();fixtureSession.micStopped();});await page.waitForTimeout(900);stemDelay=0;
 assert.equal(await page.evaluate(()=>fixturePlayer.getPlayerState()),2);assert.equal(await page.evaluate(()=>fixturePlayer.isMuted()),false);assert.equal(await page.evaluate(()=>guideEvents.filter(e=>e.action==='start').length),0);
 await $('sing-start').click();await page.waitForFunction(()=>fixturePlayer.isMuted()&&fixturePlayer.getPlayerState()===1);
 await page.waitForFunction(()=>guideEvents.some(e=>e.action==='start'));assert.equal(await $('sing-guide-mode').isDisabled(),true);
 await page.evaluate(()=>fixturePlayer.pauseVideo());assert.equal(await page.evaluate(()=>guideEvents.at(-1).action),'stop');
 await page.evaluate(()=>{fixturePlayer.seekTo(3);fixturePlayer.playVideo();});await page.waitForFunction(()=>guideEvents.some(e=>e.action==='start'&&e.offset>=3));
 await page.evaluate(()=>fixturePlayer.seekTo(5));await page.waitForFunction(()=>guideEvents.some(e=>e.action==='start'&&e.offset>=5));
 await $('finish-song').click();await page.waitForFunction(()=>document.getElementById('score-status').textContent.match(/已結算|未保存分數/));
 assert.equal(await page.evaluate(()=>fixturePlayer.isMuted()),false);assert.equal(await page.evaluate(()=>guideEvents.at(-1).action),'stop');assert.equal(await $('sing-guide-mode').isEnabled(),true);
 // Original guide uses the video alone and restores the user's previous mute setting.
 const wholeGuideStarts=await page.evaluate(()=>guideEvents.filter(e=>e.action==='start').length);
 await $('sing-guide-mode').selectOption('original');await page.evaluate(()=>fixturePlayer.mute());
 await $('recording-mode').selectOption('voice');await $('sing-start').click();await page.waitForFunction(()=>document.getElementById('score-status').textContent.includes('演唱中'));
 assert.equal(await page.evaluate(()=>fixturePlayer.isMuted()),false);assert.equal(await page.evaluate(()=>guideEvents.filter(e=>e.action==='start').length),wholeGuideStarts);
 assert.equal(await $('segment-tools').isHidden(),true);assert.equal(await $('segment-open').isVisible(),true);
 await page.waitForTimeout(700);await page.evaluate(()=>{for(let t=0;t<7;t+=.1)fixtureSession.sample(t,440);fixturePlayer.seekTo(7);});await $('finish-song').click();await page.waitForFunction(()=>document.getElementById('score-status').textContent.includes('已結算'));
 assert.equal(await page.evaluate(()=>fixturePlayer.isMuted()),true);
 assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('karaoke.scores.v1')).length));
 await page.waitForFunction(()=>!document.getElementById('recording-review').hidden);
 await page.waitForFunction(()=>!document.getElementById('recording-review-save').disabled);
 const pendingRows=await page.evaluate(()=>fixtureStore.list()),pendingId=await $('recording-review-take').inputValue(),pending=pendingRows.find(r=>r.id===pendingId);assert.ok(pending?.complete,JSON.stringify({rows:pendingRows.map(r=>({id:r.id,pending:r.postPending,complete:r.complete,segment:r.segmentTake?.name,created:r.created,seconds:r.seconds,error:r.captureError})),status:await $('recording-status').textContent()}));
 const pendingHash=await page.evaluate(async row=>hash(await fixtureStore.blob(row,'voice')),pending);
 assert.ok(!(await $('post-recording').locator('option').evaluateAll(nodes=>nodes.map(n=>n.value))).includes(pending.id),'whole-song take waits for approval');
 await page.reload();await initialize();assert.equal(await $('recording-review-take').inputValue(),pending.id);assert.equal(await $('recording-review-mode').inputValue(),'mix');
 await $('recording-review').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/recording-review-layout.png'});
 await $('recording-review-listen').click();await page.waitForFunction(()=>!document.getElementById('recording-review-audio').paused);
 await $('recording-review-mode').selectOption('voice');await $('recording-review-listen').click();await page.waitForFunction(()=>!document.getElementById('recording-review-audio').paused);
 assert.equal(await page.evaluate(async row=>hash(await fixtureStore.blob(row,'voice')),pending),pendingHash);
 // Failed approval cannot publish a pending take.
 await page.evaluate(async()=>{const {RecordingStore}=await import('/recording-store.mjs');window.originalSave=RecordingStore.prototype.save;RecordingStore.prototype.save=async()=>{throw Error('fixture approval failure');};});
 await $('recording-review-save').click();await page.waitForFunction(()=>document.getElementById('recording-review-status').textContent.includes('fixture approval failure'));
 assert.ok(!(await $('post-recording').locator('option').evaluateAll(nodes=>nodes.map(n=>n.value))).includes(pending.id));
 await page.evaluate(async()=>{const {RecordingStore}=await import('/recording-store.mjs');RecordingStore.prototype.save=originalSave;});
 await $('recording-review-save').click();await page.waitForFunction(id=>document.getElementById('post-recording').value===id,pending.id);
 assert.equal((await page.evaluate(()=>fixtureStore.list())).find(r=>r.id===pending.id).postPending,false);assert.equal(await $('recording-review').isHidden(),true);
 // Both pending takes and legacy/saved recordings still support explicit deletion.
 const pendingCopy=await page.evaluate(async row=>{const copy={...row,id:crypto.randomUUID(),created:Date.now(),postPending:true};await fixtureStore.saveRemix(copy,await fixtureStore.blob(row),await fixtureStore.blob(row,'voice'));return copy;},pending);
 await $('recordings-panel').locator('summary').click();await $('recording-refresh').click();await page.waitForFunction(id=>document.getElementById('recording-review-take').value===id,pendingCopy.id);
 page.once('dialog',d=>d.dismiss());await $('recording-review-delete').click();assert.ok((await page.evaluate(()=>fixtureStore.list())).some(r=>r.id===pendingCopy.id));
 page.once('dialog',d=>d.accept());await $('recording-review-delete').click();await page.waitForFunction(()=>document.getElementById('recording-review').hidden);assert.ok(!(await page.evaluate(()=>fixtureStore.list())).some(r=>r.id===pendingCopy.id));
 const legacy=await page.evaluate(async row=>{const copy={...row,id:crypto.randomUUID(),created:Date.now()};delete copy.postPending;await fixtureStore.saveRemix(copy,await fixtureStore.blob(row),await fixtureStore.blob(row,'voice'));return copy;},pending);
 await $('recording-refresh').click();await page.waitForFunction(id=>[...document.getElementById('post-recording').options].some(o=>o.value===id),legacy.id);
 for(const id of [legacy.id,mix.id]){await $('post-recording').selectOption(id);page.once('dialog',d=>d.accept());await $('selected-recording-delete').click();await page.waitForFunction(id=>![...document.getElementById('post-recording').options].some(o=>o.value===id),id);assert.ok(!(await page.evaluate(()=>fixtureStore.list())).some(r=>r.id===id));}
 await page.evaluate(async row=>{await fixtureStore.saveRemix(row,await fixtureStore.blob((await fixtureStore.list()).find(r=>r.postPending===false)),await fixtureStore.blob((await fixtureStore.list()).find(r=>r.postPending===false),'voice'));},pendingCopy);
 await $('recording-refresh').click();await page.waitForFunction(id=>document.getElementById('recording-review-take').value===id,pendingCopy.id);
 page.once('dialog',d=>d.accept());await $('recording-delete-all').click();await page.waitForFunction(()=>document.querySelectorAll('#post-recording option').length===0);
 const retained=await page.evaluate(()=>fixtureStore.list());assert.ok(retained.some(r=>r.id===pendingCopy.id));assert.ok(retained.some(r=>r.id===first.id));assert.ok(retained.every(r=>r.postPending||r.segmentTake));
 // Song-scoped clearing never touches whole takes, approved products or another song.
 const protectedRows=await page.evaluate(async row=>{
  const mix=await fixtureStore.blob(row),voice=await fixtureStore.blob(row,'voice'),copies=[];
  for(const kind of ['whole','composition','foreign']){const copy=structuredClone(row);copy.id=crypto.randomUUID();copy.created=Date.now();if(kind==='foreign'){copy.post.reference.cacheId='another-song';copy.segmentTake.key='another-song';}else{delete copy.segmentTake;copy.postPending=false;if(kind==='composition')copy.segmentComposition={version:1};}await fixtureStore.saveRemix(copy,mix,voice);copies.push({id:copy.id,hash:await hash(voice)});}return copies;
 },first);
 await $('recording-refresh').click();await page.waitForFunction(id=>[...document.getElementById('post-recording').options].some(o=>o.value===id),protectedRows[0].id);
 await $('segment-open').click();await $('segment-refresh').click();await page.waitForFunction(()=>!document.getElementById('segment-delete-song-takes').disabled);
 const idsBeforeClear=await page.evaluate(async()=>(await fixtureStore.list()).map(r=>r.id).sort()),postBeforeClear=await $('post-recording').locator('option').evaluateAll(opts=>opts.map(o=>o.value).sort());
 const boundariesBeforeClear=await page.evaluate(()=>JSON.parse(localStorage.getItem('karaoke.segment-draft.v1.segment-fixture')).parts.map(({id,name,start,end})=>({id,name,start,end})));
 page.once('dialog',async d=>{assert.match(d.message(),/分段錄音隔離測試/);assert.match(d.message(),/全部 \d+ 筆分段錄音/);assert.match(d.message(),/錄音後處理/);await d.dismiss();});await $('segment-delete-song-takes').click();await page.waitForFunction(()=>!document.getElementById('segment-delete-song-takes').disabled);
 assert.deepEqual(await page.evaluate(async()=>(await fixtureStore.list()).map(r=>r.id).sort()),idsBeforeClear,'cancelling deletes nothing');
 await page.evaluate(async id=>{const {RecordingStore}=await import('/recording-store.mjs');window.clearOriginalDelete=RecordingStore.prototype.delete;RecordingStore.prototype.delete=function(target){if(target===id)throw Error('fixture clear failure');return clearOriginalDelete.call(this,target);};},first.id);
 page.once('dialog',d=>d.accept());await $('segment-delete-song-takes').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('1 筆未能清除'));
 assert.ok((await page.evaluate(()=>fixtureStore.list())).some(r=>r.id===first.id));
 await page.evaluate(async()=>{const {RecordingStore}=await import('/recording-store.mjs');RecordingStore.prototype.delete=clearOriginalDelete;});
 page.once('dialog',d=>d.accept());await $('segment-delete-song-takes').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('已清除此歌曲的 1 筆'));
 assert.equal(await $('segment-delete-song-takes').isDisabled(),true);assert.deepEqual(await $('post-recording').locator('option').evaluateAll(opts=>opts.map(o=>o.value).sort()),postBeforeClear);
 const rowsAfterClear=await page.evaluate(()=>fixtureStore.list());assert.ok(rowsAfterClear.some(r=>r.id===pendingCopy.id));assert.ok(!rowsAfterClear.some(r=>r.segmentTake?.key==='segment-fixture'));
 for(const entry of protectedRows)assert.equal(await page.evaluate(async({id})=>hash(await fixtureStore.blob((await fixtureStore.list()).find(r=>r.id===id),'voice')),entry),entry.hash);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('karaoke.segment-draft.v1.segment-fixture')).parts.map(({id,name,start,end})=>({id,name,start,end}))),boundariesBeforeClear);
 assert.ok(await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('karaoke.segment-draft.v1.segment-fixture'));return [d,...d.undoHistory].every(plan=>plan.parts.every(p=>!p.takeId));}),'undo history cannot revive cleared sources');
 await page.reload();await initialize();await $('segment-open').click();assert.equal(await $('segment-delete-song-takes').isDisabled(),true);assert.equal(await $('segment-take').locator('option').count(),1);
 assert.deepEqual(errors,[]);assert.ok(!requests.some(r=>r.startsWith('DELETE /library')));
 console.log(JSON.stringify({undoToOne:true,persistedUndo:true,legacyMergeAll:true,mergePreservesRecordings:true,splitWhilePlaying:true,dragPreciseUndo:true,cancelPreparation:true,pauseResume:true,realPCM:true,twoSegmentCapture:true,default200ms:true,backingClockUnchanged:true,missingCoverageBlocked:true,fullLength:true,rawUnchanged:true,pureVoice:true,postEdit:true,reload:true,wholeSongScoring:true,errors}));
}finally{await browser?.close();server.kill();}
