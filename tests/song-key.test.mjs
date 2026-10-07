import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {LocalLibrary,cacheKey} from '../local-library.mjs';
import {transposeReference,keyShift,guideStems} from '../song-key.mjs';
import {ScoringTake} from '../scoring.mjs';
import {detectPitch} from '../audio.mjs';
import {segmentDraft} from '../recording-segments.mjs';
import {createKeyPlayback} from '../key-playback.mjs';
import {referenceForRescore} from '../recording-process.mjs';
import {analyzeRecordedVoice} from '../recording-analysis.mjs';

const reference={version:1,videoId:'M7lc1UVf-VE',title:'Key fixture',step:.1,frames:Array(60).fill(440),duration:6,rangeSeconds:0,vocalMode:'all'};
test('key versions preserve original audio, timing, masks and independent segment identity after reopen',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'karaoke-key-'));
  try{
    const source=path.join(root,'source');await mkdir(source);
    for(const stem of ['vocals','accompaniment'])await writeFile(path.join(source,stem+'.mp3'),'original-'+stem);
    const lib=new LocalLibrary(path.join(root,'library')),base=cacheKey(reference.videoId,0);
    await lib.save(base,reference,source,true);
    const original=await lib.get(base), ids=[];
    for(const shift of [-12,-2,1,12]){
      const id=cacheKey(reference.videoId,0,'all','demucs','yin','single',shift);ids.push(id);
      const ref=transposeReference(original,shift);
      await lib.save(id,ref,source,true);
      assert.notEqual(segmentDraft({...ref,cacheId:id}).key,segmentDraft(original).key);
      assert.equal(ref.frames[0],440*2**(shift/12));assert.equal(ref.duration,original.duration);
    }
    await lib.setMasks(ids[0],[{start:1,end:2}]);
    const reopened=new LocalLibrary(lib.root);
    assert.equal((await reopened.list()).length,5);
    assert.deepEqual((await reopened.get(ids[1])).masks,[{start:1,end:2}]);
    assert.equal((await reopened.get(ids[1])).pitchShift,-2);
    await reopened.delete(ids[0]);assert.ok(await reopened.get(base));assert.ok(await reopened.get(ids[1]));
    assert.equal((await reopened.audio(base,'vocals')).toString(),'original-vocals');
    for(const bad of [-13,13,1.5,NaN,'2',null])assert.throws(()=>keyShift(bad));
    assert.throws(()=>lib.directory(base+'_key_p13'));assert.throws(()=>transposeReference({...original,pitchShift:2},1));
  }finally{await rm(root,{recursive:true,force:true});}
});
test('score and live pitch follow shifted reference including low and high edge notes',()=>{
  for(const [hz,shift] of [[70,-12],[950,12],[440,-2],[440,1],[440,0]]){
    const ref=transposeReference({...reference,frames:Array(60).fill(hz)},shift),factor=2**(shift/12),target=hz*factor;
    const samples=Float32Array.from({length:4096},(_,i)=>.2*Math.sin(2*Math.PI*target*i/48000));
    const found=detectPitch(samples,48000/factor).hz*factor;
    assert.ok(Math.abs(found/target-1)<.01,`${target}: ${found}`);
    const take=new ScoringTake(ref);
    for(let i=0;i<60;i++)take.sample(i*.1,target);
    assert.equal(take.result().pitch,100);
  }
  assert.deepEqual(guideStems({vocalMode:'lead'},'original'),['accompaniment','vocals']);
  assert.deepEqual(guideStems({vocalMode:'lead'},'backing'),['accompaniment','backing']);
  assert.throws(()=>referenceForRescore({reference},transposeReference(reference,2)),/Key/);
  const low=Float32Array.from({length:16000},(_,i)=>.2*Math.sin(2*Math.PI*35*i/16000));
  const analysis=analyzeRecordedVoice(low,16000,()=>{},-12);
  assert.equal(analysis.pitchShift,-12);assert.ok(Math.abs(analysis.samples[25].hz-35)<.5);
});
test('shifted player mutes original, follows pause/seek/guide and ignores cancelled audio loads',async()=>{
  const old=globalThis.AudioContext,starts=[];
  globalThis.AudioContext=class {
    state='running';currentTime=0;destination={};
    createGain(){return{gain:{value:1},connect(){}};}
    createBufferSource(){return{connect(){},disconnect(){},start(t,offset){starts.push({stem:this.buffer.stem,offset});},stop(){}};}
    async decodeAudioData(bytes){return {duration:6,stem:bytes};}
    async close(){this.state='closed';}
  };
  try{
    let state=2,time=0,muted=false,mode='original';
    const p={getCurrentTime:()=>time,getPlayerState:()=>state,isMuted:()=>muted,mute:()=>muted=true,unMute:()=>muted=false,pauseVideo:()=>state=2};
    const guide=createKeyPlayback({player:()=>p,loadStem:async(ref,stem)=>stem,mode:()=>mode,status(){}});
    await guide.load({...reference,pitchShift:-2});assert.equal(muted,true);assert.equal(guide.ready(),true);
    state=1;guide.sync();assert.deepEqual(starts.map(s=>s.stem),['accompaniment','vocals']);
    state=2;guide.sync();time=3;mode='backing';state=1;guide.sync();assert.deepEqual(starts.at(-1),{stem:'accompaniment',offset:3});
    muted=false;guide.sync();assert.equal(muted,true);guide.clear();assert.equal(muted,false);
    let release;const pending=createKeyPlayback({player:()=>p,loadStem:()=>new Promise(r=>release=r),mode:()=>mode,status(){}});
    const loaded=pending.load({...reference,pitchShift:1});pending.clear();release('vocals');await loaded;
    assert.equal(pending.active(),false);assert.equal(muted,false);
  }finally{globalThis.AudioContext=old;}
});
