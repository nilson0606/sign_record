import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import http from 'node:http';
import {handleVoiceLab,stopVoiceLab} from '../voicelab-server.mjs';
import {detectPitch} from '../audio.mjs';
const {chromium}=createRequire('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const fixture=await readFile('.runtime/voicelab/smoke/input.wav'),site='http://localhost:4288';
const backing=Buffer.from(fixture);for(let i=44;i<backing.length;i+=2)backing.writeInt16LE(Math.round(1000*Math.sin(2*Math.PI*660*(i-44)/2/48000)),i);
const backend=http.createServer(async(req,res)=>{
 if(req.url==='/session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({token:'fixture'}));return;}
 if(req.url==='/arrangements/library'){res.setHeader('Content-Type','application/json');res.end('{"records":[]}');return;}
 if(req.url==='/library/fixture/vocals'||req.url==='/library/fixture/accompaniment'){res.setHeader('Content-Type','audio/wav');res.end(req.url.endsWith('vocals')?fixture:backing);return;}
 if(req.url.startsWith('/voicelab'))return handleVoiceLab(req,res);
 res.writeHead(404);res.end();
});
await new Promise(r=>backend.listen(0,'127.0.0.1',r));const api='http://127.0.0.1:'+backend.address().port;
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4288'},windowsHide:true,stdio:['ignore','pipe','pipe']});
await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j);});let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1450,height:1100}}),errors=[],requests=[],reports=[],measured=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/app.mjs',r=>r.fulfill({body:'',contentType:'text/javascript'}));
 await page.route('http://127.0.0.1:4274/**',async route=>{
  const req=route.request(),url=new URL(req.url());requests.push(req.method()+' '+url.pathname);
  const response=await fetch(api+url.pathname,{method:req.method(),body:req.postDataBuffer()??undefined});const body=Buffer.from(await response.arrayBuffer());
  if(req.method()==='GET'&&/^\/voicelab\/jobs\/[^/]+$/.test(url.pathname)){const s=JSON.parse(body);if(s.stage==='ready')reports.push(s);}
  await route.fulfill({status:response.status,body,contentType:response.headers.get('content-type')||'application/json'});
 });
 await page.goto(site);await page.evaluate(async()=>{
  const {createRecordingPost}=await import('/recording-post.mjs');window.saved=[];
  const blobs=new Map();const store={list:async()=>saved,saveRemix:async(meta,mix,voice)=>{saved.push(meta);blobs.set(meta.id,{mix,voice});},blob:async(row,track='mix')=>blobs.get(row.id)[track]};
  window.testPost=createRecordingPost({store,reference:()=>({cacheId:'fixture',title:'Voice Lab 隔離測試',duration:8,hasPreview:true,pitchShift:4,videoId:'fixture'}),stop:async()=>{},pause:()=>{},download:()=>{},onDelete:()=>{}});
  testPost.refresh([]);
 });
 const $=id=>page.locator('#voicelab-'+id);
 assert.equal(await $('enable').isChecked(),false);assert.equal(requests.length,0);
 await $('panel').locator('summary').click();await $('enable').check();await page.waitForFunction(()=>document.getElementById('voicelab-status').textContent.includes('已就緒'));
 assert.equal(await $('pitch').inputValue(),'0');assert.equal(await $('model').inputValue(),'ver3');assert.equal(await page.locator('#soulx-panel').count(),0);
 await $('full').click();
 for(const [button,pitch] of [['pitch-original',0],['pitch-down',-12],['pitch-up',12]]){
  await $(button).click();await $('generate').click();
  await page.waitForFunction(()=>!document.getElementById('voicelab-result').hidden||document.getElementById('voicelab-progress-stage').textContent==='未完成',null,{timeout:180000});
  assert.equal(await $('result').isVisible(),true,await $('status').textContent());
  const report=reports.at(-1);assert.equal(report.result.pitchShift,pitch);assert.equal(report.result.sourceSamples,report.result.outputSamples);assert.equal(report.result.nativeSampleRate,40000);
  const pair=await Promise.all(['source','result'].map(async name=>{const bytes=Buffer.from(await(await fetch(api+`/voicelab/jobs/${report.id}/${name}`)).arrayBuffer());let offset=12;while(bytes.toString('ascii',offset,offset+4)!=='data')offset+=8+bytes.readUInt32LE(offset+4)+(bytes.readUInt32LE(offset+4)%2);const size=bytes.readUInt32LE(offset+4);offset+=8;return Float32Array.from({length:size/2},(_,i)=>bytes.readInt16LE(offset+i*2)/32768);}));
  const shifts=[];for(let i=0;i+8192<pair[0].length;i+=9600){const [a,b]=pair.map(x=>detectPitch(x.subarray(i,i+8192),48000));if(a.hz&&b.hz&&a.confidence>.85&&b.confidence>.85)shifts.push(12*Math.log2(b.hz/a.hz));}
  shifts.sort((a,b)=>a-b);const median=shifts[Math.floor(shifts.length/2)];measured.push({requested:pitch,median,voicedPairs:shifts.length});assert.ok(shifts.length>5&&Math.abs(median-pitch)<1.5,JSON.stringify(measured));
  await $('listen-ai').click();await page.waitForFunction(()=>!document.getElementById('voicelab-audio').paused);
  const samples=await page.evaluate(async()=>{
   const c=new AudioContext({sampleRate:48000,sinkId:{type:'none'}});const b=await c.decodeAudioData(await(await fetch(document.getElementById('voicelab-audio').src)).arrayBuffer());await c.close();return {length:b.length,rate:b.sampleRate};
  });assert.equal(samples.length,384000);assert.equal(samples.rate,48000);
 }
 await $('save').click();await page.waitForFunction(()=>saved.length===1);
 const meta=await page.evaluate(()=>saved[0]);assert.equal(meta.voicelab.report.settings.pitchShift,12);assert.equal(meta.post.reference.pitchShift,4);assert.equal(meta.appliedDelayMs,0);assert.deepEqual(meta.stems,['accompaniment']);
 assert.equal(await page.locator('#post-delay').inputValue(),'0');
 await $('panel').scrollIntoViewIfNeeded();await mkdir('test-results',{recursive:true});await $('panel').screenshot({path:'test-results/voicelab-ui.png'});
 await $('reset').click();assert.equal(await $('pitch').inputValue(),'0');assert.equal(await $('save').isDisabled(),true);
 await $('generate').click();await page.waitForFunction(()=>!document.getElementById('voicelab-cancel').disabled);await $('cancel').click();await page.waitForFunction(()=>document.getElementById('voicelab-status').textContent.includes('已取消'));assert.equal(await $('result').isHidden(),true);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,octaves:reports.map(r=>({pitch:r.result.pitchShift,seconds:r.result.elapsedSeconds})),measured,savedVoice:true,cancelled:true,backingKeyUnchanged:true,errors}));
}finally{await browser?.close();server.kill();await stopVoiceLab();await new Promise(r=>backend.close(r));}
