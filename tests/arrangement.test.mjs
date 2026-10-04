import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {arrangementSettings,arrangementCaption,arrangementRange,arrangementCovers,recordingBackingRoute,ARRANGEMENT_PRESETS} from '../arrangement-settings.mjs';
import {ArrangementArchive} from '../arrangement-server.mjs';
import {soulxSavedMetadata,soulxSettings} from '../soulx-settings.mjs';
test('arrangement captions support six presets and validated custom instruments without accepting unknown parameters',()=>{
  for(const [preset,p] of Object.entries(ARRANGEMENT_PRESETS)){const s=arrangementSettings({...p,preset});assert.match(arrangementCaption(s),/no vocals/);assert.deepEqual(s.instruments,p.instruments);}
  const s=arrangementSettings({preset:'custom',instruments:['flute','piano'],seed:0,unknown:'ignored'});assert.match(arrangementCaption(s),/flute, acoustic piano/);assert.equal(s.unknown,undefined);
  for(const bad of [{instruments:[]},{instruments:['piano','piano']},{instruments:['voice']},{strength:1.1},{seed:1.3},{style:'bad'}])assert.throws(()=>arrangementSettings(bad));
  assert.deepEqual(arrangementRange(0,600,600),{start:0,end:600});for(const a of [[0,601,610],[-1,30,40],[10,31,30],[1,1,30]])assert.throws(()=>arrangementRange(...a));
});
test('saved accompaniment coverage follows original song timestamps through split recording segments',()=>{
  const row={post:{reference:{cacheId:'song'},segments:[{offset:0,songTime:10,duration:6},{offset:6,songTime:20,duration:10}]}};
  assert.equal(arrangementCovers({cacheId:'song',start:15,end:21},row,{start:5,end:7}),true);
  assert.equal(arrangementCovers({cacheId:'song',start:15,end:20},row,{start:5,end:7}),false);
  assert.equal(arrangementCovers({cacheId:'other',start:0,end:60},row,{start:5,end:7}),false);
  assert.equal(arrangementCovers({cacheId:'song',start:0,end:60},row,{start:17,end:18}),false);
});
test('SoulX keeps generated accompaniment separately through saving and neutral reprocessing',()=>{
  const arrangement={id:randomUUID(),cacheId:'song',start:0,end:60},row={id:'old',title:'曲名',seconds:30,stems:['accompaniment','backing'],post:{reference:{cacheId:'song'},segments:[{offset:0,songTime:10,duration:30}]}};
  const input={row,arrangement,interval:{start:5,end:7},report:{settings:soulxSettings(),sourceSamples:48000,outputSamples:48000,sampleRate:24000},blend:100,match:true,useBacking:true,bytes:1,rawBytes:1};
  const meta=soulxSavedMetadata(input);assert.deepEqual(meta.arrangement,arrangement);assert.deepEqual(meta.stems,['arrangement']);assert.match(meta.title,/_新配樂$/);assert.deepEqual(meta.post.segments,[{offset:0,songTime:15,duration:2}]);assert.equal(recordingBackingRoute(meta,'arrangement'),`/arrangements/library/${arrangement.id}/audio`);
  assert.equal(soulxSavedMetadata({...input,useBacking:false}).arrangement,undefined);
  assert.equal(recordingBackingRoute(row,'backing'),'/library/song/backing');
});
test('accompaniment archive saves a durable aligned track with a descriptive filename and idempotent retry',async()=>{
  const library=await mkdtemp(path.join(tmpdir(),'arrangement-archive-')),id=randomUUID(),jobDir=path.resolve('.runtime/acestep/jobs',id);
  try{await mkdir(jobDir,{recursive:true});const wav=Buffer.from('fixture aligned audio');await writeFile(path.join(jobDir,'aligned.wav'),wav);
    const job={id,result:{title:'測試曲',cacheId:'song',sourceSeconds:194,start:0,end:194,settings:arrangementSettings()}};
    const first=await new ArrangementArchive(library).save(job),archive=new ArrangementArchive(library),rows=await archive.list();
    assert.match(first.title,/測試曲_配樂_鋼琴＋弦樂_0.00-194.00秒/);assert.equal(rows.records.length,1);assert.equal(first.seconds,194);assert.equal(first.rawBytes,0);
    assert.deepEqual(await readFile(path.join(archive.dir(id),'mix.wav')),wav);assert.equal((await archive.save(job)).created,first.created);
    await assert.rejects(archive.get('../wrong'));
  }finally{if(path.dirname(jobDir)===path.resolve('.runtime/acestep/jobs'))await rm(jobDir,{recursive:true,force:true});if(path.dirname(library)===path.resolve(tmpdir())&&path.basename(library).startsWith('arrangement-archive-'))await rm(library,{recursive:true,force:true,maxRetries:4});}
});
