import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const port='4399',server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:port},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser;
try{
 await new Promise((ok,no)=>{server.stdout.once('data',ok);server.stderr.once('data',x=>no(Error(x.toString())));server.once('error',no);});
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.goto('http://localhost:'+port);
 await page.evaluate(async()=>{
  const {createRecordingAudition}=await import('/recording-audition.mjs');
  window.AudioContext=class {constructor(){throw Error('Unexpected playback AudioContext');}};
  const NativeAudio=window.Audio;window.Audio=function(){window.abPlayer=new NativeAudio();return abPlayer;};
  const rate=48000,length=rate*8;
  const tone=level=>{const b=new AudioBuffer({numberOfChannels:1,length,sampleRate:rate}),x=b.getChannelData(0);for(let i=0;i<length;i++)x[i]=level*Math.sin(2*Math.PI*440*i/rate);return b;};
  window.draft={volume:{voice:100,backing:100},effects:{reverb:0},delayMs:0};
  const row={complete:true,rawBytes:1,seconds:8,mode:'mix',post:{segments:[{offset:0,songTime:0,duration:8}]}};
  window.audition=createRecordingAudition({read:()=>draft,defaults:()=>draft,apply:value=>window.draft=value,beforePlay:()=>{},run:fn=>fn(row),render:async(selected,settings)=>{if(window.blockRender){window.blockRender=false;await new Promise(resolve=>window.releaseRender=()=>{window.releaseRender=null;resolve();});}return tone(.06*settings.volume.voice/100);}});
  audition.reset(row);
  document.getElementById('post-effects-panel').open=true;document.getElementById('post-audition-panel').open=true;
  document.getElementById('post-audition-match').checked=true;
  window.measureAB=async()=>{const b=await new OfflineAudioContext(1,1,rate).decodeAudioData(await(await fetch(abPlayer.src)).arrayBuffer()),x=b.getChannelData(0);return {rms:Math.sqrt(x.reduce((sum,v)=>sum+v*v,0)/x.length),duration:b.duration,position:audition.position(),paused:abPlayer.paused,loop:abPlayer.loop};};
 });
 const $=id=>page.locator('#post-audition-'+id);
 await $('a-play').click();await page.waitForFunction(()=>!abPlayer.paused&&abPlayer.readyState>=2);
 const a=await page.evaluate(()=>measureAB());assert.ok(a.rms>.04);assert.equal(a.duration,8);assert.equal(a.loop,true);
 await $('b-edit').click();await page.evaluate(()=>draft.volume.voice=200);await $('b-play').click();await page.waitForFunction(()=>!abPlayer.paused&&abPlayer.readyState>=2);
 const b=await page.evaluate(()=>measureAB());assert.ok(Math.abs(a.rms-b.rms)<.00001,'matched volume is baked into the complete file');
 await page.evaluate(()=>abPlayer.currentTime=3);await $('a-play').click();await page.waitForFunction(()=>!abPlayer.paused&&abPlayer.readyState>=2);assert.ok((await page.evaluate(()=>measureAB())).position>=3,'A/B switching keeps the source position');
 await $('b-play').click();await $('match').uncheck();await page.waitForFunction(()=>!abPlayer.paused&&abPlayer.readyState>=2);const unmatch=await page.evaluate(()=>measureAB());assert.ok(unmatch.rms>b.rms*1.99,'unmatched file retains original loudness');
 await $('stop').click();assert.equal(await page.evaluate(()=>abPlayer.paused&&!audition.playing()),true);
 // Stopping an outstanding render must not trigger playback afterwards.
 await $('start').fill('1');await $('start').dispatchEvent('change');await page.evaluate(()=>window.blockRender=true);await $('b-play').click();await page.waitForFunction(()=>!!window.releaseRender);
 await page.evaluate(()=>{audition.stop();releaseRender();});await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>abPlayer.paused&&!audition.playing()&&!abPlayer.getAttribute('src')),true);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({nativeABPlayback:true,completeWav:true,bakedMatching:true,preservedPosition:true,cancelledRender:true,errors}));
}finally{await browser?.close();server.kill();}
