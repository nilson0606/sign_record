import test from 'node:test';
import assert from 'node:assert/strict';
import {vocalEffects} from '../recording-soften.mjs';

test('old recordings default to neutral effects; recipes sort independent regions without mutating the source',()=>{
  assert.deepEqual(vocalEffects(),{version:1,eq:{low:0,mid:0,high:0},compression:'off',reverb:0,regions:[]});
  const source={regions:[{start:3,end:4,volume:0},{start:0,end:1,volume:150}],eq:{high:-3},compression:'light',reverb:8};
  const snapshot=structuredClone(source),recipe=vocalEffects(source,5);
  assert.deepEqual(recipe.regions.map(r=>r.start),[0,3]);assert.equal(recipe.eq.high,-3);assert.deepEqual(source,snapshot);
  recipe.regions[0].volume=20;assert.deepEqual(source,snapshot);
});
test('invalid or overlapping local edits and unknown effect versions cannot be silently rendered',()=>{
  for(const regions of [[{start:1,end:1}],[{start:2,end:1}],[{start:-1,end:1}],[{start:0,end:6}],[{start:0,end:2},{start:1,end:3}],[{start:0,end:1,volume:201}],[{start:NaN,end:1}]])assert.throws(()=>vocalEffects({regions},5));
  for(const value of [{eq:{low:13}},{eq:{mid:Infinity}},{compression:'extreme'},{reverb:21},{version:2},{regions:'bad'}])assert.throws(()=>vocalEffects(value));
  assert.doesNotThrow(()=>vocalEffects({regions:[{start:0,end:1,volume:0},{start:1,end:2,volume:200}]},2));
});
