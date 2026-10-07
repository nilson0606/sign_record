import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {monitorControl} from '../native-microphone-server.mjs';

function fixture(){
 const child=new EventEmitter(),sent=[];
 child.stderr=new PassThrough();
 child.stdin=new Writable({write(chunk,encoding,next){sent.push(JSON.parse(chunk.toString()));next();}});
 const control=monitorControl(child);
 const reply=(sequence,state,error='')=>child.stderr.write(JSON.stringify({monitor:true,sequence,state,error})+'\n');
 return{child,sent,control,reply};
}
const set=(sequence,enabled=true)=>({action:'set',sequence,enabled,deviceId:'speaker',volume:.3});

test('capture diagnostics stay separate from speaker acknowledgements',async()=>{
 const f=fixture(),events=[],control=monitorControl(f.child,event=>events.push(event));
 try{
  const pending=control.command(set(0));let settled=false;pending.then(()=>settled=true);
  f.child.stderr.write(JSON.stringify({capture:true,event:'error',code:'device-discontinuity',frame:48000})+'\n');
  await new Promise(r=>setImmediate(r));assert.equal(settled,false);assert.equal(events[0].code,'device-discontinuity');
  f.reply(0,'running');assert.equal((await pending).state,'running');
 }finally{control.close();f.control.close();}
});

test('monitor control waits for actual output readiness; heartbeat does not restart output',async()=>{
 const f=fixture();
 try{
  const pending=f.control.command(set(0));let resolved=false;pending.then(()=>resolved=true);
  f.reply(0,'starting');await Promise.resolve();assert.equal(resolved,false);
  f.reply(0,'running');assert.equal((await pending).state,'running');
  assert.equal((await f.control.command({action:'keepalive',sequence:0})).state,'running');
  assert.deepEqual(f.sent.map(c=>c.action),['set','keepalive']);
 }finally{f.control.close();}
});

test('new stop supersedes pending start; stale commands and stale acknowledgements cannot enable output',async()=>{
 const f=fixture();
 try{
  const start=f.control.command(set(3)),rejected=assert.rejects(start,/更新/);
  const stop=f.control.command(set(4,false));await rejected;
  f.reply(3,'running');f.reply(4,'off');assert.equal((await stop).state,'off');
  await assert.rejects(f.control.command(set(3)),/更新/);
  assert.equal(f.sent.length,2);
 }finally{f.control.close();}
});

test('output failure is reported without killing capture; capture exit rejects pending monitor request',async()=>{
 const f=fixture();
 try{
  const first=f.control.command(set(0)),failed=assert.rejects(first,/unplugged/);
  f.reply(0,'error','unplugged');await failed;
  const retry=f.control.command(set(1));f.reply(1,'running');assert.equal((await retry).state,'running');
  const pending=f.control.command(set(2)),closed=assert.rejects(pending,/停止/);
  f.child.emit('close');await closed;
  await assert.rejects(f.control.command(set(3)),/停止/);
 }finally{f.control.close();}
});
