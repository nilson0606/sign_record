import {createRequire} from 'node:module';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const files=['recording-diagnostics.mjs','recording-diagnostics-worklet.mjs','recording-pcm.mjs','recording-pcm-worklet.mjs'];
const server=http.createServer(async(req,res)=>{const file=req.url.slice(1);res.setHeader('Content-Type',file?'text/javascript':'text/html');if(!file)return res.end('<input id="diagnostics-enabled" type="checkbox"><p id="diagnostics-status"></p><p id="diagnostics-storage"></p><button id="diagnostics-clear">Clear</button><button id="diagnostics-refresh">Refresh</button>');if(!files.includes(file)){res.writeHead(404);return res.end();}res.end(await readFile(new URL('../'+file,import.meta.url)));});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});const page=await browser.newPage(),events=[];let rejectEvents=false;
 await page.route('http://localhost:4273/diagnostics**',async route=>{const req=route.request(),url=new URL(req.url());let body=req.postDataJSON();if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}});if(url.pathname.endsWith('/events'))events.push(body);const fail=rejectEvents&&url.pathname.endsWith('/events');await route.fulfill({status:fail?400:200,headers:{'Access-Control-Allow-Origin':'*'},json:fail?{error:'simulated disk limit'}:url.pathname.endsWith('/session')?{token:'fixture'}:{count:1,bytes:1024,path:'test-only',saved:true,cleared:1}});});
 await page.goto('http://127.0.0.1:'+server.address().port);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(async()=>{
  const module=await import('/recording-diagnostics.mjs');module.initRecordingDiagnostics();globalThis.dm=module;
  const ctx=new AudioContext({sampleRate:48000,sinkId:{type:'none'}}),osc=ctx.createOscillator(),dest=ctx.createMediaStreamDestination();osc.frequency.value=437;osc.connect(dest);osc.start();await ctx.resume();const mic=ctx.createMediaStreamSource(dest.stream),mixed=ctx.createGain();mic.connect(mixed);
  globalThis.fx={ctx,osc,mic,mixed,stream:dest.stream};
  globalThis.prepare=async()=>{const {createPCMRecorders}=await import('/recording-pcm.mjs');const {recorder,rawRecorder}=await createPCMRecorders(ctx,mic,mixed);const meta={id:crypto.randomUUID(),title:'fixture',captureClock:{input:'browser-media-stream'}};const diag=await dm.prepareRecordingDiagnostics({context:ctx,mic,stream:dest.stream,recorder,meta});globalThis.take={recorder,rawRecorder,diag,meta};};await prepare();
 });
 await page.waitForTimeout(400);assert.equal(events.length,0,'idle mic must not collect diagnostics');
 await page.evaluate(()=>{take.diag.start();take.recorder.start();});await page.waitForTimeout(850);
 await page.evaluate(()=>{take.diag.pause();take.recorder.pause();});await page.waitForTimeout(900);const paused=events.length;await page.waitForTimeout(450);assert.equal(events.length,paused,'paused diagnostic must stop collecting');
 await page.evaluate(()=>{take.diag.start();take.recorder.resume();});await page.waitForTimeout(850);
 const result=await page.evaluate(async()=>{take.diag.pause();const done=new Promise(r=>take.recorder.onstop=r);take.recorder.stop();await done;await take.diag.finish();return {frames:take.recorder.frames,expected:take.recorder.clock.frames(fx.ctx.currentTime),status:document.querySelector('#diagnostics-status').textContent};});
 const stopped=events.length;await page.waitForTimeout(600);assert.equal(events.length,stopped,'stopped capture must remain idle while microphone stays open');assert.equal(result.frames,result.expected);assert.ok(events.some(e=>e.kind==='probe'));assert.ok(events.some(e=>e.kind==='pcm'));assert.ok(events.some(e=>e.kind==='media'));assert.match(result.status,/已保存/);
 rejectEvents=true;await page.evaluate(async()=>{await prepare();take.diag.start();take.recorder.start();});await page.waitForTimeout(850);assert.equal(await page.evaluate(()=>take.recorder.state),'recording','diagnostic failure must not stop main capture');await page.evaluate(async()=>{const done=new Promise(r=>take.recorder.onstop=r);take.recorder.stop();await done;await take.diag.finish();});
 assert.match(await page.locator('#diagnostics-status').textContent(),/不完整/);
 await page.evaluate(async()=>{const toggle=document.querySelector('#diagnostics-enabled');toggle.checked=false;toggle.dispatchEvent(new Event('change'));await prepare();});assert.equal(await page.evaluate(()=>take.diag),null);await page.evaluate(async()=>{take.recorder.dispose();fx.osc.stop();fx.stream.getTracks().forEach(t=>t.stop());await fx.ctx.close();});assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,idlePauseStop:true,failureIsolation:true,allThreeSignals:true,result}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
