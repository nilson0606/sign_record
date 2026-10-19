import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import http from 'node:http';
import {handleLocalMedia,stopLocalMedia} from '../local-media-server.mjs';
const root=await mkdtemp(path.join(tmpdir(),'karaoke-import-check-')),exec=promisify(execFile);
const server=http.createServer((req,res)=>handleLocalMedia(req,res,{library:root,authorized:true}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
async function imported(bytes,name){
 const response=await fetch(base+'/local-media/imports?name='+encodeURIComponent(name),{method:'POST',body:bytes});assert.equal(response.status,202);const job=await response.json();
 for(let n=0;n<120;n++){const state=await(await fetch(base+'/local-media/imports/'+job.id)).json();if(['ready','failed'].includes(state.stage))return state;await new Promise(r=>setTimeout(r,100));}throw Error('Import timeout');
}
try{
 const file=path.join(root,'sample.webm');
 await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=320x180:r=15','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libvpx','-deadline','realtime','-c:a','libvorbis',file],{windowsHide:true});
 const original=await readFile(file),first=await imported(original,'Sample.webm');assert.equal(first.stage,'ready',first.message);
 const report=JSON.parse((await exec('ffprobe',['-v','error','-show_streams','-of','json',path.join(root,'.local-mv',first.media.id,'video.mp4')],{windowsHide:true})).stdout);
 assert.equal(report.streams.find(x=>x.codec_type==='video').codec_name,'h264');assert.equal(report.streams.find(x=>x.codec_type==='audio').codec_name,'aac');
 const again=await imported(original,'Renamed.webm');assert.equal(again.media.id,first.media.id);assert.equal((await(await fetch(base+'/local-media')).json()).media.length,1);
 await rm(path.join(root,'.local-mv',first.media.id,'video.mp4'));const repaired=await imported(original,'Sample.webm');assert.equal(repaired.stage,'ready',repaired.message);
 assert.equal((await imported(Buffer.from('invalid video'),'broken.mp4')).stage,'failed');
 assert.equal((await fetch(base+'/local-media/imports?name=payload.html',{method:'POST',body:'bad'})).status,400);
 assert.deepEqual(await readFile(file),original);assert.ok((await readdir(path.join(root,'.local-mv'))).every(x=>x===first.media.id));
 for(const extension of ['wav','mp3']){
  const input=path.join(root,'audio.'+extension);
  await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=330:sample_rate=44100','-t','2',input],{windowsHide:true});
  const bytes=await readFile(input),audio=await imported(bytes,'Song.'+extension);assert.equal(audio.stage,'ready',audio.message);assert.equal(audio.media.kind,'audio');
  const info=await(await fetch(base+'/local-media/'+audio.media.id)).json();
  const response=await fetch(base+info.playbackPath,{headers:{Range:'bytes=0-43'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-type'),'audio/wav');
  const decoded=JSON.parse((await exec('ffprobe',['-v','error','-show_streams','-of','json',path.join(root,'.local-mv',audio.media.id,'audio.wav')],{windowsHide:true})).stdout);
  assert.equal(decoded.streams.length,1);assert.equal(decoded.streams[0].codec_name,'pcm_s24le');assert.equal(decoded.streams[0].sample_rate,'48000');
  assert.equal((await imported(bytes,'Renamed.'+extension)).media.id,audio.media.id);assert.deepEqual(await readFile(input),bytes);
 }
 assert.equal((await imported(Buffer.from('invalid audio'),'broken.wav')).stage,'failed');
 assert.equal((await fetch(base+'/local-media/imports?name=wrong.mp4&kind=audio',{method:'POST',body:original})).status,400);
 console.log('PASS: WebM converts to H264/AAC; duplicate import reuses identity; missing copy repairs; invalid media rejected and temporary files cleaned; original unchanged.');
}finally{await stopLocalMedia();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:5});}
