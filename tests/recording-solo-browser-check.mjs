import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const port='4395',server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:port},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser;
try{
 await new Promise((ok,no)=>{server.stdout.once('data',ok);server.stderr.once('data',x=>no(Error(x.toString())));server.once('error',no);});
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.goto('http://localhost:'+port);
 await page.evaluate(async()=>{
  const {createRecordingPost}=await import('/recording-post.mjs'),{remixRecording,wavBlob}=await import('/recording-process.mjs');
  const rate=48000,duration=4;
  const tone=hz=>{const b=new AudioBuffer({numberOfChannels:1,length:rate*duration,sampleRate:rate}),x=b.getChannelData(0);for(let i=0;i<x.length;i++)x[i]=.06*Math.sin(2*Math.PI*hz*i/rate);return b;};
  const raw=tone(440),backing=tone(660),original=tone(880),voice=wavBlob(raw);
  window.meta={id:'solo-with-original-ranges',title:'原唱區間純人聲測試',created:Date.now(),mode:'mix',seconds:3,sourceSeconds:4,rawBytes:voice.size,complete:true,stems:['accompaniment','vocals'],balance:{manual:false,voice:100,backing:100},appliedDelayMs:300,postVolume:{voice:65,backing:100},vocalEffects:{eq:{mid:3},reverb:10},postEdit:{version:1,start:.5,end:3.5,fadeIn:.1,fadeOut:.1},post:{reference:{cacheId:'fixture',duration},segments:[{offset:0,songTime:0,duration}],samples:[],originalVocals:{version:1,stem:'vocals',ranges:[{start:1,end:2,mode:'original'}]}}};
  const recipe={volume:meta.postVolume,effects:meta.vocalEffects};
  window.mix=wavBlob(await remixRecording(raw,[backing,original],meta,300,recipe));
  const savedRaw=await new OfflineAudioContext(1,1,rate).decodeAudioData(await voice.arrayBuffer());
  window.expected=wavBlob(await remixRecording(savedRaw,[],{...meta,post:{...meta.post,originalVocals:null}},300,recipe));
  window.hash=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(',');
  window.before=JSON.stringify(meta);window.rawHash=await hash(voice);window.reads=[];
  const store={blob:async(row,track='mix')=>{reads.push(track);return track==='voice'?voice:mix;}};
  window.post=createRecordingPost({store,stop:async()=>{},pause:()=>{},download:()=>{},onDelete:()=>{}});post.refresh([meta]);
 });
 await page.locator('#selected-recording-preview').click();await page.waitForFunction(()=>!document.getElementById('selected-recording-preview').disabled);
 assert.equal(await page.evaluate(()=>document.getElementById('post-audio').paused),false,'full mix plays');
 // Pending editor changes must not alter a saved vocal preview.
 await page.evaluate(()=>{document.getElementById('post-voice-level').value=0;document.getElementById('post-reverb').value=80;document.getElementById('remix-delay').value=0;window.reads=[];});
 await page.locator('#selected-recording-voice').click();await page.waitForFunction(()=>!document.getElementById('selected-recording-voice').disabled);
 const result=await page.evaluate(async()=>{
  const audio=document.getElementById('post-audio'),status=document.getElementById('post-status').textContent;
  if(!audio.getAttribute('src'))return {status,playing:false};
  const blob=await(await fetch(audio.src)).blob(),b=await new OfflineAudioContext(2,1,48000).decodeAudioData(await blob.arrayBuffer()),x=b.getChannelData(0),start=48000/4,end=start+48000;
  const power=hz=>{let re=0,im=0;for(let i=start;i<end;i++){re+=x[i]*Math.cos(2*Math.PI*hz*i/48000);im+=x[i]*Math.sin(2*Math.PI*hz*i/48000);}return 2*Math.hypot(re,im)/48000;};
  return{status,playing:!audio.paused,duration:b.duration,voice:power(440),backing:power(660),original:power(880),expected:await hash(blob)===await hash(expected),metadataUnchanged:JSON.stringify(meta)===before,reads};
 });
 assert.equal(result.playing,true,JSON.stringify(result));assert.equal(result.duration,3);assert.ok(result.voice>.01&&result.backing<.0001&&result.original<.0001,JSON.stringify(result));assert.equal(result.expected,true,'saved level, effects, delay and trim remain exact');assert.equal(result.metadataUnchanged,true);assert.deepEqual(result.reads,['voice']);assert.deepEqual(errors,[]);
 console.log(JSON.stringify(result));
}finally{await browser?.close();server.kill();}
