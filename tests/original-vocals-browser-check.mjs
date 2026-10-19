import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const site='http://localhost:4394',server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4394'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser;
try{
 await new Promise((ok,no)=>{server.stdout.once('data',ok);server.once('error',no);server.stderr.once('data',x=>no(Error(String(x))));});
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1400,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.mjs',r=>r.fulfill({body:'',contentType:'text/javascript'}));
 async function init(){await page.evaluate(async()=>{
  const {createSegmentRecording}=await import('/recording-segment-ui.mjs'),{segmentDraft}=await import('/recording-segments.mjs'),{wavBlob,remixRecording}=await import('/recording-process.mjs'),{BrowserRecordingStore}=await import('/recording-store.mjs');
  window.ref={cacheId:'original-fixture',videoId:'M7lc1UVf-VE',title:'原唱區間測試',duration:6,hasPreview:true,vocalMode:'all',pitchShift:4};
  window.tone=(hz,seconds=6.2)=>{const b=new AudioBuffer({length:Math.round(48000*seconds),sampleRate:48000,numberOfChannels:1});b.getChannelData(0).forEach((_,i,a)=>a[i]=.04*Math.sin(2*Math.PI*hz*i/48000));return b;};
  window.stems={accompaniment:tone(900),vocals:tone(600),lead:tone(600)};
  window.store=new BrowserRecordingStore();
  const key='karaoke.segment-draft.v1.'+ref.cacheId;
  if(!localStorage.getItem(key)){
   const draft=segmentDraft(ref);draft.parts[0].takeId='take';localStorage.setItem(key,JSON.stringify(draft));
   const blob=wavBlob(tone(300));await store.saveRemix({id:'take',created:Date.now(),title:ref.title,complete:true,seconds:6.2,bytes:blob.size,rawBytes:blob.size,rawMime:'audio/wav',mime:'audio/wav',segmentTake:{key:ref.cacheId,partId:draft.parts[0].id,name:'第 1 段'},post:{reference:ref,segments:[{songTime:0,offset:0,duration:6.2}],samples:[]}},blob,blob);
  }
  window.editor=createSegmentRecording({reference:()=>ref,canEnter:()=>true,changed(){},pauseOther(){},player:()=>({pauseVideo(){},getCurrentTime:()=>0,getPlayerState:()=>2}),recording:{store,balanceSettings:()=>({manual:true,voice:70,backing:30}),refresh:async()=>{},stop:async()=>{}},loadStem:async(_,stem)=>wavBlob(stems[stem]).arrayBuffer()});editor.referenceChanged();editor.enter();
  window.decode=async blob=>{const c=new AudioContext({sinkId:{type:'none'}});try{return await c.decodeAudioData(await blob.arrayBuffer());}finally{await c.close();}};
  window.power=(b,hz,t)=>{const a=b.getChannelData(0),start=Math.round(t*b.sampleRate),end=start+4800;let re=0,im=0;for(let i=start;i<end;i++){re+=a[i]*Math.cos(2*Math.PI*hz*i/b.sampleRate);im+=a[i]*Math.sin(2*Math.PI*hz*i/b.sampleRate);}return Math.hypot(re,im)/(end-start);};
  window.core=async()=>{
   const raw=tone(300),meta={mode:'mix',stems:['accompaniment','lead'],fixedMixGains:{version:1,voice:1,backing:1},sourceSeconds:6.2,seconds:6,post:{reference:ref,samples:[],segments:[{offset:0,songTime:0,duration:6}],originalVocals:{stem:'lead',ranges:[{start:1,end:2,mode:'duet'},{start:3,end:4,mode:'original'}]}}};
   const mixed=await remixRecording(raw,[stems.accompaniment,stems.lead],meta,200),solo=await remixRecording(raw,[],{...meta,mode:'voice'},200);
   return {regions:[.5,1.3,2.3,3.3,4.3].map(t=>[300,600,900].map(hz=>power(mixed,hz,t))),solo:[300,600,900].map(hz=>power(solo,hz,3.3)),edge:[.85,1.05,1.85,2.05].map(t=>power(mixed,600,t))};
  };
 });await page.waitForFunction(()=>document.getElementById('segment-take').options.length>1);}
 await page.goto(site);await init();const $=id=>page.locator('#segment-'+id);
 const core=await page.evaluate(()=>core());
 for(const [i,levels]of core.regions.entries()){assert.ok(levels[2]>.015);assert.ok(i===3?levels[0]<.0001:levels[0]>.015);assert.ok([1,3].includes(i)?levels[1]>.015:levels[1]<.0001);}
 assert.ok(core.solo[0]>.015&&core.solo[1]<.0001&&core.solo[2]<.0001);assert.ok(core.edge[0]<.0001&&core.edge[1]>.015&&core.edge[2]>.015&&core.edge[3]<.0001,'original uses song time, not +200 ms');
 await $('original-panel').locator('summary').click();
 async function add(start,end,mode){await $('original-start').fill(start);await $('original-end').fill(end);await $('original-mode').selectOption(mode);await $('original-add').click();}
 await add('00:01','00:02','duet');await add('00:03','00:04','original');assert.equal(await page.locator('.original-vocal-range').count(),2);
 await add('00:01.5','00:03.5','duet');assert.match(await $('status').textContent(),/不可重疊/);assert.equal(await page.locator('.original-vocal-range').count(),2);
 await $('compose').click();await page.waitForFunction(()=>!document.getElementById('segment-export').disabled);
 await $('export').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('已存到錄音後處理'));
 const saved=await page.evaluate(async()=>{const row=(await store.list()).find(r=>r.segmentComposition);window.savedRow=row;const b=await decode(await store.blob(row));return {post:row.post.originalVocals,stems:row.stems,regions:[.5,1.3,3.3,4.3].map(t=>[300,600,900].map(hz=>power(b,hz,t)))};});
 assert.deepEqual(saved.stems,['accompaniment','vocals']);assert.deepEqual(saved.post.ranges.map(r=>r.mode),['duet','original']);
 assert.ok(saved.regions[0][1]<.0001&&saved.regions[1][1]>.003&&saved.regions[2][0]<.0001&&saved.regions[2][1]>.003&&saved.regions[3][1]<.0001);
 const post=await page.evaluate(async()=>{const {remixRecording}=await import('/recording-process.mjs'),row=savedRow,raw=await decode(await store.blob(row,'voice')),again=await remixRecording(raw,row.stems.map(s=>stems[s]),row,200,{edit:row.postEdit}),first=await decode(await store.blob(row));let error=0;for(let i=0;i<first.length;i++)error=Math.max(error,Math.abs(first.getChannelData(0)[i]-again.getChannelData(0)[i]));return {error,rawOriginal:power(raw,600,3.3),rawOwn:power(raw,300,3.3)};});
 assert.ok(post.error<.0001&&post.rawOriginal<.0001&&post.rawOwn>.01,JSON.stringify(post));
 await $('output').selectOption('voice');await $('compose').click();await page.waitForFunction(()=>!document.getElementById('segment-export').disabled);
 const solo=await page.evaluate(async()=>{const b=await decode(await(await fetch(document.getElementById('segment-audio').src)).blob());return [300,600,900].map(hz=>power(b,hz,3.3));});assert.ok(solo[0]>.01&&solo[1]<.0001&&solo[2]<.0001);
 await page.reload();await init();await $('original-panel').locator('summary').click();assert.equal(await page.locator('.original-vocal-range').count(),2);assert.equal(await page.locator('.original-vocal-range select').nth(1).inputValue(),'original');
 await page.locator('.original-vocal-range select').nth(1).selectOption('duet');assert.equal(await page.locator('.original-vocal-range select').nth(1).inputValue(),'duet');
 await mkdir('test-results',{recursive:true});await $('original-panel').screenshot({path:'test-results/original-vocals-desktop.png'});
 await page.setViewportSize({width:390,height:844});assert.ok(await $('side').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await $('original-panel').screenshot({path:'test-results/original-vocals-mobile.png'});
 await page.getByRole('button',{name:'刪除第 1 個原唱區間',exact:true}).click();assert.equal(await page.locator('.original-vocal-range').count(),1);
 await page.getByRole('button',{name:'刪除第 1 個原唱區間',exact:true}).click();await add('00:00','00:06','original');
 await $('take').selectOption('');await $('compose').click();await page.waitForFunction(()=>!document.getElementById('segment-export').disabled);
 const originalOnly=await page.evaluate(async()=>{const b=await decode(await(await fetch(document.getElementById('segment-audio').src)).blob());return [300,600,900].map(hz=>power(b,hz,3.3));});assert.ok(originalOnly[0]<.0001&&originalOnly[1]>.003&&originalOnly[2]>.003);
 await $('output').selectOption('voice');await $('compose').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('尚未完整涵蓋'));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,duet:true,replace:true,songClock:true,pureVoice:true,rawPreserved:true,postRemix:true,persisted:true,mobile:true}));
}finally{await browser?.close();server.kill();}
