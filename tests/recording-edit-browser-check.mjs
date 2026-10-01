import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const port='4388',site='http://localhost:'+port;
const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:port},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser;
try{
 await new Promise((ok,no)=>{server.stdout.once('data',ok);server.stderr.once('data',x=>no(Error(x.toString())));server.once('error',no);});
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true,args:['--mute-audio']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.route('http://127.0.0.1:4274/**',async r=>{
  if(r.request().url().endsWith('/session'))return r.fulfill({json:{token:'fixture'},headers:{'Access-Control-Allow-Origin':site}});
  const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await fixtureBacking.arrayBuffer())));
  return r.fulfill({body:Buffer.from(bytes),contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':site}});
 });
 await page.goto(site);
 await page.evaluate(async()=>{
  const {createRecordingPost}=await import('/recording-post.mjs'),{wavBlob,remixRecording}=await import('/recording-process.mjs');
  const c=new AudioContext({sampleRate:48000,sinkId:{type:'none'}}),rate=c.sampleRate;
  const tone=hz=>{const b=c.createBuffer(1,rate*4,rate),a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=.08*Math.sin(2*Math.PI*hz*i/rate);return b;};
  const raw=tone(440),back=tone(660),voice=wavBlob(raw);window.fixtureBacking=wavBlob(back);
  const meta={id:'original',title:'可還原後製測試',videoId:'M7lc1UVf-VE',mode:'mix',stems:['accompaniment'],mime:'audio/wav',rawMime:'audio/wav',created:Date.now(),seconds:4,complete:true,rawBytes:voice.size,appliedDelayMs:0,balance:{manual:true,voice:100,backing:100},post:{reference:{cacheId:'fixture',duration:4},offsetMs:0,segments:[{offset:0,songTime:0,duration:4}],samples:[]}};
  const savedRaw=await c.decodeAudioData(await voice.arrayBuffer()),savedBack=await c.decodeAudioData(await fixtureBacking.arrayBuffer());
  const mix=wavBlob(await remixRecording(savedRaw,[savedBack],meta,0));meta.bytes=mix.size;
  window.fixtureRows=new Map([[meta.id,{meta,voice,mix}]]);
  const store={list:async()=>[...fixtureRows.values()].map(x=>x.meta).sort((a,b)=>b.created-a.created),blob:async(row,track='mix')=>fixtureRows.get(row.id)[track],saveRemix:async(meta,mix,voice)=>fixtureRows.set(meta.id,{meta,mix,voice})};
  window.fixturePost=createRecordingPost({store,stop:async()=>{},pause:()=>{},download:()=>{},onDelete:()=>{}});fixturePost.refresh(await store.list());
  window.hash=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(',');
  window.originalHash=await hash(mix);window.rawHash=await hash(voice);await c.close();
 });
 const $=id=>page.locator('#'+id),selected=()=>$('post-recording').inputValue();
 async function remix(){const before=await selected();await $('post-remix').click();await page.waitForFunction(id=>document.querySelector('#post-recording').value!==id,before);return selected();}
 await $('post-effects-panel').locator('summary').click();await $('post-edit-panel').locator('summary').click();
 await $('post-reverb').fill('100');await $('post-reverb-space').selectOption('hall');
 assert.equal(await $('post-reverb-decay').inputValue(),'1.8');assert.equal(await $('post-reverb-predelay').inputValue(),'25');
 await $('post-reverb-decay').fill('1.4');await $('post-reverb-predelay').fill('70');
 await $('post-edit-start').fill('0.5');await $('post-edit-end').fill('3.5');await $('post-edit-fadeIn').fill('0.3');await $('post-edit-fadeOut').fill('0.4');
 const child=await remix();
 const check=await page.evaluate(async id=>{const r=fixtureRows.get(id);return {meta:r.meta,rawHash:await hash(r.voice),mixHash:await hash(r.mix),originalHash:await hash(fixtureRows.get('original').mix),oldRaw:rawHash};},child);
 assert.equal(check.meta.vocalEffects.reverb,100);assert.equal(await $('post-reverb').inputValue(),'100');assert.equal(check.meta.seconds,3);assert.equal(check.meta.sourceSeconds,4);assert.equal(check.rawHash,check.oldRaw);assert.equal(check.originalHash,await page.evaluate(()=>originalHash));
 assert.deepEqual(check.meta.postEdit,{version:1,start:.5,end:3.5,fadeIn:.3,fadeOut:.4});
 assert.deepEqual(check.meta.vocalEffects.reverbOptions,{space:'hall',decay:1.4,preDelayMs:70});
 assert.match(await $('post-recording').locator('option:checked').textContent(),/大廳1.4s.*剪輯0.5-3.5秒.*淡入0.3秒.*淡出0.4秒/);
 const repeated=await remix();assert.equal(await page.evaluate(async id=>hash(fixtureRows.get(id).mix),repeated),check.mixHash);
 await page.evaluate(()=>fixtureRows.delete('original'));
 await $('selected-recording-voice').click();await page.waitForFunction(()=>!document.querySelector('#selected-recording-voice').disabled);
 const solo=await page.evaluate(async()=>{const c=new AudioContext({sampleRate:48000,sinkId:{type:'none'}}),a=await c.decodeAudioData(await(await fetch(document.querySelector('#post-audio').src)).arrayBuffer()),x=a.getChannelData(0);function power(hz){let re=0,im=0;for(let i=48000;i<96000;i++){re+=x[i]*Math.cos(2*Math.PI*hz*i/48000);im+=x[i]*Math.sin(2*Math.PI*hz*i/48000);}return Math.hypot(re,im)/24000;}const out={duration:a.duration,voice:power(440),backing:power(660),first:x[0],last:x.at(-1)};await c.close();return out;});
 assert.equal(solo.duration,3);assert.ok(solo.voice>.03&&solo.backing<.0001);assert.equal(solo.first,0);assert.equal(solo.last,0);
 await page.evaluate(()=>{const a=document.querySelector('#post-audio');a.pause();a.currentTime=.25;});
 await $('post-edit-start-now').click();assert.equal(await $('post-edit-start').inputValue(),'0.75');
 await $('post-region-add').click();assert.equal(await page.locator('#post-regions [data-field=start]').inputValue(),'0.75');
 await page.evaluate(id=>fixturePost.select(id,{scroll:false}),repeated);
 await $('post-edit-start').fill('2');await $('post-edit-end').fill('1');const count=await page.evaluate(()=>fixtureRows.size);
 await $('post-remix').click();await page.waitForFunction(()=>document.querySelector('#post-status').textContent.includes('結束必須晚於開始'));assert.equal(await page.evaluate(()=>fixtureRows.size),count);
 await $('post-edit-reset').click();const uncut=await remix();const uncutSeconds=await page.evaluate(id=>fixtureRows.get(id).meta.seconds,uncut);assert.ok(Math.abs(uncutSeconds-5.47)<.001);
 await $('post-effects-reset').click();const restored=await remix();assert.equal(await page.evaluate(async id=>hash(fixtureRows.get(id).mix),restored),check.originalHash,'reset restores full original rendering even after deleting the parent');
 assert.equal(await $('post-edit-end').inputValue(),'');assert.equal(await $('post-edit-fadeIn').inputValue(),'0');assert.equal(await $('post-reverb-space').inputValue(),'classic');
 await mkdir('test-results',{recursive:true});
 for(const width of [1280,390]){await page.setViewportSize({width,height:1000});await $('post-edit-panel').screenshot({path:`test-results/recording-edit-${width}.png`});await $('post-effects-panel').screenshot({path:`test-results/recording-reverb-${width}.png`});assert.ok(await $('post-edit-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1));}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({saved:check.meta.postEdit,reverb:check.meta.vocalEffects.reverbOptions,solo,repeatIdentical:true,sourceRestored:true,mappedPlayhead:true,errors}));
}finally{await browser?.close();server.kill();}
