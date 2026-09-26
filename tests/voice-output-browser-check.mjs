import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const root=path.resolve(import.meta.dirname,'..'),port=process.env.PORT||'4393',site=`http://localhost:${port}`;
const rate=48000,wav=Buffer.alloc(44+rate*3*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<rate*3;i++)wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/rate)*10000),44+i*2);
const fixture=path.join(root,'.runtime',`monitor-${process.pid}.wav`);await writeFile(fixture,wav);await mkdir(path.join(root,'test-results'),{recursive:true});
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:port},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser;
try{
 await new Promise((ok,no)=>{server.stdout.once('data',ok);server.stderr.once('data',b=>no(Error(b.toString())));server.once('error',no);});
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${fixture}`]});
 const context=await browser.newContext({viewport:{width:1440,height:1100}});
 await context.addInitScript(()=>{
  const enumerate=navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
  navigator.mediaDevices.enumerateDevices=async()=>[...await enumerate(),...['speaker-a','speaker-b','denied','gone','slow'].map(id=>({kind:'audiooutput',deviceId:id,label:id}))];
  const getMic=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.micCalls=0;
  navigator.mediaDevices.getUserMedia=async constraints=>{window.micCalls++;window.fixtureMic=await getMic(constraints);return window.fixtureMic;};
  const sink=AudioContext.prototype.setSinkId;window.sinkCalls=[];
  AudioContext.prototype.setSinkId=async function(id){
   window.sinkCalls.push(id);
   if(id==='denied')throw new DOMException('Fixture permission denied','NotAllowedError');
   if(id==='gone')throw new DOMException('Fixture missing device','NotFoundError');
   if(id==='slow')await new Promise(r=>setTimeout(r,250));
   return sink.call(this,'');
  };
 });
 const instrument=()=>{
  const NativeContext=window.AudioContext;window.outputContexts=[];
  const NativeWorklet=window.AudioWorkletNode;
  window.AudioWorkletNode=new Proxy(NativeWorklet,{construct(Target,args){const node=new Target(...args);if(args[0].fixtureWorklets)args[0].fixtureWorklets.push(node);return node;}});
  window.AudioContext=new Proxy(NativeContext,{construct(Target,args){
   const context=new Target(...args);
   if(args[0]?.latencyHint==='interactive'&&!args[0]?.sinkId){
    context.fixtureSources=[];context.fixtureGains=[];context.fixtureWorklets=[];window.outputContexts.push(context);
    const source=context.createMediaStreamSource.bind(context),gain=context.createGain.bind(context);
    context.createMediaStreamSource=stream=>{const node=source(stream);context.fixtureSources.push(node);return node;};
    context.createGain=()=>{const node=gain();context.fixtureGains.push(node);return node;};
   }
   return context;
  }});
 };
 await context.addInitScript(instrument);
 await context.addInitScript(()=>{
  const originalFetch=window.fetch.bind(window);window.nativeStreams=0;window.nativeActive=0;window.nativeSpeakerSupport=false;window.nativeMonitorHistory=[];window.nativeMonitorState={state:'off',sequence:-1};
  window.fetch=async(input,init={})=>{
   const url=typeof input==='string'?input:input.url;
   if(url==='http://127.0.0.1:4274/session')return Response.json({token:'synthetic',features:['native-microphone',...(window.nativeSpeakerSupport?['native-speaker-output']:[])]});
   if(url==='http://127.0.0.1:4274/microphone/devices')return Response.json({devices:[]});
   if(url==='http://127.0.0.1:4274/microphone/outputs')return Response.json({devices:['native-a','native-b','native-slow','native-gone'].map(id=>({kind:'audiooutput',deviceId:id,label:id}))});
   if(url==='http://127.0.0.1:4274/microphone/monitor'){
    const value=JSON.parse(init.body);window.nativeMonitorHistory.push(value);
    if(value.captureId!==window.nativeCaptureId||!window.nativeActive)return Response.json({error:'capture stopped'},{status:409});
    if(value.action==='keepalive')return Response.json(window.nativeMonitorState);
    if(value.sequence<=window.nativeMonitorState.sequence)return Response.json({error:'superseded'},{status:409});
    window.nativeMonitorState={state:value.enabled?'starting':'off',sequence:value.sequence,volume:value.volume,deviceId:value.deviceId};
    if(value.enabled&&value.deviceId==='native-slow')await new Promise(r=>setTimeout(r,250));
    if(value.sequence!==window.nativeMonitorState.sequence)return Response.json({error:'superseded'},{status:409});
    if(value.enabled&&value.deviceId==='native-gone'){
     window.nativeMonitorState.state='error';return Response.json({error:'speaker unplugged'},{status:409});
    }
    window.nativeMonitorState.state=value.enabled?'running':'off';
    return Response.json(window.nativeMonitorState);
   }
   if(url==='http://127.0.0.1:4274/microphone/stream'){
    window.nativeStreams++;window.nativeActive++;window.nativeCaptureId='capture-'+window.nativeStreams;window.nativeMonitorState={state:'off',sequence:-1};let timer,closed=false,offset=0;
    const finish=()=>{if(closed)return;closed=true;clearInterval(timer);window.nativeActive--;window.nativeMonitorState.state='off';};
    return new Response(new ReadableStream({start(controller){
     controller.enqueue(new TextEncoder().encode(JSON.stringify({sampleRate:48000,channels:1,label:'Synthetic native PCM',captureId:window.nativeCaptureId})+'\n'));
     timer=setInterval(()=>{if(closed)return;const pcm=Float32Array.from({length:960},()=>.2*Math.sin(2*Math.PI*440*offset++/48000));controller.enqueue(new Uint8Array(pcm.buffer));},20);
     init.signal?.addEventListener('abort',()=>{finish();controller.error(new DOMException('aborted','AbortError'));},{once:true});
    },cancel(){finish();}}));
   }
   return originalFetch(input,init);
  };
 });

 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{
  const u=new URL(r.request().url());
  return u.origin===site?r.continue():r.abort();
 });
 const $=id=>page.locator('#'+id);
 const playing=()=>page.waitForFunction(()=>document.querySelector('#voice-output-status').textContent.startsWith('低延遲歌聲輸出中')&&outputContexts.some(c=>c.state==='running'&&(c.fixtureSources.length||c.fixtureWorklets.length)&&c.fixtureGains.length));
 const stopped=async()=>{assert.equal(await $('voice-output-enabled').isChecked(),false);await page.waitForFunction(()=>outputContexts.every(c=>c.state==='closed'));};
 await page.goto(site);
 assert.ok(await $('voice-output-enabled').isDisabled());await stopped();
 await $('mic-start').click();await page.waitForFunction(()=>document.querySelector('#note').textContent==='A4');
 assert.ok(await $('voice-output-enabled').isEnabled());await stopped();
 await $('voice-output-device').selectOption('speaker-a');await $('voice-output-enabled').check();await playing();
 assert.equal(await page.evaluate(()=>outputContexts.at(-1).fixtureSources[0].mediaStream===window.fixtureMic),true);
 assert.ok(Math.abs(await page.evaluate(()=>outputContexts.at(-1).fixtureGains[0].gain.value)-.3)<.001);
 await $('voice-output-volume').fill('65');await page.waitForFunction(()=>Math.abs(outputContexts.at(-1).fixtureGains[0].gain.value-.65)<.001);
 assert.equal(await $('voice-output-volume-value').textContent(),'65%');
 const monitorRms=await page.evaluate(async()=>{
  const c=outputContexts.at(-1),analyser=c.createAnalyser();c.fixtureGains[0].connect(analyser);analyser.fftSize=2048;
  await new Promise(r=>setTimeout(r,80));const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);c.fixtureGains[0].disconnect(analyser);
  return Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);
 });assert.ok(monitorRms>.05&&monitorRms<.2,monitorRms);

 await $('voice-output-device').selectOption('speaker-b');await page.waitForFunction(()=>document.querySelector('#voice-output-status').textContent.includes('speaker-b'));await playing();
 await $('voice-output-enabled').uncheck();await stopped();
 assert.equal(await page.evaluate(()=>fixtureMic.getAudioTracks()[0].readyState),'live');assert.equal(await page.evaluate(()=>micCalls),1);assert.ok(await $('mic-stop').isEnabled());
 await $('voice-output-enabled').check();await playing();
 await $('voice-output-device').selectOption('denied');await page.waitForFunction(()=>!document.querySelector('#voice-output-enabled').checked);await stopped();assert.match(await $('voice-output-status').textContent(),/未獲允許/);assert.ok(await $('mic-stop').isEnabled());
 await $('voice-output-device').selectOption('gone');await $('voice-output-enabled').click();await page.waitForFunction(()=>!document.querySelector('#voice-output-enabled').checked);assert.match(await $('voice-output-status').textContent(),/找不到/);
 await $('voice-output-device').selectOption('slow');await $('voice-output-enabled').check();await $('mic-stop').click();await page.waitForTimeout(350);await stopped();assert.ok(await $('voice-output-enabled').isDisabled());
 assert.equal(await page.evaluate(()=>fixtureMic.getAudioTracks()[0].readyState),'ended');
 await $('mic-start').click();await page.waitForFunction(()=>document.querySelector('#note').textContent==='A4');await stopped();
 await $('voice-output-device').selectOption('speaker-a');await $('voice-output-enabled').check();await playing();
 await page.locator('#voice-section').screenshot({path:'test-results/ui-v20-voice-output.png'});
 await page.evaluate(()=>navigator.mediaDevices.dispatchEvent(new Event('devicechange')));await page.waitForFunction(()=>document.querySelector('#mic-stop').disabled);await stopped();
 // Exercise the actual native PCM parser and worklets; monitoring bypasses the recording MediaStream.
 await $('voice-settings').locator('summary').first().click();await $('capture-mode').selectOption('native');
 const callsBefore=await page.evaluate(()=>micCalls);
 await $('mic-start').click();await page.waitForFunction(()=>document.querySelector('#note').textContent==='A4');await $('voice-output-enabled').check();await playing();
 assert.equal(await page.evaluate(()=>outputContexts.at(-1).fixtureSources.length),0);
 assert.equal(await page.evaluate(()=>outputContexts.at(-1).fixtureWorklets.length),1);
 assert.equal(await page.evaluate(()=>micCalls),callsBefore);assert.equal(await page.evaluate(()=>nativeStreams),1);
 const nativeRms=await page.evaluate(async()=>{
  const c=outputContexts.at(-1),a=c.createAnalyser();a.fftSize=2048;c.fixtureGains[0].connect(a);await new Promise(r=>setTimeout(r,180));
  const data=new Float32Array(2048);a.getFloatTimeDomainData(data);c.fixtureGains[0].disconnect(a);return Math.sqrt(data.reduce((v,x)=>v+x*x,0)/data.length);
 });assert.ok(nativeRms>.02&&nativeRms<.2,nativeRms);
 await $('voice-output-volume').fill('0');await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>nativeActive),1);assert.equal(await $('note').textContent(),'A4');
 await $('voice-output-enabled').uncheck();await stopped();
 assert.equal(await page.evaluate(()=>nativeActive),1);assert.equal(await $('note').textContent(),'A4');
 await $('voice-output-enabled').check();await playing();assert.equal(await page.evaluate(()=>nativeStreams),1);

 // New helper: native speaker output never creates a browser playback AudioContext.
 await $('mic-stop').click();await stopped();
 await page.evaluate(()=>{window.nativeSpeakerSupport=true;});
 await $('mic-start').click();await page.waitForFunction(()=>document.querySelector('#note').textContent==='A4');
 await page.waitForFunction(()=>[...document.querySelector('#voice-output-device').options].some(o=>o.value==='native-a'));
 const contextsBefore=await page.evaluate(()=>outputContexts.length),streamsBefore=await page.evaluate(()=>nativeStreams);
 const nativePlaying=()=>page.waitForFunction(()=>document.querySelector('#voice-output-status').textContent.startsWith('本機歌聲直送喇叭中')&&nativeMonitorState.state==='running');
 await $('voice-output-device').selectOption('native-a');await $('voice-output-enabled').check();await nativePlaying();
 assert.equal(await page.evaluate(()=>outputContexts.length),contextsBefore);
 assert.equal(await page.evaluate(()=>nativeStreams),streamsBefore);
 assert.equal(await page.evaluate(()=>nativeMonitorState.deviceId),'native-a');
 await $('voice-output-volume').fill('45');await page.waitForFunction(()=>nativeMonitorState.volume===.45);
 assert.equal(await $('note').textContent(),'A4');assert.equal(await page.evaluate(()=>nativeActive),1);
 await $('voice-output-device').selectOption('native-b');await nativePlaying();
 assert.equal(await page.evaluate(()=>nativeMonitorState.deviceId),'native-b');
 await $('voice-output-enabled').uncheck();await page.waitForFunction(()=>nativeMonitorState.state==='off');
 assert.equal(await $('note').textContent(),'A4');assert.equal(await page.evaluate(()=>nativeActive),1);
 // Late start, output-device failure, and midstream speaker failure leave recording capture live.
 await $('voice-output-device').selectOption('native-slow');await $('voice-output-enabled').check();await $('voice-output-enabled').uncheck();
 await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>nativeMonitorState.state),'off');
 await $('voice-output-device').selectOption('native-gone');await $('voice-output-enabled').check();
 await page.waitForFunction(()=>!document.querySelector('#voice-output-enabled').checked);assert.equal(await page.evaluate(()=>nativeActive),1);
 await $('voice-output-device').selectOption('native-a');await $('voice-output-enabled').check();await nativePlaying();
 await page.evaluate(()=>{nativeMonitorState.state='error';nativeMonitorState.error='fixture runtime disconnect';});
 await page.waitForFunction(()=>!document.querySelector('#voice-output-enabled').checked);
 assert.equal(await $('note').textContent(),'A4');assert.equal(await page.evaluate(()=>nativeActive),1);
 await $('voice-output-enabled').check();await nativePlaying();
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await stopped();assert.ok(await $('voice-output-enabled').isDisabled());
 assert.equal(await page.evaluate(()=>nativeActive),0);
 await page.reload();assert.ok(await $('voice-output-enabled').isDisabled());await stopped();
 assert.deepEqual(errors,[]);
 // A browser without output-device selection still provides default-speaker monitoring.
 const fallback=await browser.newContext();await fallback.addInitScript(instrument);await fallback.addInitScript(()=>{delete AudioContext.prototype.setSinkId;});
 const fp=await fallback.newPage();await fp.route('**/*',r=>new URL(r.request().url()).origin===site?r.continue():r.abort());await fp.goto(site);
 assert.ok(await fp.locator('#voice-output-device').isDisabled());
 await fp.locator('#mic-start').click();await fp.waitForFunction(()=>document.querySelector('#note').textContent==='A4');await fp.locator('#voice-output-enabled').check();await fp.waitForFunction(()=>outputContexts.some(c=>c.state==='running'&&c.fixtureSources.length));
 await fp.locator('#mic-stop').click();await fp.waitForFunction(()=>outputContexts.every(c=>c.state==='closed'));
 console.log('PASS: opt-in output, direct low-latency Web Audio graph with synthetic stream, volume isolated, simulated speaker routing/errors, stale-start cancellation, stop/restart/device-change/pagehide/reload cleanup, native PCM/worklet fallback plus direct helper speaker routing, independent volume, stale-start/stop/unplug/heartbeat protections, default-speaker fallback; no real microphone or audible test output.');
}finally{await browser?.close();server.kill();await rm(fixture,{force:true});}
