import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const server=http.createServer(async(req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<html lang="zh-Hant"><link rel="stylesheet" href="/style.css"><body><main><section class="card"><h2>本機歌曲庫</h2><ul id="songs" class="library-list"></ul></section></main></body></html>');}
 if(!/^\/[a-z-]+\.(mjs|css)$/.test(req.url)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(new URL('..'+req.url,import.meta.url)));}catch{res.writeHead(404);res.end();}
});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1050,height:750}});await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(async()=>{
  const {recordingReviewKey}=await import('/recording-review.mjs');const {libraryRecordingCounts,updateLibraryRecordingBadges}=await import('/library-recordings.mjs');
  document.getElementById('songs').innerHTML='<li class="song-key-group"><details open><summary>酒家</summary><ul class="library-list key-versions"><li><button id="wine" class="song-choice" aria-current="true"><strong>酒家 · 升 4 Key</strong><small>主唱模式 · 含伴奏試聽</small></button></li><li><button id="other" class="song-choice"><strong>酒家 · 原調</strong><small>一般人聲 · 含伴奏試聽</small></button></li></ul></details></li><li><button id="wei" class="song-choice"><strong>小薇 · 降 4 Key</strong><small>主唱模式 · 含伴奏試聽</small></button></li>';
  const refs={wine:{cacheId:'wine',pitchShift:4},other:{cacheId:'wine0'},wei:{cacheId:'wei',pitchShift:-4}};
  for(const [id,ref] of Object.entries(refs))document.getElementById(id).dataset.reviewKey=recordingReviewKey(ref);
  window.update=rows=>updateLibraryRecordingBadges(document.getElementById('songs'),libraryRecordingCounts(rows));
  update([{postPending:true,post:{reference:refs.wine}},{segmentTake:{},post:{reference:refs.wine}},{segmentTake:{},post:{reference:refs.wei}}]);
 });
 assert.equal(await page.locator('#wine .song-pending-badge').textContent(),'整首待確認 1 筆 · 分段錄音 1 筆');
 assert.equal(await page.locator('#other .song-pending-badge').isHidden(),true);
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/library-recordings-current.png'});
 await page.evaluate(()=>document.documentElement.dataset.theme='warm');await page.screenshot({path:'test-results/library-recordings-warm.png'});
 await page.locator('summary').click();await page.locator('#wei').focus();await page.evaluate(()=>update([]));
 assert.equal(await page.locator('.has-pending-review').count(),0);
 assert.equal(await page.locator('.song-pending-badge:visible').count(),0);
 assert.equal(await page.locator('#wine').getAttribute('aria-current'),'true');
 assert.equal(await page.locator('#wine').getAttribute('aria-label'),'載入 酒家 · 升 4 Key');
 assert.equal(await page.locator('details').getAttribute('open'),null);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'wei');
 console.log('PASS: pending badges clear, selection/focus/fold preserved, both themes captured');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
