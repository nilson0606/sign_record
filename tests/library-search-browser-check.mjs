import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const port='4398',site='http://localhost:'+port;
const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:port,KARAOKE_SITE_DIR:'_site'},windowsHide:true,stdio:['ignore','pipe','pipe']});
const songs=[
  {id:'summer',videoId:'summer',title:'溫嵐 夏天的風 FLAC'},
  {id:'summer-key',videoId:'summer',title:'夏天的風 升 4 Key',baseTitle:'溫嵐 夏天的風',pitchShift:4},
  {id:'focus',videoId:'focus',title:'China Focus: Life 夜空中最亮的星'},
  {id:'start',videoId:'start',title:'開始'}
].map(song=>({seconds:0,bytes:1000,hasPreview:true,...song}));
let browser,libraryRequests=0;
try{
  await new Promise((ok,no)=>{server.stdout.once('data',ok);server.stderr.once('data',x=>no(Error(x.toString())));server.once('error',no);});
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.route('http://127.0.0.1:4274/**',r=>{
    const path=new URL(r.request().url()).pathname;
    const headers={'Access-Control-Allow-Origin':site,'Access-Control-Allow-Headers':'X-Karaoke-Token, Content-Type','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS'};
    if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers});
    let json;
    if(path==='/session')json={token:'fixture',features:['separation-progress']};
    else if(path==='/library/location')json={configured:true,path:'isolated-fixture'};
    else if(path==='/library'){libraryRequests++;json={songs};}
    else return r.fulfill({status:404,headers,json:{error:'Fixture only'}});
    return r.fulfill({json,headers});
  });
  await page.goto(site);
  await page.evaluate(async()=>{
    const {createKaraokeSession}=await import(new URL('session.mjs',document.querySelector('script[src$="app.mjs"]').src));
    window.fixtureSession=createKaraokeSession({reference:()=>null,player:()=>null,micReady:()=>false,stopBeats(){},cancelCalibration(){}});
    document.getElementById('library-panel').open=true;
  });
  const search=page.locator('#library-search'),status=page.locator('#library-search-status');
  await page.locator('#library-refresh').click();
  await page.waitForFunction(()=>document.querySelectorAll('.song-choice').length===4);
  const visible=()=>page.locator('.song-choice:visible').count();
  assert.equal(await visible(),4);
  await page.locator('.song-key-group summary').click();
  await search.fill('溫嵐 夏天');assert.equal(await visible(),2);
  assert.equal(await status.textContent(),'顯示 2／4 個歌曲基準。');
  assert.equal(await page.locator('.song-key-group details').getAttribute('open'),'');
  await search.press('Escape');assert.equal(await page.locator('.song-key-group details').getAttribute('open'),null);
  await search.fill('ＣＨＩＮＡ   life');assert.equal(await visible(),1);
  assert.equal(await page.locator('.song-key-group').isHidden(),true);
  await search.fill('不存在');assert.equal(await visible(),0);assert.match(await status.textContent(),/找不到/);
  await page.locator('#library-search-clear').click();assert.equal(await search.inputValue(),'');
  assert.equal(await search.evaluate(e=>e===document.activeElement),true);
  await search.fill('夏天');
  // Filtering must preserve selected rows, recording markers and disabled controls.
  await page.evaluate(()=>{const b=document.querySelector('[data-song-id="summer"]');b.disabled=true;b.setAttribute('aria-current','true');b.dataset.testMarker='preserved';});
  const requestsBefore=libraryRequests;
  await search.fill('life');await search.fill('夏天');
  assert.equal(libraryRequests,requestsBefore);
  assert.equal(await page.locator('[data-song-id="summer"]').isDisabled(),true);
  assert.equal(await page.locator('[data-song-id="summer"]').getAttribute('aria-current'),'true');
  assert.equal(await page.locator('[data-song-id="summer"]').getAttribute('data-test-marker'),'preserved');
  await page.locator('#library-refresh').click();
  await page.waitForFunction(()=>!document.getElementById('library-refresh').disabled);
  assert.equal(await search.inputValue(),'夏天');assert.equal(await visible(),2);
  await page.locator('#language-select').selectOption('en');
  await page.waitForFunction(()=>document.getElementById('library-search-status').textContent==='Showing 2 of 4 song references.');
  assert.equal(await search.getAttribute('placeholder'),'Enter a song title or artist keyword');
  await search.fill('開始');assert.equal(await visible(),1);
  assert.equal(await page.locator('[data-song-id="start"] strong').textContent(),'開始');
  await search.fill('missing');await page.waitForFunction(()=>document.getElementById('library-search-status').textContent.startsWith('No matching songs.'));
  await page.locator('#library-search-clear').click();assert.equal(await visible(),4);
  await page.locator('#language-select').selectOption('zh-Hant');
  await page.locator('#theme-select').selectOption('warm');
  await search.fill('夏天');await page.locator('#library-section').scrollIntoViewIfNeeded();
  await mkdir('test-results',{recursive:true});
  await page.locator('#library-section').screenshot({path:'test-results/library-search-warm.png'});
  for(const width of [390,760,1280]){
    await page.setViewportSize({width,height:950});
    const fits=await page.locator('.library-search-row').evaluate(e=>[...e.children].every(c=>c.getBoundingClientRect().right<=e.getBoundingClientRect().right+1));
    assert.ok(fits,`Search controls fit ${width}px viewport`);
  }
  songs.splice(0);await page.locator('#library-refresh').click();
  await page.waitForFunction(()=>!document.getElementById('library-refresh').disabled);
  await search.press('Escape');assert.equal(await status.textContent(),'顯示 0／0 個歌曲基準。');
  assert.deepEqual(errors,[]);
  console.log('PASS: integrated library search, groups, normalization, refresh, empty results, state preservation, languages and responsive layout');
}finally{await browser?.close();server.kill();}
