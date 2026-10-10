import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDiagnosticsHandler} from '../recording-diagnostics-server.mjs';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const tmp=await mkdtemp(path.join(tmpdir(),'karaoke-diagnostics-browser-')),handler=createDiagnosticsHandler(tmp);
const diag=http.createServer((req,res)=>handler(req,res));await new Promise(r=>diag.listen(0,'127.0.0.1',r));
const site='http://localhost:4398',upstream='http://127.0.0.1:'+diag.address().port;
const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'4398',KARAOKE_HELPER_PORT:String(diag.address().port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,failCreate=false,failEvents=false,holdFinish=false,releaseFinish,finishRequested=false,eventCount=0;
try{
 await new Promise((ok,no)=>{server.stdout.once('data',ok);server.stderr.once('data',x=>no(Error(x.toString())));server.once('error',no);});
 // The legacy route forwards to the same owner, not a second diagnostic store.
 const direct=await(await fetch(upstream+'/diagnostics/session',{headers:{Origin:'http://localhost:4273'}})).json();
 const legacy=await(await fetch(site+'/diagnostics/session',{headers:{Origin:'http://localhost:4273'}})).json();assert.equal(legacy.token,direct.token);
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.route('http://127.0.0.1:4274/**',async r=>{
  const request=r.request(),url=new URL(request.url()),headers={'Access-Control-Allow-Origin':site,'Access-Control-Allow-Headers':'Content-Type, X-Diagnostic-Token, X-Karaoke-Token','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
  if(request.method()==='OPTIONS')return r.fulfill({status:204,headers});
  if(!url.pathname.startsWith('/diagnostics'))return r.fulfill({status:404,json:{error:'isolated fixture'},headers});
  if(url.pathname.endsWith('/events'))eventCount++;
  if(failCreate&&/^\/diagnostics\/[a-f0-9-]+$/.test(url.pathname))return r.fulfill({status:503,json:{error:'fixture unavailable'},headers});
  if(failEvents&&url.pathname.endsWith('/events'))return r.fulfill({status:500,json:{error:'fixture disk failure'},headers});
  if(holdFinish&&url.pathname.endsWith('/finish')){finishRequested=true;await new Promise(resolve=>releaseFinish=resolve);}
  const response=await fetch(upstream+url.pathname,{method:request.method(),headers:{Origin:'http://localhost:4273','X-Diagnostic-Token':request.headers()['x-diagnostic-token']||'','Content-Type':'application/json'},body:request.postData()||undefined});
  return r.fulfill({status:response.status,body:await response.text(),contentType:'application/json',headers});
 });
 await page.goto(site);
 await page.evaluate(async()=>{
  localStorage.setItem('karaoke.recording-diagnostics.v1','on');
  const {initRecordingDiagnostics}=await import('/recording-diagnostics.mjs');initRecordingDiagnostics();
  const {RecordingStore,BrowserRecordingStore}=await import('/recording-store.mjs');
  // Isolated IndexedDB only; no real recording-library calls or files.
  for(const method of ['open','save','list','blob','replaceMix','saveRemix','delete'])RecordingStore.prototype[method]=function(...args){return this.browser[method](...args);};
  const {createSingerRecorder}=await import('/recording.mjs');
  const c=new AudioContext({sampleRate:48000,sinkId:{type:'none'}}),osc=c.createOscillator(),gain=c.createGain(),dest=c.createMediaStreamDestination();gain.gain.value=.1;osc.connect(gain);gain.connect(dest);osc.start();await c.resume();
  window.fixtureContext=c;window.fixtureStore=new BrowserRecordingStore();
  window.fixtureReference={cacheId:'diagnostics-fixture',duration:8,title:'Diagnostic integration fixture',step:.1,frames:Array(80).fill(440),beats:[]};
  window.fixtureRecorder=createSingerRecorder({context:()=>c,stream:()=>dest.stream,reference:()=>fixtureReference,player:()=>null,pausePlayer(){},voiced:()=>true});
  window.prepareFixture=(segment=true)=>fixtureRecorder.prepare(fixtureReference,async()=>{}, {},{mode:'voice',delayMs:0,...(segment?{segmentTake:{name:'第 1 段',partId:'test',captureId:'test',key:fixtureReference.cacheId,start:0,end:8}}:{})});
 });
 failCreate=true;
 const denied=await page.evaluate(async()=>{try{await prepareFixture();return '';}catch(e){return e.message;}});assert.match(denied,/尚未開始錄音/);
 assert.equal(await page.evaluate(async()=>(await fixtureStore.list()).length),0);
 failCreate=false;await page.evaluate(()=>prepareFixture());
 await page.waitForTimeout(150);assert.equal(eventCount,0,'ready microphone does not collect diagnostic audio');
 await page.evaluate(()=>fixtureRecorder.playerState(1,0));await page.waitForTimeout(700);
 await page.evaluate(()=>fixtureRecorder.playerState(2,.7));await page.waitForTimeout(400);const pausedCount=eventCount;await page.waitForTimeout(200);assert.equal(eventCount,pausedCount,'pause stops collecting');await page.evaluate(()=>fixtureRecorder.playerState(1,.7));await page.waitForTimeout(700);
 holdFinish=true;await page.evaluate(()=>{window.stopResolved=false;window.fixtureStopping=fixtureRecorder.stop().then(row=>{window.savedRow=row;stopResolved=true;return row;});});
 for(let i=0;i<100&&!finishRequested;i++)await new Promise(r=>setTimeout(r,50));assert.ok(finishRequested);
 assert.equal(await page.evaluate(()=>stopResolved),false,'recording waits for diagnostic disk completion');
 assert.ok((await page.evaluate(()=>fixtureStore.list())).every(r=>!r.complete));
 holdFinish=false;releaseFinish();await page.waitForFunction(()=>stopResolved);
 const row=await page.evaluate(()=>savedRow);assert.equal(row.complete,true);assert.equal(row.diagnostics.status,'saved');
 assert.equal((await page.evaluate(()=>fixtureStore.list()))[0].diagnostics.status,'saved');
 const saved=JSON.parse(await readFile(path.join(tmp,row.id,'metadata.json'),'utf8'));
 assert.equal(saved.status,'saved');assert.equal(saved.frames,row.captureClock.frames);
 const events=(await readFile(path.join(tmp,row.id,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 for(const kind of ['pcm','probe','media'])assert.ok(events.some(e=>e.kind===kind&&e.files.length),kind+' saved');
 // Recorded PCM really matches the persisted WAV, not just metadata counters.
 const raw=Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await(await fixtureStore.blob(savedRow,'voice')).arrayBuffer()))));
 let frame=0;
 for(const event of events.filter(e=>e.kind==='pcm')){assert.equal(event.recordedFrame,frame);const samples=await readFile(path.join(tmp,row.id,event.files[0]));for(let i=0;i<event.frames;i++){const x=Math.max(-1,Math.min(1,samples.readFloatLE(i*4)));assert.equal(raw.readInt16LE(44+(frame+i)*2),(Math.round(x*(x<0?32768:32767))||0));}frame+=event.frames;}
 assert.equal(frame,row.captureClock.frames);
 const stoppedCount=eventCount;await page.waitForTimeout(200);assert.equal(eventCount,stoppedCount,'stop leaves microphone open without collecting');
 failEvents=true;await page.evaluate(()=>prepareFixture(false));await page.evaluate(()=>fixtureRecorder.playerState(1,0));await page.waitForTimeout(700);
 const partial=await page.evaluate(()=>fixtureRecorder.stop());assert.equal(partial.complete,true);assert.equal(partial.diagnostics.status,'incomplete');assert.match(partial.diagnostics.error,/fixture disk failure/);
 assert.equal(JSON.parse(await readFile(path.join(tmp,partial.id,'metadata.json'),'utf8')).status,'incomplete');
 assert.match(await page.locator('#recording-status').textContent(),/診斷未完整保存/);
 failEvents=false;await page.evaluate(()=>prepareFixture());await page.evaluate(()=>fixtureRecorder.stop());assert.equal(await page.locator('#diagnostics-enabled').isDisabled(),false,'cancel before playback releases controls');
 await page.evaluate(()=>{const toggle=document.getElementById('diagnostics-enabled');toggle.checked=false;toggle.dispatchEvent(new Event('change'));});
 const disabledCount=eventCount;await page.evaluate(()=>prepareFixture());await page.evaluate(()=>fixtureRecorder.playerState(1,0));await page.waitForTimeout(400);const disabled=await page.evaluate(()=>fixtureRecorder.stop());assert.equal(disabled.diagnostics,undefined);assert.equal(eventCount,disabledCount,'explicitly disabled diagnostics stays off');
 assert.deepEqual(errors,[]);await page.evaluate(()=>fixtureContext.close());
 console.log('PASS: helper-only diagnostics, legacy proxy, startup failure, real PCM/probe/media, pause/resume, awaited persistence, durable failure status, cancellation.');
}finally{
 await browser?.close();server.kill();await new Promise(r=>diag.close(r));
 if(path.dirname(path.resolve(tmp))===path.resolve(tmpdir())&&path.basename(tmp).startsWith('karaoke-diagnostics-browser-'))await rm(tmp,{recursive:true,force:true});
}
