import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {RecordingSampleClock,pcmHeader,pcm16} from '../recording-pcm.mjs';
test('recording sample clock keeps pauses and delayed delivery on exact sample boundaries',()=>{
 const clock=new RecordingSampleClock(48000);clock.resume(10);clock.pause(12);clock.resume(14);clock.pause(17);
 assert.equal(clock.frames(1000),240000);
 assert.deepEqual(clock.portions(11*48000,4*48000),[{from:0,to:48000},{from:3*48000,to:4*48000}]);
 clock.resume(20);assert.equal(clock.frames(21),288000);clock.resume(21);assert.equal(clock.ranges.length,3);
});
test('PCM WAV headers describe exact frame counts and clipping keeps signed range',async()=>{
 const h=new DataView(await pcmHeader(240000,2,48000).arrayBuffer());assert.equal(h.getUint32(40,true),960000);assert.equal(h.getUint32(24,true),48000);
 const p=new DataView(await pcm16(Float32Array.from([-2,-1,0,1,2]),0,5).arrayBuffer());assert.deepEqual([0,2,4,6,8].map(i=>p.getInt16(i,true)),[-32768,-32768,0,32767,32767]);
});
test('15 minute worklet render retains every frame in both lanes, regardless of message batching',()=>{
 let Processor,total=0,expectedStart=0,blocks=0,stop=false;
 const sandbox={sampleRate:48000,currentFrame:0,Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage(message){
  if(message.stopped){stop=true;return;}
  assert.equal(message.start,expectedStart);expectedStart+=message.frames;total+=message.frames;blocks++;
  assert.equal(message.voice.length,message.frames);assert.equal(message.mix.length,message.frames*2);
  assert.equal(message.voice[0],.25);assert.equal(message.mix[0],.25);assert.equal(message.mix[1],-.25);
 }};}},registerProcessor(name,klass){Processor=klass;}};
 vm.runInNewContext(readFileSync(new URL('../recording-pcm-worklet.mjs',import.meta.url),'utf8'),sandbox);
 const processor=new Processor(),a=new Float32Array(128).fill(.25),b=new Float32Array(128).fill(-.25),out=[[new Float32Array(128)]];
 for(let frame=0;frame<48000*900;frame+=128){sandbox.currentFrame=frame;processor.process([[a],[a,b]],out);}
 processor.port.onmessage({data:'stop'});assert.equal(total,48000*900);assert.equal(stop,true);assert.equal(blocks,3600);
});
