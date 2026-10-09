import test from 'node:test';
import assert from 'node:assert/strict';
import {voicelabSettings,voicelabSongSource,voicelabSavedMetadata} from '../voicelab-settings.mjs';
import {validateVoiceLabRequest} from '../voicelab-server.mjs';
test('Voice Lab permits only vocal octaves, defaults to Ver3 original octave, and excludes arbitrary paths',()=>{
 assert.deepEqual(voicelabSettings(),{model:'ver3',pitchShift:0,indexRate:.75,protect:.33});
 for(const pitchShift of [-12,0,12])assert.equal(voicelabSettings({pitchShift}).pitchShift,pitchShift);
 for(const value of [{pitchShift:1},{pitchShift:'12'},{pitchShift:24},{indexRate:1.01},{protect:-.1},{protect:.51},{model:'../../x'}])assert.throws(()=>voicelabSettings(value));
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
