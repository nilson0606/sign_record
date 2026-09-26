import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const original=window.setTimeout.bind(window);
  window.setTimeout=(fn,ms,...args)=>original(fn,ms===20000?80:ms,...args);
  window.players=[];
  window.YT={Player:class {
   constructor(id,options){this.options=options;this.ready=false;this.number=window.players.push(this);if(this.number!==1)original(()=>{this.ready=true;options.events.onReady({target:this})},10)}
   cueVideoById(id){if(!this.ready)throw new Error('cue before ready');this.id=id}
   pauseVideo(){}getPlayerState(){return 5}getCurrentTime(){return 0}destroy(){this.destroyed=true}
  }};
 });
 await page.route('http://127.0.0.1:4274/**',r=>r.fulfill({json:{features:[],recordings:[],songs:[]}}));
 await page.goto('http://localhost:4273/',{waitUntil:'domcontentloaded'});
 await page.locator('#url').fill('https://www.youtube.com/watch?v=fU_imFFvalQ');
 await page.locator('#song-form button').click();
 await page.waitForFunction(()=>document.querySelector('#player-status').textContent.includes('逾時'));
 await page.locator('#song-form button').click();
 await page.waitForFunction(()=>!document.querySelector('#player-status').textContent.includes('正在載入'));
 assert.equal(await page.evaluate(()=>window.players.length),2,'retry must create a fresh player after initialization timeout');
 assert.match(await page.locator('#player-status').textContent(),/播放/);
 assert.equal(await page.evaluate(()=>window.players[0].destroyed),true);
 const readyStatus=await page.locator('#player-status').textContent();
 await page.evaluate(()=>{window.players[0].options.events.onReady({target:window.players[0]});window.players[0].options.events.onError({data:153});window.players[0].options.events.onStateChange({data:1});});
 assert.equal(await page.locator('#player-status').textContent(),readyStatus,'late callbacks from failed player must not change current UI');
 assert.equal(await page.evaluate(()=>window.players.length),2);
 assert.deepEqual(errors,[]);
 console.log('Player timeout -> retry -> fresh ready player; stale ready ignored; no page errors.');
}finally{await browser.close()}
