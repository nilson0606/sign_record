import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createDiagnosticsHandler} from '../recording-diagnostics-server.mjs';

test('diagnostic authentication, active-session clear guard, persistence, quotas and isolated deletion',async()=>{
 const tmp=await mkdtemp(path.join(tmpdir(),'karaoke-diagnostics-')),root=path.join(tmp,'diagnostics');
 const handler=createDiagnosticsHandler(root,{maxBytes:2048});const server=http.createServer((req,res)=>handler(req,res));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,origin='http://localhost:4273';
 try{
  assert.equal((await fetch(base+'/diagnostics/session')).status,403);
  const {token}=await (await fetch(base+'/diagnostics/session',{headers:{Origin:origin}})).json();
  const call=(url,method='GET',data)=>fetch(base+url,{method,headers:{Origin:origin,'X-Diagnostic-Token':token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  assert.equal((await fetch(base+'/diagnostics',{headers:{Origin:origin}})).status,403);
  const id=randomUUID();assert.equal((await call('/diagnostics/'+id,'POST',{title:'test',recordingId:id})).status,200);
  assert.equal((await call('/diagnostics','DELETE')).status,400);
  assert.equal((await call('/diagnostics/'+id+'/events','POST',{kind:'pcm',buffers:[Buffer.alloc(200).toString('base64')]})).status,200);
  assert.equal((await call('/diagnostics/'+id+'/events','POST',{kind:'pcm',buffers:[Buffer.alloc(3000).toString('base64')]})).status,400);
  assert.equal((await call('/diagnostics/'+id+'/finish','POST',{error:''})).status,200);
  assert.equal(JSON.parse(await readFile(path.join(root,id,'metadata.json'))).status,'saved');
  assert.equal((await call('/diagnostics/'+id+'/events','POST',{kind:'event'})).status,400);
  assert.equal((await (await call('/diagnostics')).json()).count,1);
  await writeFile(path.join(tmp,'voice.wav'),'original');await writeFile(path.join(root,'unowned.txt'),'keep');
  assert.equal((await call('/diagnostics','DELETE')).status,200);
  assert.equal(await readFile(path.join(tmp,'voice.wav'),'utf8'),'original');assert.deepEqual(await readdir(root),['unowned.txt']);
 }finally{
  await new Promise(r=>server.close(r));if(path.dirname(path.resolve(tmp))===path.resolve(tmpdir())&&path.basename(tmp).startsWith('karaoke-diagnostics-'))await rm(tmp,{recursive:true,force:true});
 }
});

test('v2 completion confirms continuous PCM and comparison streams before reporting saved',async()=>{
 const tmp=await mkdtemp(path.join(tmpdir(),'karaoke-diagnostics-')),root=path.join(tmp,'diagnostics');
 const handler=createDiagnosticsHandler(root);const server=http.createServer((req,res)=>handler(req,res));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,origin='https://nilson0606.github.io';
 try{
  const preflight=await fetch(base+'/diagnostics/session',{method:'OPTIONS',headers:{Origin:origin}});
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'),/X-Diagnostic-Token/);
  const {token}=await(await fetch(base+'/diagnostics/session',{headers:{Origin:origin}})).json();
  const call=(url,data)=>fetch(base+url,{method:'POST',headers:{Origin:origin,'X-Diagnostic-Token':token,'Content-Type':'application/json'},body:JSON.stringify(data)});
  const begin=async(input='browser-media-stream')=>{const id=randomUUID();assert.equal((await call('/diagnostics/'+id,{recordingId:id,formatVersion:2,input})).status,200);return id;};
  const pcm=(id,recordedFrame=0)=>call('/diagnostics/'+id+'/events',{kind:'pcm',recordedFrame,frames:480,buffers:[Buffer.alloc(480*4).toString('base64')]});
  const finish=(id,frames=480)=>call('/diagnostics/'+id+'/finish',{recordedFrames:frames});
  const full=await begin();await pcm(full);
  await call('/diagnostics/'+full+'/events',{kind:'probe',frames:480,buffers:[Buffer.alloc(480*4).toString('base64')]});
  await call('/diagnostics/'+full+'/events',{kind:'media',buffers:[Buffer.from('comparison').toString('base64')]});
  await call('/diagnostics/'+full+'/events',{kind:'event',event:'finish',recordedFrames:480});
  assert.equal((await(await finish(full)).json()).saved,true);
  assert.equal(JSON.parse(await readFile(path.join(root,full,'metadata.json'))).frames,480);
  const missing=await begin();const result=await(await finish(missing)).json();assert.equal(result.saved,false);assert.match(result.error,/PCM/);
  assert.equal(JSON.parse(await readFile(path.join(root,missing,'metadata.json'))).status,'incomplete');
  const broken=await begin();assert.equal((await pcm(broken,480)).status,400);assert.match((await(await finish(broken)).json()).error,/不連續/);
  const noMedia=await begin();await pcm(noMedia);await call('/diagnostics/'+noMedia+'/events',{kind:'probe',frames:480,buffers:[Buffer.alloc(1920).toString('base64')]});await call('/diagnostics/'+noMedia+'/events',{kind:'event',event:'finish',recordedFrames:480});
  assert.match((await(await finish(noMedia)).json()).error,/直接收音/);
  const cancelled=await begin();await call('/diagnostics/'+cancelled+'/finish',{cancelled:true});assert.equal(JSON.parse(await readFile(path.join(root,cancelled,'metadata.json'))).status,'cancelled');
 }finally{
  await new Promise(r=>server.close(r));if(path.dirname(path.resolve(tmp))===path.resolve(tmpdir())&&path.basename(tmp).startsWith('karaoke-diagnostics-'))await rm(tmp,{recursive:true,force:true});
 }
});
