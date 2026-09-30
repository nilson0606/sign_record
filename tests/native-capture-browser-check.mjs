// Real Worker -> MessagePort -> AudioWorklet -> PCM recording. No physical mic.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import {assets} from '../build-site.mjs';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const clients=new Set();let base,stalled=false;
const server=http.createServer(async(req,res)=>{
 if(req.url==='/session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({token:'fixture',features:['native-microphone']}));return;}
 if(req.url==='/microphone/stream'){
  res.setHeader('Content-Type','application/octet-stream');res.write(JSON.stringify({sampleRate:48000,channels:1,label:'Synthetic capture'})+'\n');
  const started=performance.now();let frames=0;
  const timer=setInterval(()=>{
   if(stalled)return;
   const due=Math.floor((performance.now()-started)/20)*960;
   while(frames+960<=due){const pcm=Float32Array.from({length:960},(_,i)=>.2+.1*Math.sin(2*Math.PI*220*(frames+i)/48000));frames+=960;res.write(Buffer.from(pcm.buffer));}
  },4);
  clients.add(res);res.once('close',()=>{clearInterval(timer);clients.delete(res);});return;
 }
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<title>Native capture continuity</title>');return;}
 if(req.url==='/stall'){stalled=true;res.end('ok');return;}
 if(req.url==='/recorder'){res.setHeader('Content-Type','text/html');res.end((await readFile(new URL('../index.html',import.meta.url),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));return;}
 if(!assets.map(x=>'/'+x).includes(req.url)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end((await readFile(new URL('..'+req.url,import.meta.url),'utf8')).replaceAll('http://127.0.0.1:4274',base));
});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true,args:['--mute-audio']});const page=await browser.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='log')console.log(m.text());});await page.goto(base);
 const result=await Promise.race([page.evaluate(async()=>{
  const {openNativeMicrophone}=await import('/native-microphone.mjs'),{createPCMRecorders}=await import('/recording-pcm.mjs');
  const context=new AudioContext({sampleRate:48000,sinkId:{type:'none'}});await context.resume();const controller=new AbortController(),errors=[];
  const capture=await openNativeMicrophone(context,{signal:controller.signal,onError:e=>{errors.push(e.message);console.log('capture error',e.message);}});console.log('capture ready');
  const mixed=context.createGain();capture.source.connect(mixed);
  const {recorder,rawRecorder}=await createPCMRecorders(context,capture.source,mixed),voice=[],mix=[];
  rawRecorder.ondataavailable=e=>voice.push(e.data);recorder.ondataavailable=e=>mix.push(e.data);recorder.onerror=e=>errors.push(e.error.message);
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),stall=ms=>{const until=performance.now()+ms;while(performance.now()<until){}};
  recorder.start();console.log('recording started');await wait(10000);stall(180);await wait(10000);stall(400);await wait(10000);console.log('recording stopping');
  const done=new Promise(r=>recorder.onstop=r);recorder.stop();await done;voice[0]=recorder.voiceHeader();mix[0]=recorder.header();
  const a=await context.decodeAudioData(await new Blob(voice).arrayBuffer()),b=await context.decodeAudioData(await new Blob(mix).arrayBuffer()),x=a.getChannelData(0),y=b.getChannelData(0);
  let zeros=0,mismatches=0,maxJump=0;for(let i=48000;i<x.length-48000;i++){if(x[i]===0)zeros++;if(x[i]!==y[i])mismatches++;maxJump=Math.max(maxJump,Math.abs(x[i]-x[i-1]));}
  const result={seconds:a.duration,frames:recorder.frames,voiceFrames:a.length,mixFrames:b.length,zeros,mismatches,maxJump,errors};capture.stop();controller.abort();await context.close();return result;
 }),new Promise((_r,reject)=>{const timer=setTimeout(()=>reject(Error('Native capture check timed out')),65000);timer.unref();})]);
 assert.deepEqual(pageErrors,[]);assert.deepEqual(result.errors,[]);assert.equal(result.zeros,0);assert.equal(result.mismatches,0);assert.equal(result.voiceFrames,result.frames);assert.equal(result.mixFrames,result.frames);assert.ok(result.maxJump<.004,JSON.stringify(result));
 await new Promise(r=>setTimeout(r,200));assert.equal(clients.size,0,'capture Worker termination must release the HTTP microphone stream');console.log(JSON.stringify(result));
 // Exercise the production recorder and IndexedDB, including early capture
 // teardown and a real underrun. The ephemeral helper cannot touch user audio.
 await page.goto(base+'/recorder');
 const saves=await page.evaluate(async()=>{
  const {openNativeMicrophone}=await import('/native-microphone.mjs'),{createSingerRecorder}=await import('/recording.mjs'),{BrowserRecordingStore}=await import('/recording-store.mjs');
  const context=new AudioContext({sampleRate:48000,sinkId:{type:'none'}});await context.resume();
  const ref={version:1,title:'Synthetic native save',videoId:'M7lc1UVf-VE',step:.1,duration:30,frames:Array(300).fill(220),hasPreview:false};
  let capture,ended,started=0;const errors=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
  const player={getPlayerState:()=>1,getCurrentTime:()=>(performance.now()-started)/1000};
  document.querySelector('#recording-mode').value='voice';
  const recorder=createSingerRecorder({reference:()=>ref,context:()=>context,stream:()=>capture.stream,inputSource:()=>capture.source,player:()=>player,pausePlayer:()=>{},voiced:()=>true});
  const store=new BrowserRecordingStore();
  async function start(){capture=await openNativeMicrophone(context,{signal:new AbortController().signal,onError:error=>{errors.push(error.message);ended=recorder.stop(error);capture.stop();}});await recorder.prepare(ref,()=>{throw Error('Unexpected backing');});started=performance.now();recorder.playerState(1,0);}
  await start();await wait(1600);ended=recorder.stop();capture.stop();await ended;
  const first=(await store.list())[0];
  await start();await wait(1600);if(errors.length)throw Error('Capture failed before injected stall: '+errors.join('; '));await fetch('/stall');
  for(let i=0;i<100&&!errors.length;i++)await wait(50);
  if(!errors.length)throw Error('Underrun did not stop recording');await ended;
  const partial=(await store.list()).find(r=>r.id!==first.id);
  const raw=await context.decodeAudioData(await(await store.blob(partial,'voice')).arrayBuffer()),mixed=await context.decodeAudioData(await(await store.blob(partial)).arrayBuffer());
  const result={first:{complete:first.complete,input:first.captureClock.input,delay:first.appliedDelayMs,seconds:first.seconds},partial:{complete:partial.complete,error:partial.captureError,frames:partial.captureClock.frames,voiceFrames:raw.length,mixFrames:mixed.length},errors,rescue:!!document.querySelector('#recording-rescue a')};
  await context.close();return result;
 });
 console.log(JSON.stringify(saves));
 assert.equal(saves.first.complete,true);assert.equal(saves.first.input,'native-worklet-v2');assert.equal(saves.first.delay,200);assert.ok(saves.first.seconds>1);
 assert.equal(saves.partial.complete,false);assert.match(saves.partial.error,/收音資料中斷/);assert.equal(saves.errors.length,1);assert.ok(saves.rescue);
 assert.ok(saves.partial.frames>48000);assert.equal(saves.partial.frames,saves.partial.voiceFrames);assert.equal(saves.partial.frames,saves.partial.mixFrames);assert.deepEqual(pageErrors,[]);
}finally{await browser?.close();for(const client of clients)client.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));}
