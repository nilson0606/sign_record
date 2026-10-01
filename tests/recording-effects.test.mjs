import test from 'node:test';
import assert from 'node:assert/strict';
import {vocalEffects,reverbProfile,reverbDuration,reverbImpulse,recordingEffectsSuffix} from '../recording-soften.mjs';
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
