import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {handleSoulx,stopSoulx} from '../soulx-server.mjs';
const {chromium}=createRequire('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const site='http://localhost:4288',api='http://127.0.0.1:4294',token='soulx-test-token';
const fixture=await readFile('.runtime/soulx/results/contrast-source.wav');
const backend=http.createServer(async(req,res)=>{
  if(req.url==='/session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({token}));return;}
  if(req.headers['x-karaoke-token']!==token){res.writeHead(403);res.end();return;}
  await handleSoulx(req,res);
});
await new Promise(resolve=>backend.listen(4294,'127.0.0.1',resolve));
const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'4288'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser;
try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.stderr.once('data',x=>reject(Error(x.toString())));});
  assert.equal((await fetch(api+'/soulx')).status,403);
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],calls=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.route(site+'/fixture-voice',r=>r.fulfill({contentType:'audio/wav',body:fixture}));
  await page.route('http://127.0.0.1:4274/**',async route=>{
    const req=route.request(),url=req.url().replace('http://127.0.0.1:4274',api);calls.push(req.method()+' '+new URL(url).pathname);
    const response=await fetch(url,{method:req.method(),headers:{'X-Karaoke-Token':req.headers()['x-karaoke-token']??'',...(req.method()==='POST'?{'Content-Type':'application/json'}:{})},body:req.postDataBuffer()??undefined});
    await route.fulfill({status:response.status,contentType:response.headers.get('content-type')??'application/json',body:Buffer.from(await response.arrayBuffer())});
  });
  await page.goto(site);
  const timing=await page.evaluate(async()=>{
    const {soulxSlice}=await import('/soulx-client.mjs');
    const raw=new AudioBuffer({length:48000,sampleRate:24000,numberOfChannels:1});raw.getChannelData(0)[12000]=.5;
    const advanced=await soulxSlice(raw,.2,1.2),delayed=await soulxSlice(raw,-.2,.8);
    return {length:advanced.length,advanced:advanced.getChannelData(0).indexOf(.5),delayed:delayed.getChannelData(0).indexOf(.5)};
  });
  assert.deepEqual(timing,{length:24000,advanced:7200,delayed:16800});
  await page.evaluate(async size=>{
    const {createRecordingPost}=await import('/recording-post.mjs');
    const blob=await(await fetch('/fixture-voice')).blob();
    window.soulxTestPost=createRecordingPost({store:{blob:async()=>blob},stop:async()=>{},pause:()=>{},download:()=>{},onDelete:()=>{}});
    window.soulxTestPost.refresh([{id:'soulx-fixture',title:'SoulX 獨立測試',mode:'voice',complete:true,rawBytes:size,created:Date.now(),seconds:20,appliedDelayMs:200,balance:{manual:true,voice:100,backing:0},post:{reference:{duration:20,frames:[],step:.02},segments:[{offset:0,songTime:0,duration:20}],samples:[]}}]);
  },fixture.length);
  assert.equal(await page.locator('#soulx-panel').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#soulx-enable').isChecked(),false);assert.deepEqual(calls,[]);
  await page.locator('#soulx-panel > summary').click();assert.deepEqual(calls,[]);
  await page.locator('#soulx-enable').check();await page.waitForFunction(()=>document.getElementById('soulx-status').textContent.includes('已就緒'));
  const abBefore=await page.locator('#post-reverb').inputValue();
  await page.locator('#soulx-reference').selectOption('zh');await page.locator('#soulx-end').fill('8');
  await page.locator('#soulx-steps').fill('8');await page.locator('#soulx-guidance').fill('1.5');await page.locator('#soulx-seed').fill('7');
  assert.equal(await page.locator('#post-reverb').inputValue(),abBefore);
  await page.locator('#soulx-generate').click();await page.waitForFunction(()=>!document.getElementById('soulx-cancel').disabled);
  const conflict=await fetch(api+'/soulx/jobs',{method:'POST',headers:{'X-Karaoke-Token':token,'Content-Type':'application/json'},body:'{}'});assert.equal(conflict.status,409);
  await page.waitForFunction(()=>!document.getElementById('soulx-result').hidden||!document.getElementById('soulx-generate').matches(':disabled'),{},{timeout:180000});
  assert.equal(await page.locator('#soulx-result').isVisible(),true,await page.locator('#soulx-status').textContent());
  assert.match(await page.locator('#soulx-result-info').textContent(),/8 步 · CFG 1.5 · 種子 7/);
  await page.locator('#soulx-listen-original').click();await page.waitForFunction(()=>document.getElementById('soulx-audio').currentTime>.4);
  await page.evaluate(()=>{document.getElementById('soulx-audio').pause();document.getElementById('soulx-audio').currentTime=3;});
  await page.locator('#soulx-listen-ai').click();await page.waitForFunction(()=>!document.getElementById('soulx-audio').paused);
  assert.ok(await page.locator('#soulx-audio').evaluate(el=>el.currentTime>=3&&el.currentTime<4));
  const downloadPromise=page.waitForEvent('download');await page.locator('#soulx-download').click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/SoulX.*8步_CFG1.5/);
  await mkdir('test-results',{recursive:true});await page.locator('#soulx-panel').screenshot({path:'test-results/soulx-panel.png'});
  await page.locator('#soulx-reset').click();assert.equal(await page.locator('#soulx-steps').inputValue(),'32');assert.equal(await page.locator('#soulx-guidance').inputValue(),'3');
  assert.match(await page.locator('#soulx-status').textContent(),/目前試聽仍是上次結果/);
  await page.locator('#soulx-enable').uncheck();assert.equal(await page.locator('#soulx-content').isVisible(),false);assert.equal(await page.locator('#soulx-audio').evaluate(el=>el.paused),true);
  assert.equal(await page.locator('#post-reverb').inputValue(),abBefore);
  await page.locator('#soulx-enable').check();await page.locator('#soulx-reference').selectOption('zh');
  await page.locator('#soulx-generate').click();await page.waitForFunction(()=>!document.getElementById('soulx-cancel').disabled);await page.locator('#soulx-cancel').click();
  await page.waitForFunction(()=>!document.getElementById('soulx-generate').matches(':disabled'));
  assert.equal(await page.locator('#soulx-result').isVisible(),false);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,defaultCollapsed:true,defaultDisabled:true,noAutomaticRequests:true,realModel:true,settingsDelivered:true,samePositionSwitch:true,cancellation:true,abUnchanged:true,errors}));
}finally{await browser?.close();await stopSoulx();await new Promise(resolve=>backend.close(resolve));server.kill();}
