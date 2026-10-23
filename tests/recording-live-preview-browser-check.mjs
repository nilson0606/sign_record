import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const port='4398',server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:port},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser;
try{
 await new Promise((ok,no)=>{server.stdout.once('data',ok);server.stderr.once('data',x=>no(Error(x.toString())));server.once('error',no);});
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.goto('http://localhost:'+port);
 await page.evaluate(async()=>{
  const {createRenderedRecordingPreview}=await import('/recording-live-preview.mjs');
  const {remixRecording,wavBlob}=await import('/recording-process.mjs');
  // A preview must never create an output AudioContext or route its media into one.
  window.AudioContext=class {constructor(){throw Error('Unexpected real-time AudioContext');}};
  const rate=48000,duration=24;
  const tone=hz=>{const b=new AudioBuffer({numberOfChannels:1,length:rate*duration,sampleRate:rate}),x=b.getChannelData(0);for(let i=0;i<x.length;i++)x[i]=.06*Math.sin(2*Math.PI*hz*i/rate);return b;};
  const raw=tone(440),backing=tone(660),original=tone(880);
  window.settings={manual:true,voice:100,backing:100};
  const meta={mode:'mix',seconds:duration,balance:settings,stems:['accompaniment','vocals'],postEdit:{version:1,start:0,end:duration,fadeIn:0,fadeOut:0},post:{reference:{duration},segments:[{offset:0,songTime:0,duration}],samples:Array.from({length:240},(_,i)=>({offset:i/10,hz:440})),originalVocals:{stem:'vocals',ranges:[{start:12,end:16,mode:'original'}]}}};
  window.previewAudio=document.createElement('audio');previewAudio.controls=true;document.body.append(previewAudio);
  window.fixture={raw,tracks:[backing,original],meta,ms:300};
  const rendered=await remixRecording(raw,fixture.tracks,meta,300);
  window.previewErrors=[];
  window.preview=createRenderedRecordingPreview(previewAudio,{settings:()=>settings,onError:e=>previewErrors.push(e.message)});
  preview.set(fixture);
  window.initialURL=URL.createObjectURL(wavBlob(rendered));previewAudio.src=initialURL;await previewAudio.play();
  window.measure=async(time=2)=>{
   const decoder=new OfflineAudioContext(1,1,rate),b=await decoder.decodeAudioData(await(await fetch(previewAudio.src)).arrayBuffer()),x=b.getChannelData(0).slice(time*rate,(time+1)*rate);
   const power=hz=>{let re=0,im=0;for(let i=0;i<x.length;i++){re+=x[i]*Math.cos(2*Math.PI*hz*i/rate);im+=x[i]*Math.sin(2*Math.PI*hz*i/rate);}return 2*Math.hypot(re,im)/x.length;};
   return{voice:power(440),backing:power(660),original:power(880),rms:Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length),time:previewAudio.currentTime,paused:previewAudio.paused,src:previewAudio.src,duration:b.duration};
  };
  const render=OfflineAudioContext.prototype.startRendering;
  window.renderCount=0;
  OfflineAudioContext.prototype.startRendering=async function(){
   renderCount++;
   if(window.failRender){window.failRender=false;throw Error('Expected render failure');}
   const result=render.call(this);
   if(window.blockRender){window.blockRender=false;await new Promise(resolve=>window.releaseRender=()=>{window.releaseRender=null;resolve();});}
   return result;
  };
 });
 const settled=()=>page.waitForFunction(()=>previewAudio.dataset.previewUpdating==='false'&&previewAudio.readyState>=2);
 const initial=await page.evaluate(()=>measure());assert.ok(initial.voice>.04&&initial.backing>.04,JSON.stringify(initial));
 await page.evaluate(()=>{previewAudio.currentTime=3;previewAudio.volume=.6;previewAudio.playbackRate=1.25;settings={manual:true,voice:0,backing:200};preview.update();});
 await settled();await page.waitForTimeout(200);const backingOnly=await page.evaluate(()=>measure());
 assert.notEqual(backingOnly.src,initial.src);assert.equal(backingOnly.paused,false);assert.ok(backingOnly.time>=3&&backingOnly.time<5,JSON.stringify(backingOnly));
 assert.equal(backingOnly.duration,24);assert.ok(backingOnly.backing>initial.backing*1.8&&backingOnly.voice<.002,JSON.stringify(backingOnly));
 assert.deepEqual(await page.evaluate(()=>[previewAudio.volume,previewAudio.playbackRate]),[.6,1.25]);
 await page.evaluate(()=>{previewAudio.pause();previewAudio.currentTime=5;settings={manual:true,voice:200,backing:0};preview.update();});
 await settled();const voiceOnly=await page.evaluate(()=>measure());
 assert.ok(voiceOnly.voice>initial.voice*1.8&&voiceOnly.backing<.002,JSON.stringify(voiceOnly));assert.equal(voiceOnly.paused,true);assert.equal(voiceOnly.time,5);
 // A slow obsolete render cannot overwrite a more recent slider change.
 await page.evaluate(()=>{window.blockRender=true;settings={manual:true,voice:0,backing:0};preview.update();});
 await page.waitForFunction(()=>!!window.releaseRender);
 await page.evaluate(async()=>{await previewAudio.play();previewAudio.currentTime=7;settings={manual:true,voice:100,backing:100};preview.update();previewAudio.pause();releaseRender();});
 await settled();const latest=await page.evaluate(()=>measure());assert.equal(latest.paused,true);assert.ok(latest.time>=7);assert.ok(latest.voice>.04&&latest.backing>.04);
 const originalOnly=await page.evaluate(()=>measure(13)),afterRange=await page.evaluate(()=>measure(18));
 assert.ok(originalOnly.original>.04&&originalOnly.backing>.04&&originalOnly.voice<.002,JSON.stringify(originalOnly));assert.ok(afterRange.voice>.04&&afterRange.original<.002,JSON.stringify(afterRange));
 // Rapid changes coalesce into one render, including an exact mute.
 const count=await page.evaluate(()=>{const count=renderCount;for(let i=10;i>=0;i--){settings={manual:true,voice:i,backing:i};preview.update();}return count;});
 await settled();assert.equal(await page.evaluate(()=>renderCount),count+1);assert.equal((await page.evaluate(()=>measure())).rms,0);
 // Render errors leave the last complete WAV usable.
 const old=await page.evaluate(()=>{window.failRender=true;settings={manual:true,voice:100,backing:100};preview.update();return previewAudio.src;});
 await settled();assert.equal(await page.evaluate(()=>previewAudio.src),old);assert.deepEqual(await page.evaluate(()=>previewErrors),['Expected render failure']);
 // Switching to a raw file while a render is in flight must not replace or start it.
 await page.evaluate(()=>{window.blockRender=true;preview.update();});await page.waitForFunction(()=>!!window.releaseRender);
 await page.evaluate(()=>{preview.clear();previewAudio.src=initialURL;previewAudio.currentTime=2;releaseRender();});
 await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>previewAudio.src),initial.src);assert.equal(await page.evaluate(()=>previewAudio.paused),true);
 await page.evaluate(()=>preview.dispose());assert.deepEqual(errors,[]);
 console.log(JSON.stringify({completeWavPlayback:true,noRealtimeAudioContext:true,zeroAnd200:true,positionAndPausePreserved:true,originalRanges:true,latestWins:true,coalesced:true,cancelledRenderDiscarded:true,renderErrorRetainsAudio:true,errors}));
}finally{await browser?.close();server.kill();}
