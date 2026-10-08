// Opt-in: opens a physical microphone through the real local helper. No audio is saved.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import http from 'node:http';
import {assets} from '../build-site.mjs';
const {chromium}=createRequire('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const seconds=Number(process.env.CAPTURE_SECONDS||240),deviceLabel=process.env.CAPTURE_DEVICE||'Realtek';
assert.ok(Number.isFinite(seconds)&&seconds>=10&&seconds<=600);
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
const server=http.createServer(async(req,res)=>{
 const file=new URL(req.url,'http://localhost').pathname.slice(1);
 if(!file){res.setHeader('Content-Type','text/html');res.end('<title>Physical microphone continuity test</title>');return;}
 if(!assets.includes(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('../'+file,import.meta.url),'utf8'));
});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4273,'127.0.0.1',resolve);});
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('console',msg=>{if(msg.type()==='log')console.log(msg.text());});
 await page.goto('http://127.0.0.1:4273/');
 const result=await page.evaluate(async({seconds,deviceLabel})=>{
  const {openNativeMicrophone,nativeInputDevices}=await import('/native-microphone.mjs');
  const {createPCMRecorders}=await import('/recording-pcm.mjs');
  const {createKeyPlayback}=await import('/key-playback.mjs');
  const {detectPitch}=await import('/audio.mjs');
  const devices=await nativeInputDevices(),device=devices.find(d=>d.label.includes(deviceLabel));
  if(!device)throw Error('Selected test device not found');
  const context=new AudioContext({sampleRate:48000});await context.resume();
  const controller=new AbortController(),errors=[];
  let capture,key,recorder,timer,finished=false,voiceBytes=0,mixBytes=0;
  const started=performance.now();
  try{
   capture=await openNativeMicrophone(context,{deviceId:device.deviceId,signal:controller.signal,onError:e=>errors.push(e.message)});
   const mixed=context.createGain();capture.source.connect(mixed);
   const pair=await createPCMRecorders(context,capture.source,mixed);recorder=pair.recorder;
   pair.rawRecorder.ondataavailable=e=>{voiceBytes+=e.data.size;};recorder.ondataavailable=e=>{mixBytes+=e.data.size;};recorder.onerror=e=>errors.push(e.error.message);
   // Two local guide tracks exercise the production Key playback controller.
   const samples=48000*(seconds+10),wav=new ArrayBuffer(44+samples*2),v=new DataView(wav);
   const text=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
   text(0,'RIFF');v.setUint32(4,wav.byteLength-8,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples*2,true);
   for(let i=0;i<samples;i++)v.setInt16(44+i*2,Math.round(500*Math.sin(2*Math.PI*220*i/48000)),true);
   let playing=false,startTime=0,muted=false;
   const player={pauseVideo(){playing=false;},mute(){muted=true;},unMute(){muted=false;},isMuted:()=>muted,getPlayerState:()=>playing?1:2,getCurrentTime:()=>playing?(performance.now()-startTime)/1000:0,getPlaybackRate:()=>1,getVolume:()=>50};
   key=createKeyPlayback({player:()=>player,loadStem:async()=>wav.slice(0),mode:()=> 'original',status:()=>{}});
   await key.load({pitchShift:8,duration:seconds+5,vocalMode:'all'});
   const analyser=context.createAnalyser();analyser.fftSize=4096;capture.source.connect(analyser);const data=new Float32Array(4096);
   playing=true;startTime=performance.now();recorder.start();key.sync();
   timer=setInterval(()=>{key.sync();analyser.getFloatTimeDomainData(data);detectPitch(data,48000);},40);
   console.log(JSON.stringify({started:true,device:device.label,captureId:capture.source.nativeCaptureId,seconds}));
   for(let i=0;i<seconds;i++){
    await new Promise(r=>setTimeout(r,1000));
    if(errors.length)throw Error(errors.join('; '));
    if(i>0&&i%30===0)console.log(JSON.stringify({capturedSeconds:Math.round(recorder.frames/48000)}));
    if(i>0&&i%20===0){const until=performance.now()+180;while(performance.now()<until){}}
   }
   const done=new Promise(r=>recorder.onstop=r);recorder.stop();await done;finished=true;
   if(errors.length)throw Error(errors.join('; '));
   return {device:device.label,captureId:capture.source.nativeCaptureId,seconds:recorder.frames/48000,voiceBytes,mixBytes,elapsed:(performance.now()-started)/1000,errors};
  }finally{
   clearInterval(timer);if(recorder&&!finished)recorder.dispose();key?.clear();capture?.stop();controller.abort();await context.close();
  }
 },{seconds,deviceLabel});
 assert.deepEqual(errors,[]);assert.deepEqual(result.errors,[]);assert.ok(result.seconds>=seconds-.5);assert.equal(result.voiceBytes,44+Math.round(result.seconds*48000)*2);assert.equal(result.mixBytes,44+Math.round(result.seconds*48000)*4);console.log(JSON.stringify(result));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
