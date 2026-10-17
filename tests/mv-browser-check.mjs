import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {handleMV,stopMV,mvBusy} from '../mv-server.mjs';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const root=path.resolve('.runtime/mv-check');await mkdir(root,{recursive:true});
const n=48000*4,wav=Buffer.alloc(44+n*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(n*2,40);
for(let i=0;i<n;i++){const t=i/48000,amp=t<2?.06:.4;wav.writeInt16LE(Math.round(amp*Math.sin(2*Math.PI*(t<2?220:1000)*t)*32767),44+i*2);}
const server=createServer((req,res)=>{void handleMV(req,res,{getLibrary:async()=>root});});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
let browser,uploadedAudio;
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.hostname==='127.0.0.1'&&url.port==='4274'){
      if(url.pathname==='/session')return route.fulfill({json:{token:'test'}});
      if(url.pathname==='/arrangements/library')return route.fulfill({json:{records:[]}});
      if(url.pathname==='/voicelab')return route.fulfill({json:{installed:true,models:[{id:'ver3'}]}});
      if(url.pathname==='/voicelab/jobs')return route.fulfill({json:{id:'fixture',stage:'ready',result:{settings:req.postDataJSON().settings,sampleRate:48000,sourceSamples:n,outputSamples:n}}});
      if(url.pathname.startsWith('/voicelab/jobs/')||url.pathname.startsWith('/library/'))return route.fulfill({body:wav,contentType:'audio/wav'});
      if(url.pathname==='/mv/jobs'&&req.method()==='POST')uploadedAudio=req.postDataBuffer();
      const response=await fetch(base+url.pathname+url.search,{method:req.method(),headers:{'Content-Type':'application/octet-stream'},...(req.method()==='POST'?{body:req.postDataBuffer()}: {})});
      return route.fulfill({status:response.status,contentType:response.headers.get('content-type'),body:Buffer.from(await response.arrayBuffer())});
    }
    if(url.pathname==='/app.mjs')return route.fulfill({body:'',contentType:'text/javascript'});
    if(url.hostname==='mv.test')try{const name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!/^[a-z-]+\.(html|mjs|css)$/.test(name))return route.abort();return route.fulfill({body:await readFile(name),contentType:name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});}catch{return route.abort();}
    return route.abort();
  });
  await page.goto('http://mv.test/');
  await page.evaluate(async bytes=>{const {createRecordingPost}=await import('/recording-post.mjs');window.savedMix=new Blob([new Uint8Array(bytes)],{type:'audio/wav'});window.post=createRecordingPost({store:{async blob(row){window.mvBlobRow=row.id;return savedMix;}},stop:async()=>{},pause(){},download(){},onDelete(){},reference:()=>({cacheId:'fixture',title:'親愛的你怎麼不在身邊',duration:4,hasPreview:true})});post.refresh([]);},Array.from(wav));
  assert.equal(await page.locator('#selected-recording-mv').isDisabled(),true);
  assert.equal(await page.locator('#voicelab-panel #mv-panel').count(),0);
  assert.equal(await page.locator('#recording-post > #mv-panel').count(),1);
  await page.locator('#voicelab-panel > summary').click();await page.locator('#voicelab-enable').check();await page.waitForFunction(()=>document.getElementById('voicelab-status').textContent.includes('已就緒'));
  await page.locator('#voicelab-generate').click();await page.waitForFunction(()=>!document.getElementById('voicelab-result').hidden);
  await page.locator('#voicelab-backing').uncheck();
  await page.locator('#voicelab-mv').click();await page.waitForFunction(()=>document.getElementById('mv-title').value==='親愛的你怎麼不在身邊');
  assert.match(await page.locator('#mv-source').textContent(),/Voice Lab/);
  await page.locator('#mv-generate').click();assert.match(await page.locator('#mv-status').textContent(),/請填寫/);assert.equal(mvBusy(),false);
  await page.locator('#mv-artist').fill('測試翻唱者');await page.locator('#mv-generate').click();
  await page.waitForFunction(()=>!document.getElementById('mv-result').hidden||document.getElementById('mv-status').textContent.includes('失敗'),null,{timeout:120000});
  const status=await page.locator('#mv-status').textContent();assert.match(status,/MV 已完成/);
  await page.waitForFunction(()=>document.getElementById('mv-video').readyState>=1);
  const video=await page.locator('#mv-video').evaluate(v=>({width:v.videoWidth,height:v.videoHeight,seconds:v.duration,readyState:v.readyState}));assert.equal(video.width,1920);assert.equal(video.height,1080);assert.ok(Math.abs(video.seconds-4)<.1);
  const file=status.split('保存位置：')[1];assert.equal(path.dirname(file),path.join(root,'vedio'));
  const run=args=>{const p=spawnSync('ffmpeg',['-v','error',...args],{maxBuffer:10*1024*1024,windowsHide:true});assert.equal(p.status,0,p.stderr?.toString());return p.stdout;};
  const a=run(['-ss','1','-i',file,'-frames:v','1','-vf','crop=1600:300:160:610,scale=160:30','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
  const b=run(['-ss','3','-i',file,'-frames:v','1','-vf','crop=1600:300:160:610,scale=160:30','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);assert.notDeepEqual(a,b,'spectrum must react to actual audio');
  const pcm=run(['-i',file,'-vn','-af','pan=mono|c0=c0','-ar','48000','-f','f32le','pipe:1']);let squares=0;for(let i=0;i<pcm.length;i+=4)squares+=pcm.readFloatLE(i)**2;const rms=Math.sqrt(squares/(pcm.length/4)),expected=Math.sqrt((.06**2+.4**2)/4);assert.ok(Math.abs(rms-expected)<.008,`audio level ${rms} vs ${expected}`);
  run(['-y','-ss','3','-i',file,'-frames:v','1',path.join(root,'preview.png')]);
  await page.locator('#mv-video').evaluate(v=>v.play());await page.waitForFunction(()=>document.getElementById('mv-video').currentTime>.1);await page.locator('#mv-video').evaluate(v=>v.pause());
  const downloadPromise=page.waitForEvent('download');await page.locator('#mv-download').click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/\.mp4$/);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',...video,audioRms:rms,animatedSpectrum:true,download:download.suggestedFilename(),file}));
  // Postprocessing uses the selected saved mix, without re-applying pending controls.
  await page.locator('#voicelab-enable').uncheck();
  await page.evaluate(()=>post.refresh([{id:'saved-post',title:'已後製成品',created:Date.now(),seconds:4,complete:true,mode:'mix',bytes:savedMix.size}]));
  assert.equal(await page.locator('#selected-recording-mv').isEnabled(),true);
  await page.locator('#selected-recording-mv').click();
  await page.waitForFunction(()=>document.getElementById('mv-title').value==='已後製成品');
  assert.equal(await page.evaluate(()=>mvBlobRow),'saved-post');
  assert.match(await page.locator('#mv-source').textContent(),/已保存後處理成品/);
  assert.equal(await page.locator('#mv-panel').isVisible(),true,'MV works with Voice Lab disabled');
  await page.evaluate(()=>post.refresh([]));
  await page.locator('#mv-generate').click();
  await page.waitForFunction(()=>!document.getElementById('mv-result').hidden,null,{timeout:120000});
  assert.deepEqual(uploadedAudio,wav,'exact saved mix is used, even after changing selected recording');
  assert.match(await page.locator('#mv-status').textContent(),/MV 已完成/);
  assert.deepEqual(errors,[]);
  console.log('PASS: saved postprocessing mix renders to MV with Voice Lab disabled; exact audio snapshot preserved.');
  // Verify cancellation closes the encoder and returns a terminal state.
  const created=await(await fetch(base+'/mv/jobs?'+new URLSearchParams({title:'取消測試',artist:'測試'}),{method:'POST',body:wav})).json();
  const cancelled=await(await fetch(base+'/mv/jobs/'+created.id,{method:'DELETE'})).json();assert.equal(cancelled.stage,'cancelled');assert.equal(mvBusy(),false);
  const missing=await fetch(base+'/mv/jobs/'+created.id+'/result');assert.equal(missing.status,409);console.log('PASS: cancelled job has no published result.');
}finally{await browser?.close();await stopMV();await new Promise(r=>server.close(r));}
