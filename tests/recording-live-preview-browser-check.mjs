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
  const {createLiveRecordingPreview}=await import('/recording-live-preview.mjs');
  const {remixRecording,wavBlob}=await import('/recording-process.mjs');
  const connect=AudioNode.prototype.connect;
  // Observe the actual output, including any accidental baked-mix passthrough.
  AudioNode.prototype.connect=function(destination,...args){
   if(destination===this.context.destination&&this.context instanceof AudioContext){
    if(!this.context.probe){const probe=this.context.createAnalyser();probe.fftSize=8192;this.context.probe=probe;connect.call(probe,destination);window.probe=probe;}
    return connect.call(this,this.context.probe,...args);
   }
   return connect.call(this,destination,...args);
  };
  const rate=48000,duration=24;
  const tone=hz=>{const b=new AudioBuffer({numberOfChannels:1,length:rate*duration,sampleRate:rate}),x=b.getChannelData(0);for(let i=0;i<x.length;i++)x[i]=.06*Math.sin(2*Math.PI*hz*i/rate);return b;};
  const raw=tone(440),backing=tone(660),original=tone(880);
  window.settings={manual:true,voice:100,backing:100};
  const meta={mode:'mix',seconds:duration,balance:settings,stems:['accompaniment','vocals'],postEdit:{version:1,start:0,end:duration,fadeIn:0,fadeOut:0},post:{reference:{duration},segments:[{offset:0,songTime:0,duration}],samples:Array.from({length:240},(_,i)=>({offset:i/10,hz:440})),originalVocals:{stem:'vocals',ranges:[{start:12,end:16,mode:'original'}]}}};
  window.previewAudio=document.createElement('audio');previewAudio.controls=true;document.body.append(previewAudio);
  const rendered=await remixRecording(raw,[backing,original],meta,300);
  window.preview=createLiveRecordingPreview(previewAudio,{settings:()=>settings,onError:e=>{throw e;}});
  preview.set({raw,tracks:[backing,original],meta,ms:300});
  previewAudio.src=URL.createObjectURL(wavBlob(rendered));await previewAudio.play();
  window.measure=()=>{const x=new Float32Array(probe.fftSize);probe.getFloatTimeDomainData(x);const power=hz=>{let re=0,im=0;for(let i=0;i<x.length;i++){re+=x[i]*Math.cos(2*Math.PI*hz*i/probe.context.sampleRate);im+=x[i]*Math.sin(2*Math.PI*hz*i/probe.context.sampleRate);}return 2*Math.hypot(re,im)/x.length;};return{voice:power(440),backing:power(660),original:power(880),rms:Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length),time:previewAudio.currentTime,paused:previewAudio.paused,src:previewAudio.src};};
 });
 await page.waitForTimeout(1200);const initial=await page.evaluate(()=>measure());
 assert.ok(initial.voice>.04&&initial.backing>.04,JSON.stringify(initial));
 await page.evaluate(()=>{settings={manual:true,voice:0,backing:200};preview.update();});
 await page.waitForTimeout(1600);const backingOnly=await page.evaluate(()=>measure());
 assert.equal(backingOnly.src,initial.src);assert.equal(backingOnly.paused,false);assert.ok(backingOnly.time>initial.time+1,JSON.stringify({initial,backingOnly}));
 assert.ok(backingOnly.backing>initial.backing*1.8&&backingOnly.voice<.002,JSON.stringify(backingOnly));
 await page.evaluate(()=>{settings={manual:true,voice:200,backing:0};preview.update();});
 await page.waitForTimeout(1600);const voiceOnly=await page.evaluate(()=>measure());
 assert.ok(voiceOnly.voice>initial.voice*1.8&&voiceOnly.backing<.002,JSON.stringify(voiceOnly));
 await page.evaluate(()=>previewAudio.pause());await page.waitForTimeout(250);assert.ok((await page.evaluate(()=>measure())).rms<.00001);
 await page.evaluate(async()=>{settings={manual:true,voice:100,backing:100};previewAudio.currentTime=13;await previewAudio.play();});
 await page.waitForTimeout(800);const originalOnly=await page.evaluate(()=>measure());
 assert.ok(originalOnly.original>.04&&originalOnly.backing>.04&&originalOnly.voice<.002,JSON.stringify(originalOnly));
 await page.evaluate(()=>previewAudio.currentTime=18);await page.waitForTimeout(800);const afterRange=await page.evaluate(()=>measure());
 assert.ok(afterRange.voice>.04&&afterRange.original<.002,JSON.stringify(afterRange));
 await page.evaluate(()=>previewAudio.muted=true);await page.waitForTimeout(250);assert.ok((await page.evaluate(()=>measure())).rms<.00001);
 await page.evaluate(()=>{previewAudio.muted=false;settings={manual:true,voice:0,backing:0};preview.update();});
 await page.waitForTimeout(1800);assert.ok((await page.evaluate(()=>measure())).rms<.001);
 // A pure-voice/raw-file selection after a live mix must regain normal media output.
 await page.evaluate(async()=>{previewAudio.pause();preview.clear();previewAudio.currentTime=2;await previewAudio.play();});
 await page.waitForTimeout(600);assert.ok((await page.evaluate(()=>measure())).rms>.02);
 await page.evaluate(()=>{previewAudio.pause();preview.dispose();});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({liveIndependentGains:true,zeroAnd200:true,continuousPosition:true,pauseSeekResume:true,originalRanges:true,mediaMute:true,passthroughRestored:true,errors}));
}finally{await browser?.close();server.kill();}
