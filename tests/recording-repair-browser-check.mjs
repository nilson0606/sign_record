import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const port='4390',site='http://localhost:'+port;
const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:port},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser;
try{
 await new Promise((ok,no)=>{server.stdout.once('data',ok);server.stderr.once('data',x=>no(Error(x.toString())));server.once('error',no);});
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true,args:['--mute-audio']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:1100});
 await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.route('http://127.0.0.1:4274/**',async r=>{
  if(r.request().url().endsWith('/session'))return r.fulfill({json:{token:'fixture',features:[]},headers:{'Access-Control-Allow-Origin':site}});
  if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:{'Access-Control-Allow-Origin':site,'Access-Control-Allow-Headers':'X-Karaoke-Token'}});
  const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await fixtureBacking.arrayBuffer())));return r.fulfill({body:Buffer.from(bytes),contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':site}});
 });
 await page.goto(site);
 async function initialize(){await page.evaluate(async()=>{
  const {createRecordingPost}=await import('/recording-post.mjs'),{BrowserRecordingStore}=await import('/recording-store.mjs'),{wavBlob,remixRecording}=await import('/recording-process.mjs');
  window.fixtureStore=new BrowserRecordingStore();const c=new AudioContext({sampleRate:48000,sinkId:{type:'none'}}),rate=c.sampleRate;
  const raw=c.createBuffer(1,rate*3.5,rate),back=c.createBuffer(1,raw.length,rate);let seed=123,low=0,high=0;
  for(let i=0;i<raw.length;i++){const t=i/rate;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const rnd=seed/2147483648-1;low+=(rnd-low)*.2;high+=(rnd-high)*.025;
   raw.getChannelData(0)[i]=.007*rnd+(t>.7&&t<3?.1*Math.sin(2*Math.PI*450*t):0)+(t>1.3&&t<1.55?.08*Math.sin(2*Math.PI*6500*t):0)+(t>.35&&t<.55?(low-high)*.05:0);back.getChannelData(0)[i]=.08*Math.sin(2*Math.PI*660*t);
  }
  window.fixtureBacking=wavBlob(back);let rows=await fixtureStore.list();
  if(!rows.length){const voice=wavBlob(raw),meta={id:crypto.randomUUID(),title:'四項人聲後製測試',videoId:'M7lc1UVf-VE',mode:'mix',stems:['accompaniment'],mime:'audio/wav',rawMime:'audio/wav',created:Date.now(),seconds:3.5,sourceSeconds:3.5,complete:true,rawBytes:voice.size,appliedDelayMs:0,balance:{manual:true,voice:100,backing:100},post:{reference:{cacheId:'fixture',duration:3.5,step:.1,frames:Array(35).fill(440),masks:[]},offsetMs:0,segments:[{offset:0,songTime:0,duration:3.5}],samples:[]}};
   const mix=wavBlob(await remixRecording(await c.decodeAudioData(await voice.arrayBuffer()),[await c.decodeAudioData(await fixtureBacking.arrayBuffer())],meta,0));meta.bytes=mix.size;await fixtureStore.saveRemix(meta,mix,voice);rows=await fixtureStore.list();
  }
  window.fixturePost=createRecordingPost({store:fixtureStore,stop:async()=>{},pause:()=>{},download:()=>{},onDelete:()=>{}});fixturePost.refresh(rows);
  window.hash=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(',');
  window.loopFingerprints=[];const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.loop)loopFingerprints.push({length:this.buffer.length,energy:this.buffer.getChannelData(0).reduce((s,x)=>s+x*x,0)});return start.apply(this,args);};
  await c.close();
 });}
 await initialize();const $=id=>page.locator('#'+id);const original=await $('post-recording').inputValue(),beforeRaw=await page.evaluate(async id=>hash(await fixtureStore.blob({id},'voice')),original);
 await $('post-effects-panel').locator(':scope > summary').click();await $('post-repair-panel').locator(':scope > summary').click();await $('post-audition-panel').locator(':scope > summary').click();
 assert.equal(await $('post-noise').inputValue(),'0');assert.equal(await $('post-pitch-correction').inputValue(),'0');
 await $('post-effects-reset').click();await $('post-audition-a-edit').click();await $('post-effects-reset').click();await $('post-audition-b-edit').click();
 const fields={'post-noise':'30','post-deess':'45','post-deess-hz':'5500','post-breath':'35','post-pitch-correction':'60','post-pitch-speed':'140'};
 for(const [id,value] of Object.entries(fields))await $(id).fill(value);await $('post-pitch-target').selectOption('reference');await $('post-pitch-vibrato').selectOption('off');
 await $('post-audition-a-edit').click();for(const id of ['post-noise','post-deess','post-breath','post-pitch-correction'])assert.equal(await $(id).inputValue(),'0');assert.equal(await $('post-deess-hz').inputValue(),'6000');assert.equal(await $('post-pitch-speed').inputValue(),'120');assert.equal(await $('post-pitch-target').inputValue(),'chromatic');assert.equal(await $('post-pitch-vibrato').inputValue(),'on');
 await $('post-audition-b-edit').click();for(const [id,value] of Object.entries(fields))assert.equal(await $(id).inputValue(),value);assert.equal(await $('post-audition-differences-body').locator('tr').count(),8);
 await $('post-audition-start').fill('0.8');await $('post-audition-end').fill('1.8');await $('post-audition-mode').selectOption('voice');await $('post-audition-quick').click();await page.waitForFunction(()=>document.querySelector('#post-audition-position').textContent.startsWith('B'));await $('post-audition-a-play').click();await page.waitForFunction(()=>document.querySelector('#post-audition-position').textContent.startsWith('A'));await $('post-audition-stop').click();
 const loops=await page.evaluate(()=>loopFingerprints);assert.equal(loops.length,2);assert.equal(loops[0].length,loops[1].length);assert.notEqual(loops[0].energy,loops[1].energy,'A and B render different processed voice buffers');
 await $('post-audition-b-edit').click();await $('remix-delay').fill('200');await $('post-remix').click();await page.waitForFunction(id=>document.querySelector('#post-recording').value!==id,original);await page.waitForFunction(()=>!document.querySelector('#post-remix').disabled);const saved=await $('post-recording').inputValue();
 const meta=await page.evaluate(async id=>(await fixtureStore.list()).find(r=>r.id===id),saved);assert.deepEqual(meta.vocalEffects.cleanup,{noise:30,deess:45,deessHz:5500,breath:35});assert.deepEqual(meta.vocalEffects.pitchCorrection,{amount:60,target:'reference',speedMs:140,preserveVibrato:false});assert.equal(meta.seconds,3.5);assert.match(await $('post-recording').locator('option:checked').textContent(),/降噪30%.*齒音45%.*呼吸降低35%.*音準修正60%/);
 await $('post-audition-a-edit').click();assert.equal(await $('post-noise').inputValue(),'0','saving B preserves A');await $('post-audition-b-edit').click();assert.equal(await $('post-noise').inputValue(),'30');
 assert.equal(await page.evaluate(async id=>hash(await fixtureStore.blob({id},'voice')),saved),beforeRaw,'saved remix retains original PCM');
 const backingCheck=await page.evaluate(async id=>{const {remixRecording,wavBlob}=await import('/recording-process.mjs'),row=(await fixtureStore.list()).find(x=>x.id===id),c=new AudioContext({sinkId:{type:'none'}});try{const raw=await c.decodeAudioData(await(await fixtureStore.blob(row,'voice')).arrayBuffer()),back=await c.decodeAudioData(await fixtureBacking.arrayBuffer()),volume={voice:0,backing:100},before=await remixRecording(raw,[back],row,200,{volume,effects:{}}),after=await remixRecording(raw,[back],row,200,{volume,effects:row.vocalEffects});return {same:await hash(wavBlob(before))===await hash(wavBlob(after)),length:after.length===before.length};}finally{await c.close();}},saved);assert.deepEqual(backingCheck,{same:true,length:true},'all four leave backing audio and timing alone');
 await page.reload();await initialize();await $('post-effects-panel').locator(':scope > summary').click();await $('post-repair-panel').locator(':scope > summary').click();assert.equal(await $('post-recording').inputValue(),saved);for(const [id,value] of Object.entries(fields))assert.equal(await $(id).inputValue(),value);
 await $('post-scene').selectOption('dream');await $('post-emotion').selectOption('intimate');assert.equal(await $('post-noise').inputValue(),'30');assert.equal(await $('post-pitch-target').inputValue(),'reference','space and emotion leave repairs alone');
 await mkdir('test-results',{recursive:true});await $('post-repair-panel').screenshot({path:'test-results/recording-repair-b.png'});assert.ok(await $('post-repair-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await $('post-audition-reset').click();for(const id of ['post-noise','post-deess','post-breath','post-pitch-correction'])assert.equal(await $(id).inputValue(),'0');assert.equal(await $('post-pitch-target').inputValue(),'chromatic');assert.equal(await $('post-reverb').inputValue(),'20');assert.equal(await $('post-echo-amount').inputValue(),'10');await $('post-audition-a-edit').click();assert.equal(await $('post-noise').inputValue(),'30','B reset leaves A alone');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({defaultsOff:true,abIndependent:true,workerAudio:true,timePreserved:true,rawPreserved:true,archiveReload:true,reset:true,errors}));
}finally{await browser?.close();server.kill();}
