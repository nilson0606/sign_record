import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {mediaStorageList,deleteMediaStorage} from '../media-storage.mjs';
const one='11111111-1111-4111-8111-111111111111',two='22222222-2222-4222-8222-222222222222';
function fixture(t){const root=mkdtempSync(path.join(tmpdir(),'karaoke-storage-'));t.after(()=>{if(path.dirname(root)===path.resolve(tmpdir())&&path.basename(root).startsWith('karaoke-storage-'))rmSync(root,{recursive:true,force:true});});return root;}
function temp(root,id){const dir=path.join(root,id);mkdirSync(dir);writeFileSync(path.join(dir,'input.wav'),'audio');writeFileSync(path.join(dir,'result.json'),JSON.stringify({modelLabel:'測試音色',seconds:3}));return dir;}
test('cleanup finds old jobs after restart, rejects active jobs and leaves recordings and models alone',t=>{
 const root=fixture(t),jobs=path.join(root,'jobs');mkdirSync(jobs);temp(jobs,one);temp(jobs,two);writeFileSync(path.join(root,'mix.wav'),'saved');writeFileSync(path.join(root,'voice.pth'),'model');
 const list=mediaStorageList(jobs,'temp',[two]);assert.equal(list.entries.length,2);assert.ok(list.bytes>10);assert.equal(list.entries.find(e=>e.id===two).locked,true);
 assert.throws(()=>deleteMediaStorage(jobs,'temp',{root:jobs,ids:[one,two]},[two]),/使用/);assert.ok(existsSync(path.join(jobs,one)),'selection is validated before any deletion');
 assert.throws(()=>deleteMediaStorage(jobs,'temp',{root,ids:[one]}),/位置已變更/);assert.throws(()=>deleteMediaStorage(jobs,'temp',{root:jobs,ids:['../mix.wav']}));
 const removed=deleteMediaStorage(jobs,'temp',{root:jobs,ids:[one]},[two]);assert.deepEqual(removed.deleted,[one]);assert.equal(mediaStorageList(jobs,'temp').entries.length,1);assert.ok(existsSync(path.join(root,'mix.wav')));assert.ok(existsSync(path.join(root,'voice.pth')));
});
test('cleanup ignores foreign content and linked folders or files',t=>{
 const root=fixture(t),jobs=path.join(root,'jobs');mkdirSync(jobs);const foreign=temp(jobs,one);writeFileSync(path.join(foreign,'keep.txt'),'keep');
 const outside=temp(root,two);symlinkSync(outside,path.join(jobs,two),process.platform==='win32'?'junction':'dir');
 assert.deepEqual(mediaStorageList(jobs,'temp').entries,[]);assert.throws(()=>deleteMediaStorage(jobs,'temp',{root:jobs,ids:[one]}));assert.ok(existsSync(path.join(outside,'input.wav')));
});
test('MV catalogue deletes only selected generated MP4s and checks stale selections',t=>{
 const root=fixture(t),videos=path.join(root,'vedio');mkdirSync(videos);
 for(const name of ['MV_我的歌_翻唱者_aabbccdd.mp4','MV_Another_Singer_11223344.mp4','other.mp4','MV_pending_12345678.mp4.tmp'])writeFileSync(path.join(videos,name),'video');
 const list=mediaStorageList(videos,'mv');assert.equal(list.entries.length,2);assert.equal(list.bytes,10);
 const chosen=list.entries.find(e=>e.name.includes('我的歌'));assert.throws(()=>deleteMediaStorage(videos,'mv',{root:videos,ids:[chosen.id,'../other.mp4']}));
 assert.ok(existsSync(path.join(videos,chosen.name)));assert.deepEqual(deleteMediaStorage(videos,'mv',{root:videos,ids:[chosen.id]}),{deleted:[chosen.id],bytes:5});
 assert.throws(()=>deleteMediaStorage(videos,'mv',{root:videos,ids:[chosen.id]}));assert.ok(existsSync(path.join(videos,'other.mp4')));assert.ok(existsSync(path.join(videos,'MV_pending_12345678.mp4.tmp')));
 assert.deepEqual(mediaStorageList(path.join(root,'absent'),'mv').entries,[]);
});
