import test from 'node:test';
import assert from 'node:assert/strict';
import {initialRecordingEffects,recordingScenes,recordingSceneDefaultsVersion,matchingRecordingScene} from '../recording-scenes.mjs';
import {vocalEffects} from '../recording-soften.mjs';

test('new scene defaults require opt-in metadata, never a recording date',()=>{
  for(const created of [0,Date.now(),Date.now()+86400000]){
    const old={created},before=structuredClone(old),effects=initialRecordingEffects(old);
    assert.equal(effects.reverb,20);assert.equal(effects.echo,undefined);assert.deepEqual(old,before);
  }
  const effects=initialRecordingEffects({postDefaults:recordingSceneDefaultsVersion});
  assert.equal(effects.echo.amount,10);assert.equal(effects.reverb,20);assert.equal(effects.reverbOptions.space,'hall');
  effects.echo.amount=75;assert.equal(initialRecordingEffects({postDefaults:recordingSceneDefaultsVersion}).echo.amount,10);
});
test('saved effects, including disabled effects, take precedence over scene defaults',()=>{
  const row={postDefaults:recordingSceneDefaultsVersion,vocalEffects:vocalEffects({reverb:0,echo:{amount:0}})};
  const loaded=initialRecordingEffects(row);assert.deepEqual(loaded,row.vocalEffects);loaded.eq.low=4;assert.equal(row.vocalEffects.eq.low,0);
});
test('scene recognition survives stored recipe normalization and ignores independent voice processing',()=>{
  for(const [key,scene] of Object.entries(recordingScenes)){
    const effects=vocalEffects({...scene.effects,eq:{low:3},compression:'light',regions:[{start:0,end:1,volume:80}]});
    assert.equal(matchingRecordingScene(effects),key);
    effects.reverb+=1;assert.equal(matchingRecordingScene(effects),'');
  }
});
