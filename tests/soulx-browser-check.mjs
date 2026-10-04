import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {RecordingArchive,handleRecordingArchive} from '../recording-archive.mjs';
import {handleSoulx,stopSoulx} from '../soulx-server.mjs';
const {chromium}=createRequire('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const site='http://localhost:4288',api='http://127.0.0.1:4294',token='soulx-test-token';
const fixture=await readFile('.runtime/soulx/results/contrast-source.wav');
const archiveRoot=await mkdtemp(path.join(tmpdir(),'soulx-save-test-')),archive=new RecordingArchive(archiveRoot);
const backend=http.createServer(async(req,res)=>{
  if(req.url==='/session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({token,features:['recording-library','recording-raw-mime']}));return;}
  if(req.headers['x-karaoke-token']!==token){res.writeHead(403);res.end();return;}
  if(req.url==='/library/soulx-original-fixture/lead'){res.setHeader('Content-Type','audio/wav');res.end(fixture);return;}
  if(['/library/soulx-original-fixture/accompaniment','/library/soulx-original-fixture/backing'].includes(req.url)){res.setHeader('Content-Type','audio/wav');res.end(fixture);return;}
  if(req.url.startsWith('/recordings'))await handleRecordingArchive(req,res,{get:async()=>({configured:true,path:archiveRoot})});else await handleSoulx(req,res);
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
    const {RecordingStore}=await import('/recording-store.mjs');window.testStore=new RecordingStore();
    const blob=await(await fetch('/fixture-voice')).blob();
    window.soulxTestPost=createRecordingPost({store:{blob:(row,track)=>{window.testVoiceReads=(window.testVoiceReads??0)+1;return row.id==='soulx-fixture'?Promise.resolve(blob):testStore.blob(row,track);},saveRemix:(...args)=>{if(window.failSoulxSave)throw Error('test save failure');return testStore.saveRemix(...args);},list:async()=>[window.originalSoulxRow,...await testStore.list()]},reference:()=>window.testLoadedReference??null,stop:async()=>{},pause:()=>{},download:()=>{},onDelete:()=>{}});
    window.originalSoulxRow={id:'soulx-fixture',title:'SoulX 獨立測試',mode:'voice',complete:true,rawBytes:size,created:Date.now(),seconds:20,appliedDelayMs:200,balance:{manual:true,voice:100,backing:0},post:{reference:{duration:20,frames:[],step:.02,cacheId:'soulx-original-fixture',vocalMode:'lead'},segments:[{offset:0,songTime:0,duration:20}],samples:[]}};
    window.soulxTestPost.refresh([window.originalSoulxRow]);
  },fixture.length);
  assert.equal(await page.locator('#soulx-panel').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#soulx-enable').isChecked(),false);assert.deepEqual(calls,[]);
  await page.locator('#soulx-panel > summary').click();assert.deepEqual(calls,[]);
  await page.locator('#soulx-enable').check();await page.waitForFunction(()=>document.getElementById('soulx-status').textContent.includes('已就緒'));
  await page.locator('#soulx-source').selectOption('recording');
  await page.locator('#soulx-full').click();assert.match(await page.locator('#soulx-range-info').textContent(),/整首.*20.00/);
  const abBefore=await page.locator('#post-reverb').inputValue();
  await page.locator('#soulx-reference').selectOption('original');await page.locator('#soulx-end').fill('8');
  await page.locator('#soulx-steps').fill('8');await page.locator('#soulx-guidance').fill('1.5');await page.locator('#soulx-seed').fill('7');
  assert.equal(await page.locator('#post-reverb').inputValue(),abBefore);
  await page.locator('#soulx-generate').click();await page.waitForFunction(()=>!document.getElementById('soulx-cancel').disabled);
  const conflict=await fetch(api+'/soulx/jobs',{method:'POST',headers:{'X-Karaoke-Token':token,'Content-Type':'application/json'},body:'{}'});assert.equal(conflict.status,409);
  await page.waitForFunction(()=>!document.getElementById('soulx-result').hidden||!document.getElementById('soulx-generate').matches(':disabled'),{},{timeout:180000});
  assert.equal(await page.locator('#soulx-result').isVisible(),true,await page.locator('#soulx-status').textContent());
  assert.match(await page.locator('#soulx-result-info').textContent(),/8 步 · CFG 1.5 · 種子 7/);
  assert.ok(calls.includes('GET /library/soulx-original-fixture/lead'));assert.match(await page.locator('#soulx-result-info').textContent(),/原曲原唱/);
  await page.locator('#soulx-listen-original').click();await page.waitForFunction(()=>document.getElementById('soulx-audio').currentTime>.4);
  await page.evaluate(()=>{document.getElementById('soulx-audio').pause();document.getElementById('soulx-audio').currentTime=3;});
  await page.locator('#soulx-listen-ai').click();await page.waitForFunction(()=>!document.getElementById('soulx-audio').paused);
  assert.ok(await page.locator('#soulx-audio').evaluate(el=>el.currentTime>=3&&el.currentTime<4));
  const downloadPromise=page.waitForEvent('download');await page.locator('#soulx-download').click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/SoulX.*8步_CFG1.5/);
  await page.evaluate(()=>{window.failSoulxSave=true;});await page.locator('#soulx-save').click();await page.waitForFunction(()=>document.getElementById('soulx-status').textContent.includes('保存未完成'));
  assert.equal(await page.locator('#soulx-result').isVisible(),true);assert.equal((await archive.list()).records.length,0);
  await page.evaluate(()=>{window.failSoulxSave=false;});
  await mkdir('test-results',{recursive:true});await page.locator('#soulx-panel').screenshot({path:'test-results/soulx-panel.png'});
  await page.locator('#soulx-reset').click();assert.equal(await page.locator('#soulx-steps').inputValue(),'32');assert.equal(await page.locator('#soulx-guidance').inputValue(),'3');
  assert.match(await page.locator('#soulx-status').textContent(),/目前仍是上次結果/);assert.equal(await page.locator('#soulx-save').isDisabled(),true);
  await page.locator('#soulx-reference').selectOption('original');await page.locator('#soulx-steps').fill('8');await page.locator('#soulx-guidance').fill('1.5');await page.locator('#soulx-seed').fill('7');
  await page.locator('#soulx-save').click();await page.waitForFunction(()=>document.getElementById('post-status').textContent.includes('已另存'));
  const saved=(await archive.list()).records[0];assert.equal(saved.seconds,8);assert.equal(saved.soulx.sourceDelayMs,200);assert.equal(saved.appliedDelayMs,0);assert.match(saved.title,/片段0-8秒/);
  assert.equal(await page.locator('#post-recording').inputValue(),saved.id);assert.equal(await page.locator('#remix-delay').inputValue(),'0');assert.equal(await page.locator('#post-reverb').inputValue(),'0');
  const check=await page.evaluate(async id=>{
    const {RecordingStore}=await import('/recording-store.mjs'),fresh=new RecordingStore(),row=(await fresh.list()).find(r=>r.id===id);
    const context=new AudioContext({sampleRate:24000,sinkId:{type:'none'}});
    try{const raw=await context.decodeAudioData(await(await fresh.blob(row,'voice')).arrayBuffer()),mix=await context.decodeAudioData(await(await fresh.blob(row)).arrayBuffer());
      const {remixRecording}=await import('/recording-process.mjs'),again=await remixRecording(raw,[],row,0,{effects:row.vocalEffects});
      let error=0;for(let i=0;i<mix.length;i++)error=Math.max(error,Math.abs(mix.getChannelData(0)[i]-again.getChannelData(0)[i]));
      return {seconds:raw.duration,frames:again.length,error};
    }finally{await context.close();}
  },saved.id);
  assert.equal(check.seconds,8);assert.equal(check.frames,192000);assert.ok(check.error<.0001,JSON.stringify(check));
  await page.evaluate(()=>soulxTestPost.select('soulx-fixture',{scroll:false}));
  await page.locator('#soulx-enable').uncheck();assert.equal(await page.locator('#soulx-content').isVisible(),false);assert.equal(await page.locator('#soulx-audio').evaluate(el=>el.paused),true);
  assert.equal(await page.locator('#post-reverb').inputValue(),abBefore);
  await page.locator('#soulx-enable').check();await page.locator('#soulx-reference').selectOption('zh');
  await page.locator('#soulx-generate').click();await page.waitForFunction(()=>!document.getElementById('soulx-cancel').disabled);await page.locator('#soulx-cancel').click();
  await page.waitForFunction(()=>!document.getElementById('soulx-generate').matches(':disabled'));
  assert.equal(await page.locator('#soulx-result').isVisible(),false);assert.deepEqual(errors,[]);
  // No recording is selected: the loaded original song supplies the entire source,
  // while an uploaded short sample supplies the target voice.
  await page.evaluate(()=>{window.testLoadedReference={cacheId:'soulx-original-fixture',duration:20,hasPreview:true,vocalMode:'lead',title:'原曲換聲測試',frames:[],step:.02};soulxTestPost.refresh([]);soulxTestPost.controls();window.testVoiceReads=0;});
  await page.locator('#soulx-source').selectOption('original');
  assert.equal(await page.locator('#soulx-reference').inputValue(),'custom');assert.equal(await page.locator('#post-recording option').count(),0);
  await page.locator('#soulx-upload').setInputFiles({name:'my-voice.wav',mimeType:'audio/wav',buffer:fixture});
  await page.locator('#soulx-steps').fill('8');await page.locator('#soulx-full').click();
  assert.match(await page.locator('#soulx-range-info').textContent(),/整首.*20.00/);
  await page.locator('#soulx-generate').click();await page.waitForFunction(()=>!document.getElementById('soulx-cancel').disabled);
  await page.waitForFunction(()=>!document.getElementById('soulx-result').hidden||!document.getElementById('soulx-generate').matches(':disabled'),{},{timeout:180000});
  assert.equal(await page.locator('#soulx-result').isVisible(),true,await page.locator('#soulx-status').textContent());
  assert.match(await page.locator('#soulx-result-info').textContent(),/原曲原唱 → 自選參考歌聲.*整首/);
  assert.equal(await page.evaluate(()=>window.testVoiceReads),0,'must not read the user recording as source');
  const jobId=calls.filter(c=>/^GET \/soulx\/jobs\/[^/]+$/.test(c)).at(-1).split('/').at(-1);
  const report=await(await fetch(api+'/soulx/jobs/'+jobId,{headers:{'X-Karaoke-Token':token}})).json();assert.equal(report.result.seconds,20);assert.equal(report.result.settings.referenceSeconds,8);
  await page.locator('#soulx-save').click();await page.waitForFunction(()=>document.getElementById('post-status').textContent.includes('原唱換聲'));
  const song=(await archive.list()).records.find(r=>r.soulx?.sourceKind==='original');assert.equal(song.seconds,20);assert.equal(song.appliedDelayMs,0);assert.equal(song.parentId,undefined);assert.equal(song.mode,'mix');assert.equal(song.soulx.report.settings.reference,'custom');
  assert.deepEqual(song.post.segments,[{offset:0,songTime:0,duration:20}]);
  assert.ok(calls.includes('GET /library/soulx-original-fixture/accompaniment'));assert.ok(calls.includes('GET /library/soulx-original-fixture/backing'));
  await page.locator('#soulx-panel').screenshot({path:'test-results/soulx-original-source.png'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,defaultCollapsed:true,defaultDisabled:true,noAutomaticRequests:true,realModel:true,settingsDelivered:true,samePositionSwitch:true,cancellation:true,abUnchanged:true,savedToDisk:true,reopenedAndEditable:true,neutralRemix:check,originalSourceWithoutRecording:true,shortCustomReferenceForWholeSong:true,errors}));
}finally{await browser?.close();await stopSoulx();await new Promise(resolve=>backend.close(resolve));server.kill();if(path.dirname(archiveRoot)===path.resolve(tmpdir())&&path.basename(archiveRoot).startsWith('soulx-save-test-'))await rm(archiveRoot,{recursive:true,force:true});}
