import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../native-mic-worklet.mjs',import.meta.url),'utf8');
function processor(options){let Type;const messages=[];vm.runInNewContext(source,{Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:x=>messages.push(x)};}},registerProcessor:(name,cls)=>Type=cls});return{p:new Type(options),messages};}
const render=p=>{const out=new Float32Array(128);p.process([],[[out]]);return out;};
test('native PCM retains sample order across packets; preroll is silent until ready',()=>{const {p,messages}=processor();p.port.onmessage({data:Float32Array.from({length:960},(_,i)=>i/6000)});assert.ok(render(p).every(x=>x===0));p.port.onmessage({data:Float32Array.from({length:4800},(_,i)=>(i+960)/6000)});const output=[];for(let i=0;i<45;i++)output.push(...render(p));assert.deepEqual(output,Array.from(Float32Array.from({length:5760},(_,i)=>i/6000)));assert.deepEqual(JSON.parse(JSON.stringify(messages)),[{ready:true}]);});
test('native PCM stops reporting audio on excessive delay or stalled capture',()=>{const a=processor();a.p.port.onmessage({data:new Float32Array(12001)});assert.ok(a.messages[0].error);const b=processor();b.p.port.onmessage({data:new Float32Array(5760).fill(.2)});for(let i=0;i<110;i++)render(b.p);assert.ok(b.messages.some(x=>x.error));assert.ok(render(b.p).every(x=>x===0));});

test('legacy browser monitor retains 40 ms while recording reserves 120 ms',()=>{
 const monitor=processor({processorOptions:{prebufferFrames:1920}}),recording=processor();
 const packet=Float32Array.from({length:960},(_,i)=>i/2000);
 for(const {p} of [monitor,recording])p.port.onmessage({data:packet});
 assert.ok(render(monitor.p).every(x=>x===0));assert.ok(render(recording.p).every(x=>x===0));
 for(const {p} of [monitor,recording])p.port.onmessage({data:packet});
 assert.deepEqual(Array.from(render(monitor.p)),Array.from(packet.slice(0,128)));
 assert.ok(render(recording.p).every(x=>x===0));
 assert.equal(monitor.messages.filter(m=>m.ready).length,1);assert.equal(recording.messages.length,0);
});
test('independent monitor rendering does not consume or modify recording samples',()=>{
 const monitor=processor({processorOptions:{prebufferFrames:960}}),recording=processor();
 const packet=Float32Array.from({length:5760},(_,i)=>i/6000);
 monitor.p.port.onmessage({data:packet.slice()});recording.p.port.onmessage({data:packet});
 for(let i=0;i<15;i++)render(monitor.p);
 const original=[];for(let i=0;i<45;i++)original.push(...render(recording.p));
 assert.deepEqual(original,Array.from(packet));
});

test('a real capture stall is reported once and cannot resume with silently shifted audio',()=>{
 const {p,messages}=processor();p.receive(new Float32Array(5760).fill(.2));for(let i=0;i<45;i++)render(p);
 render(p);assert.equal(messages.filter(x=>x.error).length,1);
 p.receive(new Float32Array(960).fill(.4));assert.ok(render(p).every(x=>x===0));assert.equal(messages.filter(x=>x.error).length,1);
});

test('late packets reproduce the previous premature stop but do not interrupt the reserved recording buffer',()=>{
 for(const [prebufferFrames,shouldFail] of [[1920,true],[undefined,false]]){
  const {p}=processor({processorOptions:{prebufferFrames}});let sent=0,zeros=0;
  for(let frame=0;frame<48000*10;frame+=128){
   const time=frame/48000;
   // PCM is intact: only delivery stalls for 80 ms at 6.8 seconds.
   if(!(time>=6.8&&time<6.88))while(sent*960<=frame){p.receive(new Float32Array(960).fill(.2));sent++;}
   const started=p.started,out=render(p);if(started)zeros+=out.filter(x=>x===0).length;
  }
  assert.equal(p.failed,shouldFail);
  if(!shouldFail)assert.equal(zeros,0,'no silence insertion to hide a transport delay');
 }
});

test('15 minute mismatched capture/render clocks and packet jitter stay continuous and bounded',()=>{
 for(const ppm of [-2000,0,2000]){
  const {p,messages}=processor(),rate=48000*(1+ppm/1e6),duration=900,packet=960;
  let next=0,produced=0,minimum=Infinity,maximum=0,maxJump=0,last=null,zeroSamples=0;
  // A nonzero test waveform makes any inserted silence unambiguous.
  const feed=()=>{const a=Float32Array.from({length:packet},(_,i)=>.3+.1*Math.sin(2*Math.PI*220*(produced+i)/rate));produced+=packet;p.receive(a);};
  for(let frame=0;frame<duration*48000;frame+=128){
   const time=frame/48000;
   while(next<=time){feed();const packetIndex=produced/packet;next=packetIndex*packet/rate+(packetIndex%61===0?.080:0);}
   const started=p.started,out=render(p);
   assert.equal(p.failed,false,JSON.stringify({ppm,time,count:p.count,messages}));
   if(started){minimum=Math.min(minimum,p.count);maximum=Math.max(maximum,p.count);for(const x of out){if(x===0)zeroSamples++;if(last!==null)maxJump=Math.max(maxJump,Math.abs(x-last));last=x;}}
  }
  assert.equal(zeroSamples,0);assert.ok(maxJump<.004,JSON.stringify({ppm,maxJump}));
  assert.ok(minimum>0&&maximum<10000,JSON.stringify({ppm,minimum,maximum}));
  // Input position follows elapsed capture time with a bounded fixed buffer,
  // not a drift that accumulates over the 15 minute recording.
  const pendingMs=p.count/rate*1000;assert.ok(pendingMs<180,JSON.stringify({ppm,pendingMs}));
  console.log('Native clock continuity',JSON.stringify({ppm,zeroSamples,maxJump,minimum,maximum,pendingMs}));
 }
});
