import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../native-mic-worklet.mjs',import.meta.url),'utf8');
function processor(options){let Type;const messages=[];vm.runInNewContext(source,{Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:x=>messages.push(x)};}},registerProcessor:(name,cls)=>Type=cls});return{p:new Type(options),messages};}
const render=p=>{const out=new Float32Array(128);p.process([],[[out]]);return out;};
test('native PCM retains sample order across packets; preroll is silent until ready',()=>{const {p,messages}=processor();p.port.onmessage({data:Float32Array.from({length:960},(_,i)=>i/2000)});assert.ok(render(p).every(x=>x===0));p.port.onmessage({data:Float32Array.from({length:960},(_,i)=>(i+960)/2000)});const output=[];for(let i=0;i<15;i++)output.push(...render(p));assert.deepEqual(output,Array.from(Float32Array.from({length:1920},(_,i)=>i/2000)));assert.deepEqual(JSON.parse(JSON.stringify(messages)),[{ready:true}]);});
test('native PCM stops reporting audio on excessive delay or stalled capture',()=>{const a=processor();a.p.port.onmessage({data:new Float32Array(12001)});assert.ok(a.messages[0].error);const b=processor();b.p.port.onmessage({data:new Float32Array(1920).fill(.2)});for(let i=0;i<110;i++)render(b.p);assert.ok(b.messages.some(x=>x.error));assert.ok(render(b.p).every(x=>x===0));});

test('monitor starts after 20 ms while recording retains 40 ms of preroll',()=>{
 const monitor=processor({processorOptions:{prebufferFrames:960}}),recording=processor();
 const packet=Float32Array.from({length:480},(_,i)=>i/1000);
 for(const {p} of [monitor,recording])p.port.onmessage({data:packet});
 assert.ok(render(monitor.p).every(x=>x===0));assert.ok(render(recording.p).every(x=>x===0));
 for(const {p} of [monitor,recording])p.port.onmessage({data:packet});
 assert.deepEqual(Array.from(render(monitor.p)),Array.from(packet.slice(0,128)));
 assert.ok(render(recording.p).every(x=>x===0));
 assert.equal(monitor.messages.filter(m=>m.ready).length,1);assert.equal(recording.messages.length,0);
});
test('independent monitor rendering does not consume or modify recording samples',()=>{
 const monitor=processor({processorOptions:{prebufferFrames:960}}),recording=processor();
 const packet=Float32Array.from({length:1920},(_,i)=>i/2000);
 monitor.p.port.onmessage({data:packet.slice()});recording.p.port.onmessage({data:packet});
 for(let i=0;i<15;i++)render(monitor.p);
 const original=[];for(let i=0;i<15;i++)original.push(...render(recording.p));
 assert.deepEqual(original,Array.from(packet));
});
