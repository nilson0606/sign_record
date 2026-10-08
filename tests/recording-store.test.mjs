import test from 'node:test';
import assert from 'node:assert/strict';
import {RecordingStore} from '../recording-store.mjs';

function fixture(n=10){
  const store=new RecordingStore(),root='fixture/recordings';
  let rows=Array.from({length:n},(_,i)=>({id:'take-'+i,created:i,bytes:3,_archiveRoot:root}));
  const calls=[],deleted=[];
  store.browser={list:async()=>[],delete:async id=>deleted.push(id)};
  store.info=async()=>{calls.push('list');return {records:[...rows],path:root,deleted:[]};};
  store.request=async(route,options)=>{
    calls.push({route,...options});assert.equal(options.root,root);
    if(options.method==='DELETE')rows=rows.filter(r=>route!=='/recordings/'+r.id);
    return {json:async()=>({path:'fixture.mp3'})};
  };
  return {store,calls,deleted};
}

test('deleting ten listed recordings needs no per-recording inventory scans',async()=>{
  const {store,calls,deleted}=fixture();const rows=await store.list();
  for(const row of rows)await store.delete(row.id);
  assert.equal(calls.filter(x=>x==='list').length,1);
  assert.equal(calls.filter(x=>x.method==='DELETE').length,10);
  assert.equal(deleted.length,10);assert.deepEqual(await store.list(),[]);
  assert.equal(calls.filter(x=>x==='list').length,2,'one scan before and one after the batch');
});

test('delete-all and MP3 use listed roots; unknown IDs still require discovery',async()=>{
  const {store,calls}=fixture(2);await store.list();
  await store.saveMp3({id:'take-0'},new Blob(['mp3']));
  assert.equal(calls.filter(x=>x==='list').length,1);
  assert.equal(await store.deleteAll(),2);
  assert.equal(calls.filter(x=>x==='list').length,2);
  const unknown=fixture(1);await unknown.store.delete('take-0');
  assert.equal(unknown.calls.filter(x=>x==='list').length,1);assert.deepEqual(unknown.deleted,['take-0']);
});

test('failed or stale-root disk delete preserves the browser copy and remains retryable',async()=>{
  const {store,deleted}=fixture(1);await store.list();const request=store.request;
  store.request=async()=>{throw Error('歌曲庫位置已變更');};
  await assert.rejects(store.delete('take-0'),/歌曲庫位置已變更/);
  assert.deepEqual(deleted,[]);assert.equal(store.diskRows.length,1);
  store.request=request;await store.delete('take-0');assert.deepEqual(deleted,['take-0']);
});

test('overlapping readers share one scan but reads after a queued delete stay fresh',async()=>{
  const {store,calls}=fixture(2);let release;
  store.browser.list=()=>new Promise(resolve=>{release=()=>resolve([]);});
  const first=store.list(),same=store.list();assert.equal(first,same);
  await Promise.resolve();release();await first;
  store.browser.list=async()=>[];
  const before=store.list(),remove=store.delete('take-0'),after=store.list();
  assert.notEqual(before,after);assert.equal(store.list(),after);
  assert.equal((await before).length,2);await remove;
  assert.deepEqual((await after).map(r=>r.id),['take-1']);
  assert.equal(calls.filter(x=>x==='list').length,3);
  await store.list();assert.equal(calls.filter(x=>x==='list').length,4,'completed snapshots are not cached indefinitely');
});

test('coalesced offline readers retain browser takes and a later refresh retries',async()=>{
  const {store}=fixture(1);store.browser.list=async()=>[{id:'browser-only',bytes:1}];
  const info=store.info;store.info=async()=>{throw Error('offline');};
  assert.equal((await store.list())[0].id,'browser-only');
  store.info=info;assert.equal((await store.list()).length,2);
});
