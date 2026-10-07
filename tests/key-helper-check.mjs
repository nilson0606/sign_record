// Optional integration: isolated helper, song library and real FFmpeg; no user's data.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {LocalLibrary,cacheKey} from '../local-library.mjs';
const project=path.resolve(import.meta.dirname,'..'),root=await mkdtemp(path.join(tmpdir(),'karaoke-key-helper-'));
let child;
try{
  for(const name of await readdir(project))if(name.endsWith('.mjs'))await copyFile(path.join(project,name),path.join(root,name));
  await mkdir(path.join(root,'tools'));await copyFile(path.join(project,'tools/key_shift_worker.py'),path.join(root,'tools/key_shift_worker.py'));
  const jobsPath=path.join(root,'local-jobs.mjs');let code=await readFile(jobsPath,'utf8');
  code=code.replace("const python = path.join(root, '.runtime', 'venv', 'Scripts', 'python.exe');",'const python = '+JSON.stringify(path.join(project,'.runtime/venv/Scripts/python.exe'))+';');await writeFile(jobsPath,code);
  await mkdir(path.join(root,'.runtime'));const source=path.join(root,'source');await mkdir(source);
  execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:duration=4','-ar','48000',path.join(source,'vocals.mp3')],{windowsHide:true});
  await copyFile(path.join(source,'vocals.mp3'),path.join(source,'accompaniment.mp3'));
  const lib=new LocalLibrary(path.join(root,'library')),ref={version:1,videoId:'M7lc1UVf-VE',title:'Key helper fixture',duration:4,step:.1,frames:Array(40).fill(440),beats:[1,2,3],bpm:120,rangeSeconds:0,vocalMode:'all',pitchMethod:'yin',separationModel:'demucs',separationMethod:'single'};
  const base=cacheKey(ref.videoId,0);await lib.save(base,ref,source,true);
  const original=await lib.audio(base,'vocals');
  await writeFile(path.join(root,'.runtime/library-settings.json'),JSON.stringify({version:1,libraryPath:lib.root}));
  const port=14379;
  child=spawn(process.execPath,['helper-local.mjs'],{cwd:root,env:{...process.env,KARAOKE_HELPER_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.stderr.once('data',x=>reject(Error(String(x))));});
  const headers={Origin:'http://localhost:4273'},baseURL=`http://127.0.0.1:${port}`;
  const session=await(await fetch(baseURL+'/session',{headers})).json();assert.ok(session.features.includes('song-key-versions'));
  headers['X-Karaoke-Token']=session.token;
  async function api(url,body,method=body?'POST':'GET'){
    const response=await fetch(baseURL+url,{method,headers:{...headers,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const json=await response.json();if(!response.ok)throw Error(JSON.stringify(json));return json;
  }
  const payload={videoId:ref.videoId,seconds:0,preview:true,pitchMethod:'yin',pitchShift:-2};
  const job=await api('/jobs',payload);
  let state;const deadline=Date.now()+30000;
  do{state=await api('/jobs/'+job.id);if(state.stage==='failed')throw Error(state.message);if(Date.now()>deadline)throw Error('Timed out');if(!state.ready)await new Promise(r=>setTimeout(r,100));}while(!state.ready);
  const shifted=await api('/jobs/'+job.id+'/reference'),id=shifted.cacheId;
  assert.equal(shifted.pitchShift,-2);assert.equal(shifted.sourceCacheId,base);assert.equal(shifted.duration,4);assert.deepEqual(shifted.beats,[1,2,3]);
  assert.ok(Math.abs(shifted.frames[0]-440*2**(-2/12))<1e-8);assert.notEqual(id,base);
  assert.deepEqual(await lib.audio(base,'vocals'),original);assert.equal((await api('/library')).songs.length,2);
  const again=await api('/jobs',payload);assert.equal(again.cached,true);assert.equal(again.ready,true);
  const shiftedAudio=await lib.audio(id,'vocals');
  const cancelled=await api('/jobs',{...payload,force:true});await api('/jobs/'+cancelled.id,undefined,'DELETE');
  assert.deepEqual(await lib.audio(id,'vocals'),shiftedAudio,'cancelling a rebuild preserves the saved key version');
  await api('/jobs/'+again.id,undefined,'DELETE');await api('/jobs/'+job.id,undefined,'DELETE');
  // A new helper instance reopens the saved key; it does not depend on job memory.
  assert.equal((await new LocalLibrary(lib.root).get(id)).pitchShift,-2);
  await api('/library/'+id,undefined,'DELETE');assert.equal(await lib.get(id),null);assert.deepEqual(await lib.audio(base,'vocals'),original);
  console.log(JSON.stringify({rendered:true,reusedOriginal:true,cached:true,persisted:true,deleteVersionOnly:true}));
}finally{
  if(child&&child.exitCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended;}
  if(path.dirname(root)===path.resolve(tmpdir())&&path.basename(root).startsWith('karaoke-key-helper-'))await rm(root,{recursive:true,force:true,maxRetries:5});
}
