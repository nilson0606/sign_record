import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingEmotions,matchingRecordingEmotion,recordingEmotionSuffix} from '../recording-scenes.mjs';
import {vocalEffects,softeningProfile} from '../recording-soften.mjs';
import {settingDifferences} from '../recording-audition.mjs';

test('emotion recipes survive normalized archive roundtrips and ignore space and timing',()=>{
  assert.equal(Object.keys(recordingEmotions).length,11);
  assert.equal(matchingRecordingEmotion(),'original');
  for(const [id,p] of Object.entries(recordingEmotions)){
    const settings={softening:softeningProfile(p.softening).id,effects:vocalEffects({eq:p.eq,compression:p.compression,reverb:63,reverbOptions:{space:'cave',decay:4,preDelayMs:123},echo:{amount:25},regions:[{start:1,end:2,volume:70}]})};
    const restored=JSON.parse(JSON.stringify(settings));
    assert.equal(matchingRecordingEmotion(restored),id);
    restored.effects.eq.low=12;
    assert.equal(matchingRecordingEmotion(restored),'custom');
    assert.notEqual(p.eq.low,12,'editing does not alter the preset');
  }
});
test('AB emotion names accompany concrete parameter differences; original adds no processing',()=>{
  const raw={softening:'off',effects:vocalEffects()};
  const original={softening:recordingEmotions.original.softening,effects:vocalEffects(recordingEmotions.original)};
  assert.deepEqual(original,raw);
  assert.deepEqual(settingDifferences(raw,original),[]);
  const p=recordingEmotions.intimate,b={softening:p.softening,effects:vocalEffects(p)};
  assert.deepEqual(settingDifferences(raw,b).find(r=>r.label==='人聲情緒'),{label:'人聲情緒',a:'原音',b:'溫柔親密'});
  assert.ok(settingDifferences(raw,b).some(r=>r.label==='EQ 低頻'));
});
test('emotion filename labels only opt in for newly saved non-original settings',()=>{
  assert.equal(recordingEmotionSuffix({vocalEffects:recordingEmotions.sweet}),'');
  assert.equal(recordingEmotionSuffix({postEmotion:{version:1,id:'original'}}),'');
  assert.equal(recordingEmotionSuffix({postEmotion:{version:1,id:'sweet'}}),'情緒_甜蜜幸福');
  assert.equal(recordingEmotionSuffix({postEmotion:{version:2,id:'sweet'}}),'');
});
