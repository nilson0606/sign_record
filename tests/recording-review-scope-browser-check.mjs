import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const html='<p id="recording-status"></p><section id="recording-review"><select id="recording-review-take"></select><select id="recording-review-mode"><option value="voice">voice</option></select><button id="recording-review-listen">listen</button><button id="recording-review-save">save</button><button id="recording-review-delete">delete</button><button id="recording-review-delete-song">delete song</button><p id="recording-review-status"></p><audio id="recording-review-audio" hidden></audio></section>';
const server=http.createServer(async(req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end(html);}if(!/^\/[a-z-]+\.mjs$/.test(req.url)){res.writeHead(404);return res.end();}try{res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('..'+req.url,import.meta.url)));}catch{res.writeHead(404);res.end();}});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(async()=>{
  const {createRecordingReview}=await import('/recording-review.mjs');const refs={wine:{videoId:'wine',cacheId:'wine-key4',pitchShift:4},wei:{videoId:'wei',cacheId:'wei-key-4',pitchShift:-4},wei0:{videoId:'wei',cacheId:'wei-key0',pitchShift:0}};
  let rows=[['wine1','wine'],['wei1','wei'],['wei2','wei'],['wei0','wei0'],['saved','wei'],['segment','wei']].map(([id,ref])=>({id,title:id,created:Date.now(),seconds:100,complete:true,rawBytes:100,postPending:id!=='saved',segmentTake:id==='segment'?{}:null,post:{reference:refs[ref]}}));
  globalThis.current=refs.wine;globalThis.refs=refs;globalThis.deleted=[];globalThis.writes=[];
  const store={list:async()=>globalThis.listPending?await new Promise(r=>globalThis.resolveList=()=>r(rows)):rows,blob:()=>new Promise(r=>globalThis.resolveBlob=r),save:async row=>writes.push(row.id),delete:async id=>{deleted.push(id);rows=rows.filter(r=>r.id!==id);}};
  globalThis.review=createRecordingReview({store,reference:()=>current,isRecording:()=>false,pause:()=>{},loadStem:()=>{},onChanged:()=>review.refresh(rows)});
  globalThis.change=ref=>{current=ref;review.referenceChanged();};globalThis.reloadRows=id=>review.refresh(rows,id);reloadRows();
 });
 const ids=()=>page.locator('#recording-review-take option').evaluateAll(a=>a.map(x=>x.value));
 assert.deepEqual(await ids(),['wine1']);await page.evaluate(()=>change(refs.wei));assert.deepEqual(await ids(),['wei1','wei2']);await page.evaluate(()=>reloadRows('wine1'));assert.deepEqual(await ids(),['wei1','wei2']);
 await page.locator('#recording-review-listen').click();await page.waitForFunction(()=>!!globalThis.resolveBlob);await page.evaluate(()=>{change(refs.wine);resolveBlob(new Blob([]));});await page.waitForTimeout(100);assert.deepEqual(await ids(),['wine1']);assert.equal(await page.locator('#recording-review-audio').getAttribute('src'),null);assert.equal(await page.locator('#recording-review-status').textContent(),'');
 await page.evaluate(()=>change(null));assert.equal(await page.locator('#recording-review').isHidden(),true);assert.deepEqual(await ids(),[]);
 await page.evaluate(()=>{change(refs.wei);globalThis.listPending=true;});await page.locator('#recording-review-delete-song').click();await page.waitForFunction(()=>!!globalThis.resolveList);await page.evaluate(()=>{change(refs.wine);resolveList();});await page.waitForFunction(()=>!document.querySelector('#recording-review-delete-song').disabled);assert.deepEqual(await page.evaluate(()=>deleted),[]);
 await page.evaluate(()=>{globalThis.listPending=false;change(refs.wei0);});assert.deepEqual(await ids(),['wei0']);page.once('dialog',d=>d.accept());await page.locator('#recording-review-delete-song').click();await page.waitForFunction(()=>document.querySelector('#recording-review').hidden);assert.deepEqual(await page.evaluate(()=>deleted),['wei0']);await page.evaluate(()=>change(refs.wei));assert.deepEqual(await ids(),['wei1','wei2']);assert.deepEqual(await page.evaluate(()=>writes),[]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({pass:true,currentSongAndKeyOnly:true,unloadedHidden:true,lateAuditionCancelled:true,staleDeleteCancelled:true,otherSongsPreserved:true}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
