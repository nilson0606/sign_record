import test from 'node:test';
import assert from 'node:assert/strict';
import {vocalEffects,reverbProfile,reverbDuration,reverbImpulse,recordingEffectsSuffix,effectsDuration,reverbSpacePresets} from '../recording-soften.mjs';
import {comparisonLevels} from '../recording-audition.mjs';
import {recordingEdit} from '../recording-process.mjs';
import {createHash} from 'node:crypto';

test('old recordings default to neutral effects; recipes sort independent regions without mutating the source',()=>{
  assert.deepEqual(vocalEffects(),{version:1,eq:{low:0,mid:0,high:0},compression:'off',reverb:0,regions:[]});
  const source={regions:[{start:3,end:4,volume:0},{start:0,end:1,volume:150}],eq:{high:-3},compression:'light',reverb:8};
  const snapshot=structuredClone(source),recipe=vocalEffects(source,5);
  assert.deepEqual(recipe.regions.map(r=>r.start),[0,3]);assert.equal(recipe.eq.high,-3);assert.deepEqual(source,snapshot);
  recipe.regions[0].volume=20;assert.deepEqual(source,snapshot);
});

test('reverb options validate, preserve legacy defaults and keep their own tail duration',()=>{
 assert.deepEqual(vocalEffects({reverb:20,reverbOptions:{space:'classic',decay:.8,preDelayMs:15}}),vocalEffects({reverb:20}));
 assert.equal(reverbDuration(vocalEffects({reverb:20})),.8);
 const recipe=vocalEffects({reverb:20,reverbOptions:{space:'hall',decay:10,preDelayMs:500}});
 assert.equal(reverbDuration(recipe),10.5);assert.equal(reverbDuration({...recipe,reverb:0}),0);
 for(const r of [{space:'unknown'},{decay:0},{decay:Infinity},{decay:10.1},{preDelayMs:-1},{preDelayMs:501}])assert.throws(()=>reverbProfile(r));
 const context={sampleRate:48000,createBuffer:(channels,length)=>{const data=Array.from({length:channels},()=>new Float32Array(length));return {length,getChannelData:c=>data[c]};}};
 const a=reverbImpulse(context,recipe),b=reverbImpulse(context,recipe);
 assert.deepEqual(a.getChannelData(0),b.getChannelData(0));
 assert.ok(a.getChannelData(0).slice(0,24000).every(x=>x===0));
 assert.ok(a.getChannelData(0).slice(24001).some(x=>x!==0));
 assert.notDeepEqual(a.getChannelData(0),a.getChannelData(1));
});

test('trim and fades are a non-destructive recipe on the original timeline',()=>{
 assert.deepEqual(recordingEdit(),{version:1,start:0,end:null,fadeIn:0,fadeOut:0});
 assert.deepEqual(recordingEdit({start:2,end:7,fadeIn:1,fadeOut:2},10),{version:1,start:2,end:7,fadeIn:1,fadeOut:2});
 for(const value of [{start:-1},{start:10},{start:NaN},{end:0},{end:11},{start:2,end:1},{fadeIn:Infinity},{fadeOut:-1},{fadeIn:6,fadeOut:5},{version:2}])assert.throws(()=>recordingEdit(value,10));
 assert.throws(()=>recordingEdit({start:2,end:3,fadeIn:.8,fadeOut:.8},10));
 assert.match(recordingEffectsSuffix({postEdit:{start:2,end:7,fadeIn:1,fadeOut:2}}),/剪輯2-7秒.*淡入1秒.*淡出2秒/);
});

test('echo, reverb color and phrase recipes validate and preserve independent tails',()=>{
 const value={reverbTone:{brightness:-50,width:0},echo:{amount:25,timeMs:1000,repeats:8,feedback:80,pingPong:true},effectRegions:[{start:2,end:3,reverb:60,echo:15,decay:10}]};
 const saved=structuredClone(value),r=vocalEffects(value,4);assert.deepEqual(value,saved);assert.equal(effectsDuration(r),10.015);
 assert.match(recordingEffectsSuffix({vocalEffects:r}),/殘響明亮-50.*殘響寬度0%.*回聲25%.*局部效果1段/);
 for(const value of [{reverbTone:{width:101}},{reverbTone:{brightness:NaN}},{echo:{repeats:2.5}},{echo:{feedback:81}},{echo:{timeMs:0}},{echo:{pingPong:'yes'}},{effectRegions:[{start:1,end:2},{start:1.5,end:3}]},{effectRegions:[{start:2,end:1}]},{effectRegions:[{start:0,end:1,decay:11}]}])assert.throws(()=>vocalEffects(value,4));
});

test('comparison gain matching attenuates louder buffers without boosting silence',()=>{
 const buffer=value=>({numberOfChannels:1,length:4,getChannelData:()=>new Float32Array(4).fill(value)});
 assert.deepEqual(comparisonLevels([buffer(.25),buffer(.5),buffer(0)]),[1,.5,1]);
 assert.deepEqual(comparisonLevels([buffer(.25),buffer(.5)],false),[1,1]);
});

test('legacy reverb impulse stays byte-identical to the published 5d378ee release',()=>{
 for(const [rate,expected] of [[48000,'0af4d56b85b5bc393046f72b62b82b56042e70bd8d718424b59348cb87f10f13'],[44100,'11637b3e7d9e84eff6f8eefe4cf0c9519ee6eae27ed5491eb66b18847d8d76f8']]){
  const context={sampleRate:rate,createBuffer:(n,len)=>{const channels=Array.from({length:n},()=>new Float32Array(len));return {getChannelData:c=>channels[c]};}};
  const impulse=reverbImpulse(context,vocalEffects({reverb:20})),hash=createHash('sha256');
  for(let c=0;c<2;c++)hash.update(Buffer.from(impulse.getChannelData(c).buffer));
  assert.equal(hash.digest('hex'),expected);
 }
});
test('invalid or overlapping local edits and unknown effect versions cannot be silently rendered',()=>{
  for(const regions of [[{start:1,end:1}],[{start:2,end:1}],[{start:-1,end:1}],[{start:0,end:6}],[{start:0,end:2},{start:1,end:3}],[{start:0,end:1,volume:201}],[{start:NaN,end:1}]])assert.throws(()=>vocalEffects({regions},5));
  for(const value of [{eq:{low:13}},{eq:{mid:Infinity}},{compression:'extreme'},{reverb:101},{version:2},{regions:'bad'}])assert.throws(()=>vocalEffects(value));
  assert.doesNotThrow(()=>vocalEffects({regions:[{start:0,end:1,volume:0},{start:1,end:2,volume:200}]},2));
});

test('the four published space impulses stay identical after adding new scenes',()=>{
 const expected={classic:['8c24a823fffed2acf5d0bb28472a8272249232b042041f7917435ec255978c1b','bed9a6f1a806001a379c97f029bd936c8df6529638ce034cbb22395a6bb9455f'],room:['ebede7ed9cfa2fdf15dec368faac62a39a799587c044b95c5f992b5ce9a01d00','2fe1eeaa7fb9ee1d58a5fbab0539c7974beed149d0728a21537d5865bff8ccbf'],hall:['30264cd20b312ff3dc2b237272615498d01b3bb2345a2a7cb2d20470292922a5','9e12b0480c0844e1e450de8ba944714fb7cb221393bc5ce5d519eb336a0d3560'],plate:['c18e356f338f4701c02f865b4709d88a81d9619174ee2b4b0bc789d9f43f495e','6a2c1b3e53c69cf09290edcafd75dd95643cc4ebd242b59019e440d2aa9b3b46']};
 for(const [space,hashes] of Object.entries(expected))for(const [index,rate] of [44100,48000].entries()){
  const context={sampleRate:rate,createBuffer:(n,len)=>{const channels=Array.from({length:n},()=>new Float32Array(len));return {getChannelData:c=>channels[c]};}};
  const b=reverbImpulse(context,vocalEffects({reverb:30,reverbOptions:{space,decay:1.8,preDelayMs:25}})),hash=createHash('sha256');for(let c=0;c<2;c++)hash.update(Buffer.from(b.getChannelData(c).buffer));assert.equal(hash.digest('hex'),hashes[index],space+' '+rate);
 }
});

test('eight new spaces have distinct repeatable reflections at equal timing and bounded energy',()=>{
 assert.equal(Object.keys(reverbSpacePresets).length,12);
 for(const rate of [44100,48000]){
  const signatures=new Set(),context={sampleRate:rate,createBuffer:(n,len)=>{const channels=Array.from({length:n},()=>new Float32Array(len));return {getChannelData:c=>channels[c]};}};
  for(const [space,preset] of Object.entries(reverbSpacePresets).slice(4)){
   const saved=vocalEffects({reverb:40,reverbOptions:{space,decay:preset.decay,preDelayMs:preset.preDelayMs}});assert.match(recordingEffectsSuffix({vocalEffects:saved}),new RegExp(preset.label));assert.deepEqual(vocalEffects(JSON.parse(JSON.stringify(saved))),saved);
   for(const decay of [.2,2,10]){
    const recipe=vocalEffects({reverb:40,reverbOptions:{space,decay,preDelayMs:40}}),b=reverbImpulse(context,recipe);
    for(let c=0;c<2;c++){const a=b.getChannelData(c);assert.ok(a.every(Number.isFinite));assert.ok(a.slice(0,Math.floor(rate*.04)).every(x=>x===0));assert.ok(a.at(-1)===0);assert.ok(Math.abs(a.reduce((sum,x)=>sum+x*x,0)-.65**2)<1e-6);}
    if(decay===2){const a=b.getChannelData(0);assert.deepEqual(a,reverbImpulse(context,recipe).getChannelData(0));signatures.add(createHash('sha256').update(Buffer.from(a.buffer)).digest('hex'));}
   }
  }
  assert.equal(signatures.size,8);
 }
});
