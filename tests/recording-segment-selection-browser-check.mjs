import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const port='4396',server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:port},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser;
try{
 await new Promise((ok,no)=>{server.stdout.once('data',ok);server.stderr.once('data',x=>no(Error(x.toString())));server.once('error',no);});
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
 if(process.env.CHECK_BASELINE)await page.route('**/recording-segment-ui.mjs',r=>r.fulfill({contentType:'text/javascript',body:execFileSync('git',['show','HEAD:recording-segment-ui.mjs'],{encoding:'utf8'})}));
 await page.goto('http://localhost:'+port);
 await page.evaluate(async()=>{
  const {createSegmentRecording}=await import('/recording-segment-ui.mjs');
  const ref={cacheId:'selection-fixture',title:'選段測試',duration:150,hasPreview:true};
  const parts=[{id:'first',name:'第 1 段',start:0,end:20.228},{id:'second',name:'第 2 段',start:20.228,end:133.743},{id:'third',name:'第 3 段',start:133.743,end:150}];
  localStorage.setItem('karaoke.segment-draft.v1.'+ref.cacheId,JSON.stringify({version:1,key:ref.cacheId,duration:150,parts}));
  window.prepared=[];window.stops=0;window.clock=0;window.state=2;window.mic=true;
  const player={getCurrentTime:()=>clock,getPlayerState:()=>state,pauseVideo(){state=2;},playVideo(){state=1;},seekTo(t){window.clock=t;},isMuted:()=>false,mute(){},unMute(){},setPlaybackRate(){},getPlaybackRate:()=>1};
  window.segment=createSegmentRecording({reference:()=>ref,player:()=>player,micReady:()=>mic,startMic:async()=>{await new Promise(resolve=>window.releaseMic=resolve);window.mic=true;},canEnter:()=>true,pauseOther:()=>segment.referenceChanged(),changed:()=>segment.referenceChanged(),recording:{store:{list:async()=>[]},balanceSettings:()=>({manual:true,voice:100,backing:100}),clearPreview(){},playerState(){},async prepare(ref,fn,options,meta){prepared.push(meta);},async stop(){stops++;return null;}}});
  segment.referenceChanged();segment.enter();
 });
 const $=id=>page.locator('#segment-'+id);
 // A real native selection must survive player state changes and refresh renders.
 await $('part').focus();await $('part').press('Home');await $('part').press('ArrowDown');
 const stableMenu=await page.evaluate(()=>{const option=document.getElementById('segment-part').options[1];segment.playerState(1);segment.referenceChanged();return option===document.getElementById('segment-part').options[1];});assert.equal(stableMenu,true,'refresh retains native menu option nodes');
 assert.equal(await $('part').inputValue(),'1');await $('record').click();await page.waitForFunction(()=>state===1&&prepared.length===1);
 assert.equal(await page.evaluate(()=>prepared[0].segmentTake.partId),'second');assert.ok(Math.abs(await page.evaluate(()=>clock)-15.228)<.001);
 await page.evaluate(()=>window.clock=22.3);await page.waitForTimeout(180);assert.equal(await page.evaluate(()=>segment.busy()),true,'second segment must not stop at the first segment endpoint');
 await page.evaluate(()=>window.clock=135.8);await page.waitForFunction(()=>!segment.busy());assert.equal(await page.evaluate(()=>stops),1);
 // Browser input can precede change/blur; an intervening render must preserve it.
 await $('part').selectOption('0');
 await page.evaluate(()=>{const select=document.getElementById('segment-part');select.value='1';select.dispatchEvent(new Event('input',{bubbles:true}));segment.referenceChanged();});
 assert.equal(await $('part').inputValue(),'1','input selection must not revert during UI refresh');
 await $('record').click();await page.waitForFunction(()=>state===1&&prepared.length===2);assert.equal(await page.evaluate(()=>prepared[1].segmentTake.partId),'second');await page.evaluate(()=>segment.stop());
 // A restored visible value without a change event is still authoritative at click.
 await $('part').selectOption('0');await page.evaluate(()=>document.getElementById('segment-part').value='1');
 await $('record').click();await page.waitForFunction(()=>state===1&&prepared.length===3);assert.equal(await page.evaluate(()=>prepared[2].segmentTake.partId),'second','record the visible choice before any pause/refresh callback');await page.evaluate(()=>segment.stop());
 // Starting the microphone is asynchronous; retain the clicked segment throughout.
 await $('part').selectOption('1');await page.evaluate(()=>window.mic=false);await $('record').click();await page.waitForFunction(()=>!!window.releaseMic);
 assert.equal(await $('part').isDisabled(),true);
 await page.evaluate(()=>{document.getElementById('segment-part').value='0';document.getElementById('segment-part').dispatchEvent(new Event('change'));segment.referenceChanged();releaseMic();});
 await page.waitForFunction(()=>state===1&&prepared.length===4);assert.equal(await page.evaluate(()=>prepared[3].segmentTake.partId),'second');assert.equal(await $('part').inputValue(),'1');
 await page.evaluate(()=>window.clock=22.3);await page.waitForTimeout(180);assert.equal(await page.evaluate(()=>segment.busy()),true);
 await page.evaluate(()=>window.clock=135.8);await page.waitForFunction(()=>!segment.busy());
 assert.equal(await page.evaluate(()=>localStorage.getItem('karaoke.segment-selection.v1.selection-fixture')),'second');
 assert.ok(await page.evaluate(()=>prepared.every(r=>r.segmentTake.start===20.228&&r.segmentTake.end===133.743)),'all recording metadata uses the clicked segment bounds');
 const count=await page.evaluate(()=>{document.getElementById('segment-part').value='invalid';return prepared.length;});await $('record').click();assert.equal(await page.evaluate(()=>prepared.length),count);assert.match(await $('status').textContent(),/請先選擇要錄製/);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({visibleChoice:true,inputBeforeChange:true,refreshDuringSelection:true,lockedDuringMicSetup:true,secondDoesNotStopAt22:true,secondStopsAtExpectedEnd:true,errors}));
}finally{await browser?.close();server.kill();}
