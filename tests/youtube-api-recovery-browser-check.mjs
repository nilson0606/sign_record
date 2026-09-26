import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
try{
 const page=await browser.newPage();let widgetRequests=0;
 await page.addInitScript(()=>{const later=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>later(fn,ms===15000?150:ms,...args)});
 await page.route('http://127.0.0.1:4274/**',r=>r.fulfill({json:{features:[],recordings:[],songs:[]}}));
 // Match the official bootstrap's loading guard: loading stays set if its
 // second script fails, so re-requesting iframe_api alone does not recover.
 await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({contentType:'text/javascript',body:`window.YT ||= {loading:0};if(!YT.loading){YT.loading=1;const s=document.createElement('script');s.id='www-widgetapi-script';s.src='https://www.youtube.com/s/player/fixture/www-widgetapi.vflset/www-widgetapi.js';document.head.append(s)}`}));
 await page.route('https://www.youtube.com/s/player/fixture/**',r=>{
  if(++widgetRequests===1)return r.abort('failed');
  return r.fulfill({contentType:'text/javascript',body:`YT.Player=class {constructor(id,o){setTimeout(()=>o.events.onReady({target:this}),5)}pauseVideo(){}getCurrentTime(){return 0}getPlayerState(){return 5}cueVideoById(){}};onYouTubeIframeAPIReady();`});
 });
 await page.goto('http://localhost:4273/',{waitUntil:'domcontentloaded'});
 await page.locator('#url').fill('https://www.youtube.com/watch?v=fU_imFFvalQ');
 await page.locator('#song-form button').click();
 await page.waitForFunction(()=>/失敗|逾時/.test(document.querySelector('#player-status').textContent));
 await page.locator('#song-form button').click();
 await page.waitForFunction(()=>!document.querySelector('#player-status').textContent.includes('正在載入'));
 assert.equal(widgetRequests,2,'must retry failed widget script, not only the guarded bootstrap');
 assert.equal(await page.locator('#player-status').textContent(),'請按影片上的播放按鈕。');
 console.log('YouTube nested script failure -> retry fetches nested script again -> player ready.');
}finally{await browser.close()}
