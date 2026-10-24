// 貼上 YouTube 網址自動載入＋分段時間軸「要錄的這段亮、錄音中閃」：需先啟動 node server.mjs（4273）。
// 用法：node tests/url-autoload-browser-check.mjs（PLAYWRIGHT_PACKAGE_ROOT 可指定 playwright 位置）
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.loads=[];
    window.YT={Player:class{
      constructor(mount,options){this.id=options.videoId;window.loads.push(this.id);setTimeout(()=>options.events.onReady({target:this}),10);}
      cueVideoById(id){this.id=id;window.loads.push(id);}
      getVideoData(){return {video_id:this.id};}
      pauseVideo(){}playVideo(){}getPlayerState(){return 5}getCurrentTime(){return 0}destroy(){}
    }};
  });
  await page.route('http://127.0.0.1:4274/**',r=>r.fulfill({json:{features:[],recordings:[],songs:[]}}));
  await page.goto('http://localhost:4273/',{waitUntil:'domcontentloaded'});
  const url=page.locator('#url'),loads=()=>page.evaluate(()=>window.loads.slice());
  // 1) 貼上網址：不用按鈕，約 0.5 秒後自動載入
  await url.fill('https://www.youtube.com/watch?v=fU_imFFvalQ');
  await page.waitForTimeout(250);assert.deepEqual(await loads(),[],'waits ~0.5 s before loading');
  await page.waitForFunction(()=>window.loads.length===1);
  assert.deepEqual(await loads(),['fU_imFFvalQ']);
  // 2) 同一部影片（換成短網址）不重載
  await url.fill('https://youtu.be/fU_imFFvalQ');await page.waitForTimeout(900);
  assert.deepEqual(await loads(),['fU_imFFvalQ'],'same video is not reloaded');
  // 3) 打到一半（無效網址）不載入
  await url.fill('https://www.youtube.com/watch?v=');await page.waitForTimeout(900);
  assert.equal((await loads()).length,1,'invalid link does nothing');
  // 4) 換另一部：自動切換
  await url.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.waitForFunction(()=>window.loads.length===2);assert.equal((await loads())[1],'dQw4w9WgXcQ');
  // 5) 連續輸入只載入最後一次
  await url.fill('https://www.youtube.com/watch?v=aaaaaaaaaaa');await page.waitForTimeout(200);
  await url.fill('https://www.youtube.com/watch?v=bbbbbbbbbbb');await page.waitForTimeout(900);
  assert.deepEqual((await loads()).slice(2),['bbbbbbbbbbb'],'debounced: only the last link loads');
  // 6) 唱歌／錄音中：不切換，只提示
  await page.evaluate(()=>{document.getElementById('player-section').dataset.workflow=JSON.stringify({phase:'singing',hasTake:true});});
  await url.fill('https://www.youtube.com/watch?v=ccccccccccc');await page.waitForTimeout(900);
  assert.equal((await loads()).length,3,'no switch while singing');
  assert.match(await page.locator('#player-status').textContent(),/網址不會自動切換/);
  // 7) 按「載入影片」仍可用，且按下後不會再自動重複載入
  await page.evaluate(()=>{document.getElementById('player-section').dataset.workflow='{}';});
  await url.fill('https://www.youtube.com/watch?v=ddddddddddd');await page.locator('#song-form button').click();
  await page.waitForTimeout(900);assert.deepEqual((await loads()).slice(3),['ddddddddddd'],'button loads once, timer cancelled');
  // 分段時間軸：要錄的段亮、其他暗；錄音中那段閃（亮度動畫）
  await page.evaluate(()=>{const t=document.getElementById('segment-timeline');t.hidden=false;t.closest('[hidden]')?.removeAttribute('hidden');t.replaceChildren(...['segment-block','segment-block selected','segment-block'].map((c,i)=>{const b=document.createElement('button');b.className=c;b.textContent=String(i+1);b.style.width='33%';return b;}));});
  const style=i=>page.evaluate(i=>{const s=getComputedStyle(document.querySelectorAll('#segment-timeline .segment-block')[i]);return {bg:s.backgroundColor,opacity:Number(s.opacity),anim:s.animationName};},i);
  const [other,chosen]=[await style(0),await style(1)];
  assert.ok(chosen.opacity===1&&other.opacity<.8,'selected bright, others dimmed');assert.notEqual(chosen.bg,other.bg);
  assert.equal(chosen.anim,'none','not blinking before recording');
  // 錄音中所有色塊都會鎖住（disabled），正在錄的那段仍要亮、要閃
  await page.evaluate(()=>{const all=document.querySelectorAll('#segment-timeline .segment-block');for(const b of all)b.disabled=true;all[1].classList.add('recording');});
  const rec=await style(1);assert.equal(rec.anim,'segment-recording','recording segment blinks');assert.equal(rec.opacity,1,'stays bright while locked');
  assert.equal((await style(0)).anim,'none');assert.ok((await style(0)).opacity<.8);
  // 英文提示
  await page.evaluate(async()=>{const {setLanguage}=await import('/i18n.mjs');setLanguage('en');document.getElementById('player-section').dataset.workflow=JSON.stringify({phase:'singing',hasTake:true});});
  await url.fill('https://www.youtube.com/watch?v=eeeeeeeeeee');await page.waitForTimeout(900);
  assert.match(await page.locator('#player-status').textContent(),/will not switch automatically/);
  assert.deepEqual(errors,[]);
  console.log('PASS: YouTube link auto-loads after ~0.5 s (debounced, same video skipped, blocked while singing with a hint, button still works); recording segment is bright and blinks, others dimmed.');
}finally{await browser.close();}
