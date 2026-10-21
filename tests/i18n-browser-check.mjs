import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const port='4397',server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:port,KARAOKE_SITE_DIR:'_site'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser;
try{
 await new Promise((ok,no)=>{server.stdout.once('data',ok);server.stderr.once('data',x=>no(Error(x.toString())));server.once('error',no);});
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('http://127.0.0.1:4274/**',r=>r.fulfill({status:503,json:{error:'本機工具未連線。'}}));
 await page.goto('http://localhost:'+port,{waitUntil:'networkidle'});
 assert.equal(await page.locator('html').getAttribute('lang'),'zh-Hant');
 assert.equal(await page.locator('#language-select').inputValue(),'zh-Hant');
 assert.equal(await page.locator('#recording-delay').inputValue(),'300');
 const sourceValues=await page.locator('select').evaluateAll(els=>els.filter(e=>e.id!=='language-select').map(e=>[e.id,e.value,[...e.options].map(o=>o.value)]));
 await page.locator('#language-select').selectOption('en');
 await page.waitForFunction(()=>document.title==='Sing & Record · Local Desktop Studio');
 const leftovers=await page.evaluate(()=>{
  const a=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){const n=walker.currentNode;if(/[\u3400-\u9fff]/.test(n.data)&&!n.parentElement.closest('script,style,code,textarea,[data-i18n-skip],[data-i18n-user]'))a.push({id:n.parentElement.id,text:n.data.trim()});}
  for(const n of document.querySelectorAll('[title],[aria-label],[placeholder],[alt]'))for(const k of ['title','aria-label','placeholder','alt'])if(/[\u3400-\u9fff]/.test(n.getAttribute(k)||'')&&!n.closest('[data-i18n-skip],[data-i18n-user]'))a.push({id:n.id,attr:k,text:n.getAttribute(k)});
  return a;
 });
 console.log('Untranslated initial UI:',JSON.stringify(leftovers));assert.deepEqual(leftovers,[]);
 assert.deepEqual(await page.locator('select').evaluateAll(els=>els.filter(e=>e.id!=='language-select').map(e=>[e.id,e.value,[...e.options].map(o=>o.value)])),sourceValues);
 assert.equal(await page.locator('[data-language-manual]').getAttribute('href'),'manual.en.html');
 // Live playback, input state and dynamic status survive both language directions.
 await page.evaluate(async()=>{
  const url=document.querySelector('script[src$="i18n.mjs"]').src;window.locale=await import(url);
  const process=await import(new URL('recording-process.mjs',url));
  const buffer=new AudioBuffer({numberOfChannels:1,length:48000*20,sampleRate:48000});buffer.getChannelData(0).fill(.01);
  const player=document.getElementById('post-audio');player.src=URL.createObjectURL(process.wavBlob(buffer));await player.play();
  document.getElementById('mv-title').value='開始';
  document.getElementById('post-delay').value='321';
  const fixture=document.createElement('div');fixture.id='locale-fixture';fixture.innerHTML='<p id="locale-progress"></p><p id="locale-title" data-i18n-user>原音</p><select id="locale-choice"><option>開始</option></select>';document.body.append(fixture);
  document.getElementById('locale-progress').textContent='已保存 2 段不計分區間。';
 });
 await page.waitForFunction(()=>document.getElementById('locale-progress').textContent==='Saved 2 unscored regions.');
 assert.equal(await page.locator('#locale-title').innerText(),'原音');assert.equal(await page.locator('#locale-choice').inputValue(),'開始');assert.equal(await page.locator('#locale-choice').innerText(),'Start');
 await page.waitForFunction(()=>document.getElementById('post-audio').currentTime>.2);
 const before=await page.locator('#post-audio').evaluate(e=>({time:e.currentTime,src:e.src}));
 await page.locator('#language-select').selectOption('zh-Hant');
 await page.waitForFunction(()=>document.getElementById('locale-progress').textContent==='已保存 2 段不計分區間。');
 await page.locator('#language-select').selectOption('en');
 await page.waitForTimeout(250);
 const after=await page.locator('#post-audio').evaluate(e=>({time:e.currentTime,src:e.src,paused:e.paused}));
 assert.equal(after.src,before.src);assert.equal(after.paused,false);assert.ok(after.time>before.time,JSON.stringify({before,after}));
 assert.equal(await page.locator('#mv-title').inputValue(),'開始');assert.equal(await page.locator('#post-delay').inputValue(),'321');
 await page.evaluate(()=>document.getElementById('locale-progress').textContent='已保存 3 段不計分區間。');await page.waitForFunction(()=>document.getElementById('locale-progress').textContent==='Saved 3 unscored regions.');
 const dialogPromise=page.waitForEvent('dialog');const confirmCall=page.evaluate(()=>locale.localizedConfirm('刪除這筆錄音、原始歌聲及其後處理資料？此操作無法復原。'));const dialog=await dialogPromise;assert.match(dialog.message(),/^Delete this recording/);await dialog.dismiss();assert.equal(await confirmCall,false);
 await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('html').getAttribute('lang'),'en');
 for(const width of [1440,1024,760,390]){await page.setViewportSize({width,height:1000});const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));if(sizes.scroll>sizes.width+1)console.log('Overflow',await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&e.getBoundingClientRect().width>0).map(e=>({tag:e.tagName,id:e.id,cls:e.className,width:e.getBoundingClientRect().width,text:e.textContent.slice(0,70)})).slice(0,25)));assert.ok(sizes.scroll<=sizes.width+1,JSON.stringify(sizes));}
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.runtime/i18n-english.png'});
 await page.locator('#theme-select').selectOption('warm');await page.screenshot({path:'.runtime/i18n-english-warm.png'});
 const help=await context.newPage();await help.goto('http://localhost:'+port+'/manual.html');await help.waitForURL('**/manual.en.html');assert.equal(await help.locator('html').getAttribute('lang'),'en');
 await help.locator('#language-select').selectOption('zh-Hant');await help.waitForURL('**/manual.html');await page.waitForFunction(()=>document.documentElement.lang==='zh-Hant');
 assert.equal(await page.locator('#language-select').inputValue(),'zh-Hant');await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('html').getAttribute('lang'),'zh-Hant');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({defaultChinese:true,englishCoverage:true,persistentPreference:true,crossTab:true,manualSwitch:true,preservedControls:true,continuousPlayback:true,userDataIntact:true,localizedDialog:true,responsive:true,errors}));
}finally{await browser?.close();server.kill();}

