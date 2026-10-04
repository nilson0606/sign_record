import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4288'},windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
function wav(seconds,hz,amplitude=.1,rate=48000){const n=seconds*rate,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(amplitude*Math.sin(i/rate*2*Math.PI*hz)*32767),44+i*2);return b;}
const backing=wav(6,110),voice=wav(6,440),generated=wav(6,220),id='00000000-0000-4000-8000-000000000001';
let payload,soulPayload,saved=null,polls=0,modelCalls=0,deletes=0,deleteBlocked=true;const errors=[],calls=[];
const metadata=()=>({id,title:'測試曲_配樂_自選',cacheId:'test-song',start:0,end:6,sourceSeconds:6,settings:payload.settings,outputSamples:288000,generatedSamples:288000});
try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
  const page=await browser.newPage({viewport:{width:1500,height:1100}});page.on('pageerror',e=>errors.push(e.message));await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.route('http://127.0.0.1:4274/**',async route=>{
    const req=route.request(),p=new URL(req.url()).pathname;calls.push(req.method()+' '+p);const json=value=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
    if(p==='/session')return json({token:'test'});
    assert.equal(req.headers()['x-karaoke-token'],'test');
    if(p==='/arrangements')return json({installed:true,maxSeconds:600});
    if(p==='/arrangements/library')return json({path:'測試配樂庫',records:saved?[saved]:[]});
    if(p===`/arrangements/library/${id}`&&req.method()==='DELETE'){deletes++;if(deleteBlocked)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'這份配樂仍被 1 筆錄音使用。'})});saved=null;return json({deleted:true,id});}
    if(p==='/arrangements/jobs'&&req.method()==='POST'){payload=req.postDataJSON();modelCalls++;return json({id,stage:'starting',message:'準備中',progress:null});}
    if(p===`/arrangements/jobs/${id}`){polls++;return json(polls===1?{id,stage:'generating',message:'編曲中',progress:35}:{id,stage:'ready',message:'完成',progress:100,result:metadata()});}
    if(p===`/arrangements/jobs/${id}/save`){saved={...metadata(),_archiveRoot:'測試配樂庫'};return json(saved);}
    if(p===`/arrangements/jobs/${id}/audio`||p===`/arrangements/library/${id}/audio`)return route.fulfill({contentType:'audio/wav',body:generated});
    if(p==='/library/test-song/accompaniment')return route.fulfill({contentType:'audio/wav',body:backing});
    if(p==='/library/test-song/vocals')return route.fulfill({contentType:'audio/wav',body:voice});
    if(p==='/soulx')return json({installed:true});
    if(p==='/soulx/jobs'&&req.method()==='POST'){soulPayload=req.postDataJSON();return json({id:'mock-soulx',stage:'ready',message:'完成',result:{settings:soulPayload.settings,pitchShift:0,sourceSamples:144000,outputSamples:144000,sampleRate:24000}});}
    if(p==='/soulx/jobs/mock-soulx/source'||p==='/soulx/jobs/mock-soulx/result')return route.fulfill({contentType:'audio/wav',body:wav(6,440,.1,24000)});
    return route.fulfill({status:404,contentType:'application/json',body:'{}'});
  });
  await page.goto('http://localhost:4288');
  await page.evaluate(async()=>{
    const {createArrangement,arrangementMixes}=await import('/arrangement-client.mjs'),{createSoulx}=await import('/soulx-client.mjs');
    window.testReference={cacheId:'test-song',title:'測試曲',duration:6,hasPreview:true};window.arr=createArrangement({getReference:()=>window.testReference,beforePlay:()=>{}});
    window.sx=createSoulx({store:{},getSelected:()=>null,getReference:()=>window.testReference,getPosition:()=>0,beforePlay:()=>{}});
    document.getElementById('mic-stop').disabled=true;
    // Singer impulse must stay at the same sample for both arrangements, with shared headroom.
    const a=new AudioBuffer({length:48000,sampleRate:48000,numberOfChannels:1}),b=new AudioBuffer({length:48000,sampleRate:48000,numberOfChannels:1}),v=new AudioBuffer({length:48000,sampleRate:48000,numberOfChannels:1});a.getChannelData(0)[1000]=.1;b.getChannelData(0)[2000]=.2;v.getChannelData(0)[5000]=.3;
    const mixes=await arrangementMixes(a,b,v,{match:false});window.impulses=mixes.map(x=>[x.length,x.getChannelData(0)[5000],x.getChannelData(0)[1000],x.getChannelData(0)[2000]]);
  });
  assert.equal(await page.locator('#arrangement-panel').getAttribute('open'),null);assert.equal(modelCalls,0);
  const impulses=await page.evaluate(()=>window.impulses);for(const x of impulses){assert.equal(x[0],48000);assert.ok(Math.abs(x[1]-.3)<1e-6);}assert.ok(Math.abs(impulses[0][2]-.1)<1e-6);assert.ok(Math.abs(impulses[1][3]-.2)<1e-6);
  await page.locator('#arrangement-panel>summary').click();await page.locator('#arrangement-enable').check();assert.equal(await page.locator('#arrangement-end').inputValue(),'6');
  await page.locator('#arrangement-preset').selectOption('jazz');await page.locator('#arrangement-instruments input[value=flute]').check();assert.equal(await page.locator('#arrangement-preset').inputValue(),'custom');
  await page.locator('#arrangement-generate').click();await page.waitForFunction(()=>document.getElementById('arrangement-progress-label').textContent.includes('模型估計'));await page.waitForFunction(()=>!document.getElementById('arrangement-result').hidden);
  assert.equal(payload.end,6);assert.ok(payload.settings.instruments.includes('flute'));assert.equal(modelCalls,1);
  await page.locator('#arrangement-listen-new').click();await page.waitForFunction(()=>!document.getElementById('arrangement-audio').paused);await page.evaluate(()=>{document.getElementById('arrangement-audio').currentTime=2;});await page.locator('#arrangement-listen-original').click();
  const position=await page.locator('#arrangement-audio').evaluate(a=>a.currentTime);assert.ok(position>=2&&position<3);
  await page.locator('#arrangement-listen-mode').selectOption('solo');await page.locator('#arrangement-listen-new').click();await page.waitForFunction(()=>!document.getElementById('arrangement-audio').paused);
  await page.locator('#arrangement-save').click();await page.waitForFunction(()=>document.getElementById('arrangement-status').textContent.includes('已保存至'));assert.ok(saved);assert.equal(await page.locator('#arrangement-save').isDisabled(),true);
  // Fresh UI instance reloads the durable library and its audio without another generation.
  await page.reload();await page.evaluate(async()=>{const {createArrangement}=await import('/arrangement-client.mjs');window.arr=createArrangement({getReference:()=>({cacheId:'test-song',title:'測試曲',duration:6,hasPreview:true}),beforePlay:()=>{}});});
  await page.locator('#arrangement-panel>summary').click();await page.locator('#arrangement-enable').check();await page.locator('#arrangement-library').selectOption(id);await page.locator('#arrangement-load').click();await page.waitForFunction(()=>!document.getElementById('arrangement-result').hidden);await page.locator('#arrangement-listen-new').click();await page.waitForFunction(()=>!document.getElementById('arrangement-audio').paused);assert.equal(modelCalls,1);
  await page.evaluate(async()=>{const {createSoulx}=await import('/soulx-client.mjs');document.getElementById('mic-stop').disabled=true;window.sx=createSoulx({store:{saveRemix:async(meta,mix,voice)=>{window.savedSoulx={meta,mixBytes:mix.size,voiceBytes:voice.size};}},getSelected:()=>null,getReference:()=>({cacheId:'test-song',title:'測試曲',duration:6,hasPreview:true}),getPosition:()=>0,beforePlay:()=>{}});});
  await page.locator('#soulx-panel>summary').click();await page.locator('#soulx-enable').check();await page.locator('#soulx-source').selectOption('original');await page.waitForFunction(()=>document.querySelectorAll('#soulx-backing-choice option').length===2);
  await page.locator('#soulx-reference').selectOption('zh');await page.locator('#soulx-generate').click();await page.waitForFunction(()=>!document.getElementById('soulx-result').hidden);
  await page.locator('#soulx-backing-choice').selectOption(id);assert.equal(await page.locator('#soulx-backing-choice').inputValue(),id);await page.locator('#soulx-listen-ai').click();await page.waitForFunction(()=>!document.getElementById('soulx-audio').paused);
  await page.locator('#soulx-save').click();await page.waitForFunction(()=>window.savedSoulx);const sx=await page.evaluate(()=>window.savedSoulx);assert.equal(sx.meta.arrangement.id,id);assert.deepEqual(sx.meta.stems,['arrangement']);assert.equal(sx.meta.seconds,6);assert.equal(sx.meta.rawBytes,sx.voiceBytes);assert.equal(sx.meta.bytes,sx.mixBytes);
  await page.locator('#soulx-panel>summary').click();await page.locator('#arrangement-panel').scrollIntoViewIfNeeded();await mkdir('test-results',{recursive:true});await page.locator('#arrangement-panel').screenshot({path:'test-results/arrangement-panel.png'});
  page.once('dialog',d=>d.dismiss());await page.locator('#arrangement-delete').click();assert.equal(deletes,0);
  page.once('dialog',d=>d.accept());await page.locator('#arrangement-delete').click();await page.waitForFunction(()=>document.getElementById('arrangement-status').textContent.includes('仍被 1 筆錄音使用'));assert.equal(await page.locator('#arrangement-result').isVisible(),true);
  deleteBlocked=false;page.once('dialog',d=>d.accept());await page.locator('#arrangement-delete').click();await page.waitForFunction(()=>document.getElementById('arrangement-status').textContent==='已刪除選取配樂。');assert.equal(deletes,2);assert.equal(await page.locator('#arrangement-result').isVisible(),false);assert.equal(await page.locator('#arrangement-delete').isDisabled(),true);
  await page.waitForFunction(()=>document.querySelectorAll('#soulx-backing-choice option').length===1);assert.equal(await page.locator('#soulx-backing-choice').inputValue(),'');
  assert.deepEqual(errors,[]);console.log('PASS: default closed, full-song request, custom instruments, estimated progress, singer-preserving mix, same-position audition, save/reopen and SoulX library choice.');
}finally{await browser?.close();server.kill();}
