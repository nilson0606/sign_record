// Uses a disposable library and synthetic microphone; never reads or deletes user recordings.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {handleLocalMedia,stopLocalMedia} from '../local-media-server.mjs';
import {cacheKey} from '../local-library.mjs';
import {transposeReference} from '../song-key.mjs';
const {chromium}=createRequire('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const root=await mkdtemp(path.join(tmpdir(),'karaoke-local-mv-browser-')),site='http://localhost:4388';
const audioMode=process.env.KARAOKE_TEST_SOURCE==='audio',sourceKind=audioMode?'audio':'local',mediaElement=audioMode?'local-audio':'local-video';
const fixture=path.resolve('.runtime/local-mv-test/fixture.'+(audioMode?'wav':'mp4'));
if(audioMode)execFileSync('ffmpeg',['-y','-v','error','-i',path.resolve('.runtime/local-mv-test/fixture.mp4'),'-vn','-c:a','pcm_s16le',fixture],{windowsHide:true});
const raw=JSON.parse(await readFile('.runtime/local-mv-test/prepared/reference.json','utf8'));
if(audioMode){raw.videoId='local_'+createHash('sha256').update(await readFile(fixture)).digest('hex');raw.title='本機音檔測試';}
const sourceAudio=await readFile('.runtime/voicelab/smoke/input.wav');let prepared=null;
const requests=[],backend=http.createServer(async(req,res)=>{
 if(req.url.startsWith('/local-media'))return handleLocalMedia(req,res,{library:root,authorized:req.headers['x-karaoke-token']==='fixture'});
 res.setHeader('Content-Type','application/json');const send=value=>res.end(JSON.stringify(value));
 if(req.url==='/session')return send({token:'fixture',features:['separation-progress','local-media','local-audio','library','stem-preview','pitch-methods','song-key-versions','rebuild-song']});
 if(req.url==='/health')return send({ready:true,checks:{}});
 if(req.url==='/library/location')return send({configured:true,path:root});
 if(req.url==='/library')return send({songs:prepared?[{...prepared,id:prepared.cacheId,seconds:0,bytes:1000}]:[]});
 if(req.url==='/jobs'&&req.method==='POST'){
  let text='';for await(const c of req)text+=c;const input=JSON.parse(text);requests.push(input);
  assert.equal(input.videoId,raw.videoId);prepared={...raw,...transposeReference(raw,input.pitchShift),pitchShift:input.pitchShift,rangeSeconds:0,pitchMethod:input.pitchMethod||'yin',hasPreview:true,cacheId:cacheKey(raw.videoId,0,'all','demucs',input.pitchMethod||'yin','single',input.pitchShift)};return send({id:'fixture-job'});
 }
 if(req.url==='/jobs/fixture-job/reference')return send(prepared);
 if(req.url==='/jobs/fixture-job')return send(req.method==='DELETE'?{}:{ready:true,cached:true,stage:'ready',message:'Ready'});
 if(/^\/library\/.+\/(vocals|accompaniment)$/.test(req.url)){res.setHeader('Content-Type','audio/wav');res.end(sourceAudio);return;}
 res.statusCode=404;send({error:'fixture unavailable'});
});
await new Promise(r=>backend.listen(0,'127.0.0.1',r));const api='http://127.0.0.1:'+backend.address().port;
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4388'},windowsHide:true,stdio:['ignore','pipe','pipe']});let browser,page;
try{
 await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j);});
 assert.equal((await fetch(api+'/local-media')).status,403);
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  localStorage.setItem('karaoke.recording-diagnostics.v1','off');localStorage.setItem('karaoke.capture-mode.v1','browser');
  window.YT={Player:class{constructor(id,options){this.id=options.videoId;this.options=options;setTimeout(()=>options.events.onReady(),10);}getVideoData(){return {video_id:this.id};}getPlayerState(){return 5;}getCurrentTime(){return 0;}pauseVideo(){}destroy(){}cueVideoById(id){this.id=id;}}};
 });
 await page.route('http://127.0.0.1:4274/**',async route=>{
  const req=route.request(),url=new URL(req.url()),response=await fetch(api+url.pathname+url.search,{method:req.method(),body:req.postDataBuffer()??undefined,headers:{...(['POST','GET','DELETE','HEAD'].includes(req.method())?{'X-Karaoke-Token':'fixture'}:{}),...(req.headers().range?{Range:req.headers().range}:{})}});
  await route.fulfill({status:response.status,body:Buffer.from(await response.arrayBuffer()),headers:Object.fromEntries(response.headers)});
 });
 const $=id=>page.locator('#'+id);
 await page.goto(site);await $('source-kind').selectOption(sourceKind);await $('local-media-file').setInputFiles(fixture);
 await page.waitForFunction(()=>document.getElementById('local-media-status').textContent.includes('已匯入「'),null,{timeout:60000});
 assert.equal(await $('local-media-id').inputValue(),raw.videoId);assert.equal(await $(mediaElement).isVisible(),true);
 const inventory=await(await fetch(api+'/local-media',{headers:{'X-Karaoke-Token':'fixture'}})).json();assert.equal(inventory.media.length,1);assert.equal(inventory.media[0].kind,audioMode?'audio':'video');
 if(audioMode){assert.equal(await $('local-audio-panel').isVisible(),true);assert.equal(await $('local-video').isHidden(),true);assert.match(await $('local-audio-title').textContent(),/fixture/);}
 const meta=await(await fetch(api+'/local-media/'+raw.videoId,{headers:{'X-Karaoke-Token':'fixture'}})).json();
 assert.equal((await fetch(api+`/local-media/${raw.videoId}/video`)).status,403);
 const range=await fetch(api+meta.playbackPath,{headers:{Range:'bytes=10-19'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,10);
 await page.evaluate(id=>{document.getElementById(id).currentTime=4;},mediaElement);await page.waitForFunction(id=>!document.getElementById(id).seeking,mediaElement);
 await page.evaluate(id=>document.getElementById(id).play(),mediaElement);await page.waitForFunction(id=>document.getElementById(id).currentTime>4.2,mediaElement);await page.evaluate(id=>document.getElementById(id).pause(),mediaElement);
 await $('prepare-song').click();await page.waitForFunction(()=>!document.getElementById('sing-start').disabled);
 await $('sing-start').click();await page.waitForFunction(id=>!document.getElementById(id).paused&&document.getElementById(id).currentTime<3,mediaElement);
 await page.waitForTimeout(3500);await $('finish-song').click();
 await page.waitForFunction(()=>document.getElementById('recording-review-take').options.length>0&&document.getElementById('recording-review-take').options[0].value);
 const pending=await page.evaluate(async()=>{const {BrowserRecordingStore}=await import('/recording-store.mjs');return (await new BrowserRecordingStore().list()).filter(x=>x.postPending);});
 assert.equal(pending.length,1);assert.equal(pending[0].post.reference.videoId,raw.videoId);
 await $('segment-open').click();await page.evaluate(id=>{document.getElementById(id).currentTime=4;},mediaElement);await page.waitForFunction(id=>!document.getElementById(id).seeking,mediaElement);await $('segment-split').click();
 const draft=await page.evaluate(id=>JSON.parse(localStorage.getItem('karaoke.segment-draft.v1.'+id)),prepared.cacheId);assert.equal(draft.parts.length,2);assert.ok(Math.abs(draft.parts[0].end-4)<.3);
 await $('segment-part').selectOption('0');await $('segment-record').click();await page.waitForFunction(()=>document.getElementById('segment-status').textContent.includes('本段已保存'),null,{timeout:20000});
 const takes=await page.evaluate(async()=>{const {BrowserRecordingStore}=await import('/recording-store.mjs');return (await new BrowserRecordingStore().list()).filter(x=>x.segmentTake);});assert.equal(takes.length,1);assert.equal(takes[0].post.reference.videoId,raw.videoId);
 await $('segment-whole').click();await $('song-key').selectOption('4');await $('song-key-apply').click();await page.waitForFunction(()=>!document.getElementById('sing-start').disabled&&document.getElementById('song-key-status').textContent.includes('原聲靜音'));
 assert.equal(requests.at(-1).pitchShift,4);assert.equal(await $(mediaElement).evaluate(v=>v.muted),true);
 await page.reload();await $('library-panel').locator('summary').click();await $('library-refresh').click();await page.waitForFunction(()=>document.querySelectorAll('.song-choice').length>0);await page.locator('.song-choice').first().click();await page.waitForFunction(()=>!document.getElementById('sing-start').disabled);
 assert.equal(await $('source-kind').inputValue(),sourceKind);assert.equal(await $('local-media-id').inputValue(),raw.videoId);assert.equal(await $(mediaElement).isVisible(),true);
 await $('source-kind').selectOption('youtube');await $('url').fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');await page.locator('#song-form button').click();await page.waitForFunction(()=>document.getElementById('player-status').textContent.includes('播放按鈕'));assert.equal(await $(mediaElement).isHidden(),true);
 await $('source-kind').selectOption(sourceKind);await page.waitForFunction(()=>document.getElementById('local-media-saved').options.length===2);await $('local-media-saved').selectOption(raw.videoId);await $('local-media-load').click();await page.waitForFunction(()=>document.getElementById('player-status').textContent.includes('已載入本機'));
 await page.waitForFunction(id=>document.getElementById(id).readyState>=2,mediaElement);
 await mkdir('test-results',{recursive:true});await $('player-section').screenshot({path:`test-results/local-${audioMode?'audio':'mv'}-ui.png`});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,imported:true,rangeSeek:true,wholeRecording:true,segmentSplit:true,segmentRecording:true,keyPlayback:true,libraryReload:true,youtubeRoundTrip:true,sourceId:raw.videoId}));
}catch(error){console.error(error);if(page)console.error(await page.evaluate(()=>Object.fromEntries(['player-status','prepare-status','session-status','mic-status','local-media-status','recording-status'].map(id=>[id,document.getElementById(id)?.textContent]))));throw error;}finally{await browser?.close();server.kill();await stopLocalMedia();await new Promise(r=>backend.close(r));await rm(root,{recursive:true,force:true,maxRetries:5});}
