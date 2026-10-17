import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseMediaRange,localMediaInfo} from '../local-media-server.mjs';
import {isMediaId,isLocalMediaId} from '../media-source.mjs';
import {LocalLibrary,cacheKey} from '../local-library.mjs';
import {transposeReference} from '../song-key.mjs';
const id='local_'+'a'.repeat(64);
test('local identities stay distinct from YouTube and cannot become paths',()=>{
 assert.ok(isMediaId('M7lc1UVf-VE'));assert.ok(isLocalMediaId(id));assert.ok(isMediaId(id));
 for(const value of ['local_../secret','local_'+ 'a'.repeat(63),id+'/../x','file:///test'])assert.equal(isMediaId(value),false);
});
test('local MV byte ranges support seeking and reject malformed ranges',()=>{
 assert.deepEqual(parseMediaRange('bytes=10-19',100),{start:10,end:19,partial:true});
 assert.deepEqual(parseMediaRange('bytes=-20',100),{start:80,end:99,partial:true});
 assert.deepEqual(parseMediaRange('bytes=10-',100),{start:10,end:99,partial:true});
 for(const value of ['bytes=100-','bytes=20-10','bytes=0-1,5-6','bytes=-','bytes=-0'])assert.equal(parseMediaRange(value,100),null);
});
test('local MV versions share masks, retain identity across keys, and keep the source when a baseline is deleted',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'karaoke-local-mv-'));
 try{
  const dir=path.join(root,'.local-mv',id);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'video.mp4'),'fixture source');
  await writeFile(path.join(dir,'metadata.json'),JSON.stringify({id,title:'本機測試',duration:8}));
  assert.equal((await localMediaInfo(root,id)).title,'本機測試');await assert.rejects(localMediaInfo(root,'../x'));
  const library=new LocalLibrary(root),ref={version:1,videoId:id,title:'本機測試',duration:8,rangeSeconds:0,step:.1,frames:Array(80).fill(440)},base=cacheKey(id,0),shifted=cacheKey(id,0,'all','demucs','yin','single',4);
  await library.save(base,ref,root,false);await library.save(shifted,transposeReference(ref,4),root,false);
  await library.setMasks(base,[{start:1,end:2}]);assert.deepEqual((await library.get(shifted)).masks,[{start:1,end:2}]);
  assert.equal((await library.list()).length,2);assert.equal((await library.get(shifted)).videoId,id);
  await library.delete(base);assert.ok(await library.get(shifted));assert.equal(await readFile(path.join(dir,'video.mp4'),'utf8'),'fixture source');
 }finally{await rm(root,{recursive:true,force:true});}
});
