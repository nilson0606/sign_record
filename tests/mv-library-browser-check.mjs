// 「已保存 MV」清單與「清除全部 MV」：用假的本機小幫手（/session、/mv/library）操作真的網頁。
// 用法：node tests/mv-library-browser-check.mjs（PLAYWRIGHT_PACKAGE_ROOT 可指定 playwright 位置）
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const root='D:\\歌單\\vedio';
const mk=(name,mb,minutesAgo)=>({id:name.replace(/[^a-z0-9]/gi,'').toLowerCase().padEnd(64,'0').slice(0,64),name,bytes:mb*1048576,modified:Date.now()-minutesAgo*60000,locked:false});
let entries=[mk('MV_小薇_大叔_11111111.mp4',30,5),mk('MV_Photograph_Nilson_22222222.mp4',40,60),mk('MV_天黑黑_大叔_33333333.mp4',20,600)];
const deletes=[];
let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
  const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.hostname==='127.0.0.1'&&url.port==='4274'){
      if(url.pathname==='/session')return route.fulfill({json:{token:'test'}});
      if(url.pathname==='/mv/library'&&req.method()==='GET')return route.fulfill({json:{root,entries,bytes:entries.reduce((s,e)=>s+e.bytes,0)}});
      if(url.pathname==='/mv/library'&&req.method()==='DELETE'){const body=req.postDataJSON();assert.equal(req.headers()['x-karaoke-token'],'test');deletes.push(body);const gone=entries.filter(e=>body.ids.includes(e.id));entries=entries.filter(e=>!body.ids.includes(e.id));return route.fulfill({json:{deleted:gone.map(e=>e.id),bytes:gone.reduce((s,e)=>s+e.bytes,0)}});}
      if(url.pathname.startsWith('/mv/library/')){assert.equal(url.searchParams.get('root'),root);return route.fulfill({body:Buffer.from('fake-mp4'),contentType:'video/mp4'});}
      return route.fulfill({status:404,json:{error:'not mocked'}});
    }
    if(url.pathname==='/app.mjs')return route.fulfill({body:'',contentType:'text/javascript'});
    if(url.hostname==='mv.test')try{const name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!/^[a-z0-9-]+\.(html|mjs|css)$/.test(name))return route.abort();return route.fulfill({body:await readFile(name),contentType:name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});}catch{return route.abort();}
    return route.abort();
  });
  await page.goto('http://mv.test/');
  await page.evaluate(async()=>{const {createRecordingPost}=await import('/recording-post.mjs');window.post=createRecordingPost({store:{async blob(){return new Blob();}},stop:async()=>{},pause(){},download(){},onDelete(){},reference:()=>null});post.refresh([]);});
  const panel=page.locator('#mv-library-panel');
  assert.equal(await panel.evaluate(el=>el.open),false,'collapsed by default');
  assert.equal(await page.locator('#recording-post #mv-library-panel').count(),1,'inside 02 post-processing');
  await page.locator('#mv-library-panel > summary').click();
  await page.waitForFunction(()=>document.querySelectorAll('#mv-library-list .mv-entry').length===3);
  const titles=await page.locator('#mv-library-list strong').allTextContents();
  assert.deepEqual(titles,['小薇 · 大叔','Photograph · Nilson','天黑黑 · 大叔'],'newest first, readable names');
  assert.match(await page.locator('#mv-library-status').textContent(),/共 3 部，90\.0 MB/);
  assert.match(await page.locator('#mv-library-path').textContent(),/vedio/);
  await page.locator('#mv-library-search').fill('大叔');
  assert.equal(await page.locator('#mv-library-list .mv-entry').count(),2);
  assert.match(await page.locator('#mv-library-status').textContent(),/符合「大叔」的有 2 部/);
  await page.locator('#mv-library-search').fill('photo');
  assert.deepEqual(await page.locator('#mv-library-list strong').allTextContents(),['Photograph · Nilson']);
  await page.locator('#mv-library-search').fill('');
  // 播放
  await page.locator('#mv-library-list .mv-entry').nth(1).getByText('播放').click();
  await page.waitForFunction(()=>!document.getElementById('mv-library-video').hidden&&document.getElementById('mv-library-video').src.startsWith('blob:'));
  await page.waitForFunction(()=>document.getElementById('mv-library-status').textContent==='正在播放：Photograph · Nilson');
  // 下載
  // 記下網頁指定的下載檔名（無頭 Chromium 在 Linux 會把非英文檔名改成 download，所以直接看 a.download）
  await page.evaluate(()=>{const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.lastDownloadName=this.download;return click.call(this);};});
  const dl=page.waitForEvent('download');await page.locator('#mv-library-list .mv-entry').nth(0).getByText('下載').click();
  const download=await dl;assert.ok(download);assert.equal(await page.evaluate(()=>window.lastDownloadName),'MV_小薇_大叔_11111111.mp4');
  // 勾選刪除：取消時不刪
  await page.locator('#mv-library-list input').nth(0).check();await page.locator('#mv-library-list input').nth(2).check();
  let dialogText='';page.once('dialog',d=>{dialogText=d.message();void d.dismiss();});
  await page.locator('#mv-library-delete').click();await page.waitForTimeout(200);
  assert.match(dialogText,/刪除 2 部 MV（50\.0 MB）/);assert.match(dialogText,/小薇 · 大叔\n天黑黑 · 大叔/);assert.equal(deletes.length,0,'cancel keeps files');
  page.once('dialog',d=>void d.accept());await page.locator('#mv-library-delete').click();
  await page.waitForFunction(()=>document.querySelectorAll('#mv-library-list .mv-entry').length===1);
  assert.deepEqual(deletes.at(-1),{root,ids:[mk('MV_小薇_大叔_11111111.mp4',0,0).id,mk('MV_天黑黑_大叔_33333333.mp4',0,0).id]});
  assert.match(await page.locator('#mv-library-status').textContent(),/已刪除 2 部，釋出 50\.0 MB/);
  // 清除全部 MV：先取消、再確認
  page.once('dialog',d=>{dialogText=d.message();void d.dismiss();});await page.locator('#mv-clear-all').click();
  await page.waitForFunction(()=>document.getElementById('mv-clear-result').textContent.includes('已取消'));
  assert.match(dialogText,/清除全部 1 部 MV（40\.0 MB）/);assert.equal(deletes.length,1);
  page.once('dialog',d=>void d.accept());await page.locator('#mv-clear-all').click();
  await page.waitForFunction(()=>document.getElementById('mv-clear-result').textContent.includes('清理完成'));
  assert.match(await page.locator('#mv-clear-result').textContent(),/已刪除 1 部 MV，釋出 40\.0 MB/);
  await page.waitForFunction(()=>document.getElementById('mv-library-status').textContent.includes('目前沒有已保存的 MV'));
  assert.equal(await page.locator('#mv-library-video').isHidden(),true,'preview stopped after clearing');
  // 沒有 MV 時按清除全部
  await page.locator('#mv-clear-all').click();await page.waitForFunction(()=>document.getElementById('mv-clear-result').textContent.includes('目前沒有可清理的 MV'));
  // 英文
  await page.evaluate(async()=>{const {setLanguage}=await import('/i18n.mjs');setLanguage('en');});
  await page.waitForFunction(()=>document.querySelector('#mv-library-panel > summary strong').textContent.includes('Saved music videos'));
  assert.equal(await page.locator('#mv-library-delete').textContent(),'Delete selected videos');
  assert.equal(await page.locator('#mv-library-search').getAttribute('placeholder'),'Search by song or singer');
  await page.locator('#mv-library-refresh').click();await page.waitForFunction(()=>document.getElementById('mv-library-status').textContent==='No saved music videos yet.');
  assert.deepEqual(errors,[]);
  console.log('PASS: saved MV list (collapsed, newest first, search, play, download, delete with confirm/cancel) and Clear all music videos.');
}finally{await browser?.close();}
