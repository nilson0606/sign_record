import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import {mediaStorageList,deleteMediaStorage,readStorageSelection} from '../media-storage.mjs';
import {handleMV} from '../mv-server.mjs';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const runtime=path.resolve('.runtime'),root=mkdtempSync(path.join(runtime,'storage-check-')),temp=path.join(root,'jobs'),videos=path.join(root,'vedio');mkdirSync(temp);mkdirSync(videos);
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
for(const [i,id]of ids.entries()){const dir=path.join(temp,id);mkdirSync(dir);writeFileSync(path.join(dir,'input.wav'),'fixture');writeFileSync(path.join(dir,'result.json'),JSON.stringify({modelLabel:['舊試聽','轉換中','目前試聽'][i],seconds:20}));}
const movie='MV_清理測試_翻唱者_aabbccdd.mp4',keep='MV_保留影片_翻唱者_11223344.mp4';
const p=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=160x90:r=10','-t','2','-c:v','libx264','-pix_fmt','yuv420p',path.join(videos,movie)],{windowsHide:true});assert.equal(p.status,0,p.stderr?.toString());writeFileSync(path.join(videos,keep),'keep');
let deletes=0,browser;const mvBatches=[];
const apiServer=createServer(async(req,res)=>{
 if(req.url.startsWith('/mv/'))return handleMV(req,res,{getLibrary:async()=>root});
 try{let data;if(req.url==='/session')data={token:'fixture'};else if(req.url==='/voicelab/storage'){if(req.method==='DELETE'){deletes++;data=deleteMediaStorage(temp,'temp',await readStorageSelection(req),[ids[1]]);}else data=mediaStorageList(temp,'temp',[ids[1]]);}else throw Error('Unexpected route');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));}catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});await new Promise(r=>apiServer.listen(0,'127.0.0.1',r));const api='http://127.0.0.1:'+apiServer.address().port;
const site=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4398'},windowsHide:true,stdio:['ignore','pipe','pipe']});
try{
 await new Promise((r,j)=>{site.stdout.once('data',r);site.once('error',j);});browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage({viewport:{width:1250,height:1000}}),errors=[];let requests=0;page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.mjs',r=>r.fulfill({body:'',contentType:'text/javascript'}));
 await page.route('http://127.0.0.1:4274/**',async route=>{requests++;const req=route.request(),url=new URL(req.url());if(req.method()==='DELETE'&&url.pathname==='/mv/library')mvBatches.push(req.postData());const r=await fetch(api+url.pathname+url.search,{method:req.method(),body:req.postDataBuffer()??undefined});await route.fulfill({status:r.status,body:Buffer.from(await r.arrayBuffer()),contentType:r.headers.get('content-type')||'application/json'});});
 await page.goto('http://localhost:4398');await page.evaluate(async id=>{const {createVoiceLabStorage}=await import('/voicelab-storage-client.mjs');createVoiceLabStorage({getProtectedIds:()=>[id]});},ids[2]);assert.equal(requests,0);
 await page.locator('#voicelab-panel > summary').click();await page.locator('#voicelab-storage > summary').click();
 const $=(kind,id)=>page.locator('#voicelab-storage-'+kind+'-'+id);
 await page.waitForFunction(()=>document.getElementById('voicelab-storage-temp-status').textContent.includes('共 3 項'));
 assert.equal(await page.locator('#voicelab-enable').isChecked(),false);assert.equal(await $('temp','list').locator('input:disabled').count(),2);
 await $('temp','all').click();assert.equal(await $('temp','list').locator('input:checked').count(),1);
 page.once('dialog',d=>d.dismiss());await $('temp','delete').click();assert.equal(deletes,0);assert.ok(existsSync(path.join(temp,ids[0])));
 page.once('dialog',d=>{assert.match(d.message(),/永久刪除/);d.accept();});await $('temp','delete').click();await page.waitForFunction(()=>document.getElementById('voicelab-storage-temp-status').textContent.includes('已刪除 1 項'));
 assert.equal(existsSync(path.join(temp,ids[0])),false);assert.ok(existsSync(path.join(temp,ids[1]))&&existsSync(path.join(temp,ids[2])));
 const row=$('mv','list').locator('.storage-entry').filter({hasText:'清理測試'});await row.getByRole('button',{name:'播放'}).click();await page.waitForFunction(()=>document.getElementById('voicelab-storage-mv-video').currentTime>0);await $('mv','video').evaluate(v=>v.pause());
 await page.locator('#voicelab-storage').screenshot({path:path.join(runtime,'storage-management-preview.png')});
 await row.locator('input').check();page.once('dialog',d=>d.accept());await $('mv','delete').click();await page.waitForFunction(()=>document.getElementById('voicelab-storage-mv-status').textContent.includes('已刪除 1 項'));
 assert.equal(existsSync(path.join(videos,movie)),false);assert.ok(existsSync(path.join(videos,keep)));assert.equal(await $('mv','video').isHidden(),true);assert.deepEqual(errors,[]);
 // One-click cleanup fetches a fresh catalog even with file management collapsed.
 await page.locator('#voicelab-storage > summary').click();await page.locator('#voicelab-panel > summary').click();
 for(let i=0;i<501;i++)writeFileSync(path.join(videos,`MV_bulk_${i.toString(16).padStart(8,'0')}.mp4`),'fixture');
 const foreign=path.join(videos,'original-mv.mp4'),recording=path.join(root,'voice.wav'),model=path.join(root,'voice.pth');
 for(const file of [foreign,recording,model])writeFileSync(file,'preserve');
 const before=mvBatches.length;
 page.once('dialog',d=>{assert.match(d.message(),/全部 502 部/);d.dismiss();});await page.locator('#mv-clear-all').click();
 await page.waitForFunction(()=>document.getElementById('mv-clear-result').textContent.includes('已取消'));
 assert.equal(mvBatches.length,before);assert.ok(existsSync(path.join(videos,keep)));
 const late=path.join(videos,'MV_new_after_confirmation_aabb0011.mp4');
 page.once('dialog',d=>{assert.match(d.message(),/所有歌曲/);writeFileSync(late,'new render');d.accept();});await page.locator('#mv-clear-all').click();
 await page.waitForFunction(()=>document.getElementById('mv-clear-result').textContent.includes('已刪除 502 部'));
 assert.deepEqual(mvBatches.slice(before).map(body=>JSON.parse(body).ids.length),[500,2]);
 assert.equal(mediaStorageList(videos,'mv').entries.length,1);assert.ok(existsSync(late));
 for(const file of [foreign,recording,model])assert.ok(existsSync(file));
 page.once('dialog',d=>d.accept());await page.locator('#mv-clear-all').click();
 await page.waitForFunction(()=>document.getElementById('mv-clear-result').textContent.includes('已刪除 1 部'));
 await page.locator('#mv-clear-all').click();await page.waitForFunction(()=>document.getElementById('mv-clear-result').textContent.includes('沒有可清理'));
 assert.equal(await page.locator('#mv-clear-all').isEnabled(),true);assert.deepEqual(errors,[]);
 console.log('PASS: cleanup without enabling conversion; active/current protection; cancel and confirm; selected MV playback/delete; other files preserved.');
}finally{await browser?.close();site.kill();await new Promise(r=>apiServer.close(r));if(path.dirname(root)===runtime&&path.basename(root).startsWith('storage-check-'))rmSync(root,{recursive:true,force:true});}
