import test from 'node:test';
import assert from 'node:assert/strict';
import {VOICELAB_DEFAULTS,voicelabSettings,voicelabSongSource,voicelabSavedMetadata,voicelabOriginalReference,voicelabBackingStems} from '../voicelab-settings.mjs';
import {recordingBackingRoute} from '../arrangement-settings.mjs';
import {validateVoiceLabRequest} from '../voicelab-server.mjs';
test('Voice Lab keeps legacy defaults and validates semitone and advanced settings',()=>{
 assert.deepEqual(voicelabSettings(),{model:'ver3',pitchShift:0,indexRate:.75,protect:.33,volumeEnvelope:1,f0Method:'rmvpe',autotune:false,autotuneStrength:1});
 assert.deepEqual(voicelabSettings({model:'wife_ver1'}),{...VOICELAB_DEFAULTS,model:'wife_ver1'});
 assert.deepEqual(voicelabSettings({model:'wife_ver2'}),{...VOICELAB_DEFAULTS,model:'wife_ver2'});
 for(const model of ['mosi_ver1','n_1_ver1','n2_ver','n3_ver','n4_ver'])assert.equal(voicelabSettings({model}).model,model);
 for(const pitchShift of [-12,-3,0,2,12])assert.equal(voicelabSettings({pitchShift}).pitchShift,pitchShift);
 for(const f0Method of ['rmvpe','fcpe','crepe'])assert.equal(voicelabSettings({f0Method}).f0Method,f0Method);
 assert.deepEqual(voicelabSettings({volumeEnvelope:.4,autotune:true,autotuneStrength:.5}),{...VOICELAB_DEFAULTS,volumeEnvelope:.4,autotune:true,autotuneStrength:.5});
 for(const value of [{pitchShift:1.5},{pitchShift:'12'},{pitchShift:24},{indexRate:1.01},{protect:-.1},{protect:.51},{model:'../../x'},{volumeEnvelope:-1},{volumeEnvelope:NaN},{autotuneStrength:1.1},{autotune:'false'},{f0Method:'../../x'}])assert.throws(()=>voicelabSettings(value));
 const s=voicelabSettings({modelPath:'bad',speed:2,autoShift:true,reference:'custom'});assert.deepEqual(s,voicelabSettings());
});
test('Voice Lab accepts 48 kHz mono PCM with no reference upload',()=>{
 const b=Buffer.alloc(44+96000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);
 assert.equal(validateVoiceLabRequest({audio:b.toString('base64'),settings:{pitchShift:12}}).settings.pitchShift,12);
 b.writeUInt32LE(24000,24);assert.throws(()=>validateVoiceLabRequest({audio:b.toString('base64')}));
});
test('AI vocal octave does not alter backing key or timestamps; saved clips preserve independent raw voice',()=>{
 const row=voicelabSongSource({cacheId:'song-key4',pitchShift:4,hasPreview:true,duration:20,title:'Song',vocalMode:'lead'});
 for(const pitchShift of [-12,0,12]){
  const meta=voicelabSavedMetadata({row,interval:{start:5,end:10},report:{settings:voicelabSettings({pitchShift}),sampleRate:48000,sourceSamples:240000,outputSamples:240000},delayMs:0,blend:100,match:true,useBacking:true,bytes:100,rawBytes:80});
  assert.equal(meta.post.reference.pitchShift,4);assert.equal(meta.appliedDelayMs,0);
  assert.deepEqual(meta.post.segments,[{offset:0,songTime:5,duration:5}]);
  assert.deepEqual(meta.stems,['accompaniment','backing']);assert.equal(meta.voicelab.report.settings.pitchShift,pitchShift);assert.equal(meta.soulx,undefined);
 }
});
test('lead conversion preserves backing vocals with original or replacement accompaniment and saved postprocessing routes',()=>{
 const row=voicelabSongSource({cacheId:'song',hasPreview:true,duration:20,title:'Song',vocalMode:'lead'}),arrangement={id:'new-backing',cacheId:'song',start:0,end:20};
 assert.equal(voicelabOriginalReference(row),'/library/song/lead');assert.deepEqual(voicelabBackingStems(row),['accompaniment','backing']);
 const meta=voicelabSavedMetadata({row,arrangement,interval:{start:5,end:10},report:{settings:voicelabSettings(),sampleRate:48000,sourceSamples:240000,outputSamples:240000},delayMs:0,blend:100,match:false,useBacking:true,bytes:1,rawBytes:1});
 assert.deepEqual(meta.stems,['arrangement','backing']);assert.equal(recordingBackingRoute(meta,'arrangement'),'/arrangements/library/new-backing/audio');assert.equal(recordingBackingRoute(meta,'backing'),'/library/song/backing');assert.deepEqual(meta.post.segments,[{offset:0,songTime:5,duration:5}]);
 const legacy={...row,stems:['arrangement'],arrangement};assert.deepEqual(voicelabBackingStems(legacy,arrangement),['arrangement','backing']);
 assert.deepEqual(voicelabBackingStems({...row,stems:['vocals','lead','accompaniment','backing','backing']}),['accompaniment','backing']);
});
