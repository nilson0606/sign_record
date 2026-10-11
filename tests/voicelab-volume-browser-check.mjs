import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const site='http://localhost:4397';
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4397'},windowsHide:true,stdio:['ignore','pipe','pipe']});
function tone(hz,amp){const n=96000,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(amp*Math.sin(2*Math.PI*hz*i/48000)*32767),44+i*2);return b;}
const original=tone(440,.1),converted=tone(880,.2),backing=tone(660,.08);
let browser,settings,generated=0;
try{
 await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j);});
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.mjs',r=>r.fulfill({body:'',contentType:'text/javascript'}));
 await page.route('http://127.0.0.1:4274/**',async r=>{
  const req=r.request(),p=new URL(req.url()).pathname;let json;
  if(p==='/session')json={token:'fixture'};
  else if(p==='/arrangements/library')json={records:[]};
  else if(p==='/voicelab')json={installed:true,models:['ver3','mosi_ver1','n_1_ver1','n2_ver','n3_ver','n4_ver'].map(id=>({id})),pitchShiftRange:[-12,12],advancedSettingsVersion:1,f0Methods:['rmvpe','fcpe','crepe']};
  else if(p==='/voicelab/jobs'){settings=req.postDataJSON().settings;generated++;json={id:'fixture',stage:'ready',result:{settings,pitchShift:settings.pitchShift,sampleRate:48000,sourceSamples:96000,outputSamples:96000}};}
  else if(p.endsWith('/vocals')||p.endsWith('/source'))return r.fulfill({body:original,contentType:'audio/wav'});
  else if(p.endsWith('/result'))return r.fulfill({body:converted,contentType:'audio/wav'});
  else if(p.endsWith('/accompaniment'))return r.fulfill({body:backing,contentType:'audio/wav'});
  else throw Error('Unexpected fixture route '+p);
  return r.fulfill({json});
 });
 await page.goto(site);await page.evaluate(async()=>{
  const {createVoiceLab}=await import('/voicelab-client.mjs');window.saved=[];window.savedBlobs=[];
  document.getElementById('voicelab-source').value='original';
  createVoiceLab({store:{saveRemix:async(meta,mix,voice)=>{saved.push(meta);savedBlobs.push({mix,voice});}},getSelected:()=>null,getPosition:()=>0,getReference:()=>({cacheId:'fixture',title:'Volume fixture',duration:2,hasPreview:true}),beforePlay(){},onMakeMV:data=>{window.mvInput=data;}});
  window.measure=async blob=>{const c=new AudioContext({sampleRate:48000,sinkId:{type:'none'}}),b=await c.decodeAudioData(await blob.arrayBuffer());await c.close();const x=b.getChannelData(0),amp=hz=>Math.abs(x.reduce((n,v,i)=>n+v*Math.sin(2*Math.PI*hz*i/48000),0)*2/x.length);return{voice:amp(880),original:amp(440),backing:amp(660),peak:Math.max(...x.subarray(0,96000)),length:x.length};};
  HTMLAnchorElement.prototype.click=function(){window.downloadBlob=fetch(this.href).then(r=>r.blob());};
 });
 const $=id=>page.locator('#voicelab-'+id);
 await $('panel').locator(':scope > summary').click();await $('enable').check();await page.waitForFunction(()=>document.getElementById('voicelab-status').textContent.includes('已就緒'));
 for(const model of ['mosi_ver1','n_1_ver1','n2_ver','n3_ver','n4_ver']){await $('model').selectOption(model);assert.equal(await $('model').inputValue(),model);}
 assert.equal(await $('advanced').evaluate(e=>e.open),false,'advanced settings start collapsed');assert.equal(await $('index-rate').isVisible(),false);
 await $('advanced').locator(':scope > summary').click();assert.equal(await $('autotune-strength').isDisabled(),true);
 await $('volume-envelope').fill('0.4');await $('f0-method').selectOption('fcpe');await $('pitch').fill('3');await $('autotune').check();await $('autotune-strength').fill('0.5');await $('index-rate').fill('0.6');await $('protect').fill('0.2');
 await $('advanced').locator(':scope > summary').click();assert.match(await $('advanced-summary').textContent(),/FCPE.*\+3.*包絡 0.4.*修音50%/);
 assert.equal(await $('voice-volume').isVisible(),true);assert.equal(await $('backing-volume').isVisible(),true);
 await $('voice-volume').fill('50');await $('backing-volume').fill('150');
 await $('generate').click();await page.waitForFunction(()=>!document.getElementById('voicelab-result').hidden);await $('match').uncheck();
 assert.equal(await $('voice-volume').inputValue(),'50');assert.equal(await $('backing-volume').inputValue(),'150');
 assert.deepEqual(settings,{model:'n4_ver',pitchShift:3,indexRate:.6,protect:.2,volumeEnvelope:.4,f0Method:'fcpe',autotune:true,autotuneStrength:.5});
 async function volume(id,value){await $(id).fill(String(value));await $(id).dispatchEvent('input');}
 async function listen(side='ai'){await $('listen-'+side).click();await page.waitForFunction(()=>!document.getElementById('voicelab-audio').paused);return page.evaluate(async()=>measure(await(await fetch(document.getElementById('voicelab-audio').src)).blob()));}
 const preset=await listen();assert.ok(Math.abs(preset.voice-.1)<.0001&&Math.abs(preset.backing-.12)<.0001);
 await volume('voice-volume',100);await volume('backing-volume',100);
 const full=await listen();assert.ok(Math.abs(full.voice-.2)<.0001&&Math.abs(full.backing-.08)<.0001);
 await volume('voice-volume',0);const muted=await listen();assert.ok(muted.voice<.0001&&Math.abs(muted.backing-.08)<.0001);
 await volume('voice-volume',50);await volume('backing-volume',0);const vocal=await listen();assert.ok(Math.abs(vocal.voice-.1)<.0001&&vocal.backing<.0001);
 await volume('backing-volume',150);const adjusted=await listen();assert.ok(Math.abs(adjusted.voice-.1)<.0001&&Math.abs(adjusted.backing-.12)<.0001);
 await $('mv').click();await page.waitForFunction(()=>!!window.mvInput);const mv=await page.evaluate(async()=>measure(mvInput.blob));assert.ok(Math.abs(mv.voice-adjusted.voice)<.00001&&Math.abs(mv.backing-adjusted.backing)<.00001,'MV receives the exact adjusted Voice Lab mix');
 const compare=await listen('original');assert.ok(Math.abs(compare.original-.05)<.0001&&Math.abs(compare.backing-.12)<.0001);
 await $('download').click();await page.waitForFunction(()=>!!window.downloadBlob);const download=await page.evaluate(async()=>measure(await downloadBlob));assert.ok(Math.abs(download.voice-adjusted.voice)<.00001&&Math.abs(download.backing-adjusted.backing)<.00001);
 await $('save').click();await page.waitForFunction(()=>saved.length===1);
 const saved=await page.evaluate(async()=>({meta:saved[0],mix:await measure(savedBlobs[0].mix),voice:await measure(savedBlobs[0].voice)}));
 assert.equal(saved.meta.voicelab.voiceVolume,50);assert.equal(saved.meta.voicelab.backingVolume,150);assert.equal(saved.meta.fixedMixGains.voice,.5);assert.equal(saved.meta.fixedMixGains.backing,1.5);
 assert.deepEqual(saved.meta.voicelab.report.settings,settings,'saved recording retains advanced conversion settings');
 assert.ok(Math.abs(saved.mix.voice-.1)<.0001&&Math.abs(saved.mix.backing-.12)<.0001);assert.ok(Math.abs(saved.voice.voice-.2)<.0001,'dry voice retains original gain');
 await volume('voice-volume',0);await volume('backing-volume',0);const silent=await listen();assert.equal(silent.peak,0);assert.equal(silent.length,96000);
 await $('save').click();await page.waitForFunction(()=>saved.length===2);assert.equal(await page.evaluate(async()=>{const a=new Uint8Array(await savedBlobs[0].voice.arrayBuffer()),b=new Uint8Array(await savedBlobs[1].voice.arrayBuffer());return a.length===b.length&&a.every((v,i)=>v===b[i]);}),true,'volume never rewrites dry vocal');
 assert.equal(generated,1,'all volume changes reuse generated voice');
 await $('advanced').locator(':scope > summary').click();await $('volume-envelope').fill('0.5');assert.equal(await $('save').isDisabled(),true);assert.equal(await $('mv').isDisabled(),true);
 await $('reset').click();assert.equal(await $('pitch').inputValue(),'0');assert.equal(await $('f0-method').inputValue(),'rmvpe');assert.equal(await $('volume-envelope').inputValue(),'1');assert.equal(await $('autotune').isChecked(),false);assert.equal(await $('autotune-strength').isDisabled(),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: all added models selectable; independent volume, mute, original/AI comparison, download/save parity, dry vocal preservation and no regeneration.');
}finally{await browser?.close();server.kill();}
