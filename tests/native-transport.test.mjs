import test from 'node:test';
import assert from 'node:assert/strict';
import {installNativeTransport} from '../native-microphone.mjs';

test('background transport preserves PCM across split headers and arbitrary byte boundaries',async()=>{
 const originalFetch=globalThis.fetch,messages=[],received=[],meta={sampleRate:48000,channels:1,label:'Synthetic'};
 const pcm=Float32Array.from({length:2137},(_,i)=>Math.sin(i)*.2),header=new TextEncoder().encode(JSON.stringify(meta)+'\n');
 const bytes=new Uint8Array(header.length+pcm.byteLength);bytes.set(header);bytes.set(new Uint8Array(pcm.buffer),header.length);
 let closed=0,finish;const done=new Promise(r=>finish=r);
 globalThis.fetch=async()=>new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;){const n=(i%59)+1;c.enqueue(bytes.slice(i,i+n));i+=n;}c.close();}}));
 try{
  const scope={postMessage:m=>{messages.push(m);if(m.error)finish();}};installNativeTransport(scope);
  scope.onmessage({data:{type:'start',token:'fixture',deviceId:'fixture',port:{postMessage:a=>received.push(...a),close:()=>closed++}}});
  await done;assert.deepEqual(messages[0],{meta});assert.deepEqual(received,Array.from(pcm));assert.match(messages.at(-1).error,/中斷/);assert.equal(closed,1);
 }finally{globalThis.fetch=originalFetch;}
});

test('cancelled background capture closes consumers without reporting a spurious capture failure',async()=>{
 const originalFetch=globalThis.fetch,messages=[];let aborted=false,closed=false;
 globalThis.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('abort','AbortError'));},{once:true}));
 try{
  const scope={postMessage:m=>messages.push(m)};installNativeTransport(scope);
  scope.onmessage({data:{type:'start',token:'fixture',deviceId:'fixture',port:{close:()=>closed=true}}});
  scope.onmessage({data:{type:'stop'}});await new Promise(r=>setImmediate(r));
  assert.ok(aborted&&closed);assert.deepEqual(messages,[]);
 }finally{globalThis.fetch=originalFetch;}
});
