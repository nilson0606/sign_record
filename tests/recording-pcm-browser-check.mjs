import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const server=http.createServer(async(req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>PCM recording test</title>');return;}
 if(!['/recording-pcm.mjs','/recording-pcm-worklet.mjs'].includes(req.url)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('..'+req.url,import.meta.url)));
});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true,args:['--mute-audio']});
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 for(const rate of [48000,44100]){
  const result=await page.evaluate(async rate=>{
   const {createPCMRecorders}=await import('/recording-pcm.mjs');
   const context=new AudioContext({sampleRate:rate,sinkId:{type:'none'}});await context.resume();
   const mic=context.createOscillator(),mixed=context.createGain();mic.frequency.value=437;mic.connect(mixed);mic.start();
   const {recorder,rawRecorder}=await createPCMRecorders(context,mic,mixed),voice=[],mix=[],errors=[];
   recorder.ondataavailable=e=>mix.push(e.data);rawRecorder.ondataavailable=e=>voice.push(e.data);recorder.onerror=e=>errors.push(e.error.message);
   const wait=ms=>new Promise(r=>setTimeout(r,ms)),stall=ms=>{const until=performance.now()+ms;while(performance.now()<until){}};
   const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
   await wait(7000);stall(400);await wait(7000);recorder.pause();await wait(450);recorder.resume();
   await wait(7000);stall(180);await wait(7000);recorder.stop();await done;
   voice[0]=recorder.voiceHeader();mix[0]=recorder.header();
   const a=await context.decodeAudioData(await new Blob(voice).arrayBuffer()),b=await context.decodeAudioData(await new Blob(mix).arrayBuffer());
   let mismatches=0;const x=a.getChannelData(0),y=b.getChannelData(0);for(let i=0;i<x.length;i++)if(x[i]!==y[i])mismatches++;
   const result={rate,recordedFrames:recorder.frames,expectedFrames:recorder.clock.frames(context.currentTime),voiceFrames:a.length,mixFrames:b.length,mismatches,errors,seconds:a.duration};
   mic.stop();recorder.dispose();await context.close();return result;
  },rate);
  assert.deepEqual(result.errors,[]);assert.equal(result.recordedFrames,result.expectedFrames);assert.equal(result.voiceFrames,result.recordedFrames);assert.equal(result.mixFrames,result.voiceFrames);assert.equal(result.mismatches,0);assert.ok(result.seconds>28&&result.seconds<30);
  console.log(JSON.stringify(result));
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
