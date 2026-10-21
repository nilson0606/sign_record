import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const port='4396',server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:port},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser;
try{
 await new Promise((ok,no)=>{server.stdout.once('data',ok);server.stderr.once('data',x=>no(Error(x.toString())));server.once('error',no);});
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.goto('http://localhost:'+port);
 await page.evaluate(async()=>{
  window.reveal=(await import('/player-view.mjs')).revealPlayerVideo;
  const frame=document.createElement('iframe');frame.id='player';frame.title='Subtitle visibility fixture';
  frame.srcdoc='<style>body{margin:0;background:#182937;color:white;font:24px system-ui}p{position:absolute;bottom:2%;left:0;right:0;text-align:center;margin:0;padding:8px;background:#0008}</style><p>字幕位於影片下緣 / Subtitles at the bottom</p>';
  document.getElementById('player').replaceWith(frame);window.fixtureFrame=frame;window.frameLoads=0;frame.addEventListener('load',()=>frameLoads++);
 });
 await page.waitForFunction(()=>frameLoads===1);
 const results=[];
 for(const language of ['zh-Hant','en']){
  await page.locator('#language-select').selectOption(language);
  for(const [width,height] of [[1366,768],[1280,720],[1024,600],[1440,900],[390,844]]){
   await page.setViewportSize({width,height});
   for(const segmented of [false,true]){
    await page.evaluate(segmented=>{
     const section=document.getElementById('player-section');section.classList.toggle('segment-active',segmented);section.parentElement.classList.toggle('segment-layout',segmented);
     section.dataset.workflow=JSON.stringify({micReady:true,mediaId:'fixture',reference:'fixture',prepared:true,phase:'singing',segmented,busy:segmented,hasTake:false});
     document.getElementById('recording-post').scrollIntoView({behavior:'instant'});reveal();
    },segmented);
    await page.waitForTimeout(100);
    const box=await page.evaluate(()=>{
     const section=document.getElementById('player-section'),video=section.querySelector('.video-shell'),v=video.getBoundingClientRect(),f=fixtureFrame.getBoundingClientRect(),n=document.querySelector('.section-nav').getBoundingClientRect();
     return{top:v.top,bottom:v.bottom,width:v.width,height:v.height,navBottom:n.bottom,viewport:innerHeight,frameTop:f.top,frameBottom:f.bottom,sameFrame:fixtureFrame===document.getElementById('player'),loads:frameLoads,focused:document.activeElement===section};
    });
    assert.ok(box.top>=box.navBottom+10&&box.top<=box.navBottom+20,JSON.stringify({language,width,height,segmented,box}));
    assert.ok(box.bottom<=height-45,JSON.stringify({language,width,height,segmented,box}));
    assert.ok(Math.abs(box.width/box.height-16/9)<.02,JSON.stringify(box));
    assert.ok(box.frameTop>=box.top&&box.frameBottom<=box.bottom+1,JSON.stringify(box));
    assert.ok(box.sameFrame&&box.loads===1&&box.focused,JSON.stringify(box));
    results.push({language,width,height,segmented});
    if(language==='zh-Hant'&&width===1366)await page.screenshot({path:'.runtime/player-subtitles-'+(segmented?'segment':'whole')+'.png'});
   }
  }
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({viewportChecks:results.length,wholeAndSegment:true,bothLanguages:true,bottomSubtitlesVisible:true,aspectRatioPreserved:true,noIframeReload:true,errors}));
}finally{await browser?.close();server.kill();}
