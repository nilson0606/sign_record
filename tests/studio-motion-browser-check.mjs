import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const port='4399',server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:port,KARAOKE_SITE_DIR:'_site'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser;
try{
  await new Promise((ok,no)=>{server.stdout.once('data',ok);server.stderr.once('data',x=>no(Error(x.toString())));server.once('error',no);});
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('http://127.0.0.1:4274/**',r=>r.fulfill({status:503,json:{error:'本機工具未連線。'}}));
  await page.goto('http://localhost:'+port,{waitUntil:'networkidle'});
  const motion=page.locator('#motion-toggle');
  assert.equal(await motion.getAttribute('aria-pressed'),'true');
  await page.waitForFunction(()=>document.querySelector('.studio-intro').classList.contains('motion-visible'));
  const state=()=>page.locator('.studio-art .signal-bars rect').first().evaluate(e=>getComputedStyle(e).animationPlayState);
  assert.equal(await state(),'running');
  await motion.click();assert.equal(await state(),'paused');
  await page.reload({waitUntil:'networkidle'});assert.equal(await motion.getAttribute('aria-pressed'),'false');
  await motion.click();assert.equal(await state(),'running');
  await page.locator('#recording-post').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>!document.querySelector('.studio-intro').classList.contains('motion-visible'));
  assert.equal(await state(),'paused');
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>document.getElementById('motion-toggle').disabled);
  assert.equal(await motion.getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('.studio-art .signal-bars rect').first().evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>!document.getElementById('motion-toggle').disabled);
  assert.equal(await motion.getAttribute('aria-pressed'),'true');
  await mkdir('test-results',{recursive:true});
  for(const language of ['zh-Hant','en']){
    await page.locator('#language-select').selectOption(language);
    for(const theme of ['console','current','warm']){
      await page.locator('#theme-select').selectOption(theme);
      for(const width of [1440,1024,760,390]){
        await page.setViewportSize({width,height:1000});
        await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
        const fit=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
        if(fit.scroll>fit.width+1)console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&e.getBoundingClientRect().width>0).map(e=>({id:e.id,tag:e.tagName,cls:e.getAttribute('class'),width:e.getBoundingClientRect().width})).slice(0,20)));
        assert.ok(fit.scroll<=fit.width+1,JSON.stringify({language,theme,...fit}));
        if(width===1440||width===390)await page.screenshot({path:`test-results/studio-${language}-${theme}-${width}.png`});
      }
    }
  }
  assert.equal(await motion.textContent(),'Motion: on');
  await motion.click();await page.waitForFunction(()=>document.getElementById('motion-toggle').textContent==='Motion: off');
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#language-select').selectOption('zh-Hant');
  await page.locator('#theme-select').selectOption('current');
  await page.locator('#player-section').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/studio-player.png'});
  await page.locator('#recording-post').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/studio-post.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: motion preference persists, offscreen pause, reduced motion, both languages/themes, 16 responsive viewports, no browser errors');
}finally{await browser?.close();server.kill();}
