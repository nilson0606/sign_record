import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const port='4395',site='http://localhost:'+port;
const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:port},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,stemDelay=0;const requested=[];
const baseRef={version:1,videoId:'M7lc1UVf-VE',title:'分段錄音隔離測試',duration:8,step:.1,frames:Array(80).fill(440),beats:[],cacheId:'segment-fixture',hasPreview:true,separationModel:'demucs',pitchMethod:'rmvpe',separationMethod:'single',vocalMode:'all',rangeSeconds:0};
let ref={...baseRef};
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
  let json;if(url.pathname==='/session')json={token:'fixture',features:['separation-progress','pitch-methods','song-key-versions']};
  else if(url.pathname==='/library/location')json={configured:true,path:'fixture-only'};
  else if(url.pathname==='/library')json={songs:[0,-2,3].map(shift=>({id:'segment-fixture'+(shift?'_key_'+shift:''),videoId:baseRef.videoId,title:baseRef.title+' Key '+shift,baseTitle:baseRef.title,pitchShift:shift,seconds:0,hasPreview:true,vocalMode:'all',pitchMethod:'rmvpe',bytes:1000}))};
  else if(url.pathname==='/jobs'&&req.method()==='POST'){const shift=req.postDataJSON().pitchShift||0;ref={...baseRef,pitchShift:shift,baseTitle:baseRef.title,title:baseRef.title+' Key '+shift,cacheId:'segment-fixture'+(shift?'_key_'+shift:''),frames:baseRef.frames.map(hz=>hz*2**(shift/12))};json={id:'fixture-job'};}
  else if(url.pathname==='/jobs/fixture-job/reference')json=ref;
  else if(url.pathname==='/jobs/fixture-job')json={ready:true,cached:true,stage:'ready',message:'Ready'};
  else if(url.pathname.startsWith('/library/segment-fixture')&&/\/(accompaniment|vocals|backing)$/.test(url.pathname)){requested.push(url.pathname);if(stemDelay)await new Promise(resolve=>setTimeout(resolve,stemDelay));return r.fulfill({body:wav(),contentType:'audio/wav',headers});}
  else return r.fulfill({status:404,json:{error:'Unexpected fixture request'},headers});
  return r.fulfill({json,headers});
 });
 async function initialize(shift=-2){await page.evaluate(async()=>{
  window.guideEvents=[];window.guideActive=0;
  const BaseContext=window.AudioContext;
  window.AudioContext=class extends BaseContext{createBufferSource(){const node=super.createBufferSource(),connect=node.connect.bind(node),start=node.start.bind(node),stop=node.stop.bind(node);let monitor=false;node.connect=(dest,...args)=>{monitor=dest===this.destination;return connect(dest,...args);};node.start=(...args)=>{guideActive++;guideEvents.push({action:'start',offset:args[1],rate:node.playbackRate.value});return start(...args);};node.stop=(...args)=>{guideActive--;guideEvents.push({action:'stop'});return stop(...args);};return node;}};
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
  window.expectedWhole=async(row,mode)=>{
   const {remixRecording}=await import('/recording-process.mjs'),c=new AudioContext({sampleRate:48000,sinkId:{type:'none'}});
   try{
    const raw=await c.decodeAudioData(await(await fixtureStore.blob(row,'voice')).arrayBuffer()),tracks=[];
    if(mode==='mix')tracks.push(await c.decodeAudioData(await(await fetch('http://127.0.0.1:4274/library/segment-fixture/accompaniment')).arrayBuffer()));
    const samples=row.segmentComposition?row.post.samples:Array.from({length:Math.ceil(raw.duration/.1)},(_,i)=>({offset:i*.1,hz:443.27}));
    const meta={...row,mode,balance:JSON.parse(localStorage.getItem('karaoke.recording-balance.v1')||'{"manual":false,"voice":70,"backing":30}'),post:{...row.post,samples},postEdit:{version:1,start:0,end:row.segmentComposition?row.seconds:raw.duration,fadeIn:0,fadeOut:0}};
    delete meta.fixedMixGains;delete meta.segmentTake;delete meta.segmentComposition;
    return await remixRecording(raw,tracks,meta,200);
   }finally{await c.close();}
  };
  window.audioError=(a,b)=>{let error=0;for(let i=100;i<Math.min(a.length,b.length)-15000;i++)error=Math.max(error,Math.abs(a[i]-b[i]));return error;};

 });
 await page.locator('#song-key').selectOption(String(shift));await page.locator('#url').fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');await page.locator('#prepare-song').click();await page.waitForFunction(()=>!document.getElementById('sing-start').disabled);
 }
 await page.goto(site);await initialize();const $=id=>page.locator('#'+id);

 assert.equal(await $('song-key').inputValue(),'-2');assert.equal(await page.evaluate(()=>fixturePlayer.isMuted()),true);
 assert.ok((await $('song-key-status').textContent()).includes('YouTube'));
 assert.equal(await page.evaluate(()=>fixtureSession.reference().pitchShift),-2);
 const play=async()=>{await page.evaluate(()=>fixturePlayer.playVideo());await page.waitForTimeout(180);};
 await play();assert.equal(await page.evaluate(()=>guideActive),2);
 await page.evaluate(()=>fixturePlayer.pauseVideo());await $('sing-guide-mode').selectOption('backing');await play();
 assert.equal(await page.evaluate(()=>guideActive),1);
 await page.evaluate(()=>{fixturePlayer.unMute();fixturePlayer.seekTo(3);});await page.waitForTimeout(160);
 assert.equal(await page.evaluate(()=>fixturePlayer.isMuted()),true,'muting remains enforced after native controls change');
 assert.ok(await page.evaluate(()=>guideEvents.some(e=>e.action==='start'&&e.offset>=3)));
 await page.evaluate(()=>fixturePlayer.pauseVideo());await $('segment-open').click();
 await page.evaluate(()=>fixturePlayer.seekTo(4));await $('segment-split').click();await $('segment-part').selectOption('0');
 await $('segment-record-settings summary').click();await $('segment-tail').selectOption('1');
 await $('segment-record').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('本段已保存'),{},{timeout:20000});
 const take=(await page.evaluate(()=>fixtureStore.list()))[0];assert.equal(take.post.reference.pitchShift,-2);assert.equal(take.segmentTake.key,'segment-fixture_key_-2');
 await $('segment-listen-selected').click();await page.waitForFunction(()=>!document.getElementById('segment-take-audio').paused);
 assert.ok(requested.every(path=>path.includes('segment-fixture_key_-2')));
 await $('segment-whole').click();await $('recording-settings summary').click();await $('recording-mode').selectOption('voice');
 await $('sing-start').click();await page.waitForFunction(()=>document.getElementById('score-status').textContent.includes('演唱中'));
 assert.equal(await page.evaluate(()=>fixturePlayer.isMuted()),true);await page.waitForTimeout(700);await $('finish-song').click();
 await page.waitForFunction(()=>!document.getElementById('song-key').disabled);
 const whole=(await page.evaluate(()=>fixtureStore.list())).find(row=>!row.segmentTake);assert.equal(whole.post.reference.pitchShift,-2);assert.equal(whole.post.reference.cacheId,take.post.reference.cacheId);
 await $('song-key').selectOption('3');await $('song-key-apply').click();await page.waitForFunction(()=>document.getElementById('song-key').value==='3'&&!document.getElementById('sing-start').disabled);
 await $('segment-open').click();assert.equal(await $('segment-part').locator('option').count(),1);assert.equal(await $('segment-take').locator('option').count(),1);
 await $('segment-whole').click();await $('song-key').selectOption('-2');await $('song-key-apply').click();await page.waitForFunction(()=>document.getElementById('song-key').value==='-2'&&!document.getElementById('sing-start').disabled);
 await $('segment-open').click();assert.equal(await $('segment-part').locator('option').count(),2);await $('segment-part').selectOption('0');assert.equal(await $('segment-take').inputValue(),take.id);
 await page.reload();await initialize();await $('segment-open').click();await $('segment-part').selectOption('0');assert.equal(await $('segment-take').inputValue(),take.id);
 await $('segment-whole').click();await $('song-key').selectOption('0');await $('song-key-apply').click();await page.waitForFunction(()=>document.getElementById('song-key').value==='0'&&!document.getElementById('sing-start').disabled);
 assert.equal(await page.evaluate(()=>fixturePlayer.isMuted()),false,'return to original restores native player audio');
 await $('library-panel > summary').click();assert.equal(await page.locator('#library-list > li > details').count(),1);await page.locator('[data-song-id="segment-fixture_key_-2"]').click();await page.waitForFunction(()=>document.getElementById('song-key').value==='-2'&&!document.getElementById('sing-start').disabled);
 assert.deepEqual(errors,[]);await mkdir('test-results',{recursive:true});await page.locator('.song-key-control').screenshot({path:'test-results/song-key-control.png'});
 await page.locator('#library-list').screenshot({path:'test-results/song-key-library.png'});
 console.log(JSON.stringify({shiftedMute:true,pauseSeek:true,guideChoice:true,wholeAndSegmentCapture:true,versionsIsolated:true,reload:true,originalRestored:true,errors}));
}finally{await browser?.close();server.kill();}
