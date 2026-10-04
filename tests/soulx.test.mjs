import test from 'node:test';
import assert from 'node:assert/strict';
import {soulxSettings,soulxInterval,soulxRangeLabel,soulxSavedMetadata,soulxOriginalReference,soulxSongSource} from '../soulx-settings.mjs';
import {validateSoulxRequest,validateSoulxWav} from '../soulx-server.mjs';
function wav(seconds=3){
  const b=Buffer.alloc(44+48000*seconds);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;
}
test('SoulX rejects invalid controls and never accepts tempo/pitch overrides',()=>{
  for(const s of [{steps:7},{steps:65},{steps:16.2},{guidance:Infinity},{guidance:5.1},{seed:-1},{reference:'../../x'},{referenceSeconds:16},{referenceStart:-1}])assert.throws(()=>soulxSettings(s));
  const s=soulxSettings({pitchShift:12,autoShift:true,speed:2});assert.equal(s.pitchShift,undefined);assert.equal(s.autoShift,undefined);assert.equal(s.speed,undefined);
});
test('SoulX waveform checks exact format, size and duration before launching Python',()=>{
  const valid=wav();assert.equal(validateSoulxWav(valid.toString('base64')).length,valid.length);
  for(const offset of [4,16,20,22,24,32,34,40]){const b=Buffer.from(valid);b[offset]^=1;assert.throws(()=>validateSoulxWav(b.toString('base64')));}
  assert.throws(()=>validateSoulxWav(valid.subarray(0,-2).toString('base64')));
  assert.throws(()=>validateSoulxWav(wav(16).toString('base64'),15));
  assert.throws(()=>validateSoulxRequest({settings:{reference:'self'},audio:valid.toString('base64')}));
  assert.equal(validateSoulxRequest({settings:{reference:'zh'},audio:valid.toString('base64')}).referenceAudio,null);
  assert.throws(()=>validateSoulxRequest({settings:{reference:'original'},audio:valid.toString('base64')}));
  assert.ok(validateSoulxRequest({settings:{reference:'original'},audio:valid.toString('base64'),referenceAudio:valid.toString('base64')}).referenceAudio);
});
test('original singer uses this recording library version and isolated lead when available',()=>{
  assert.equal(soulxOriginalReference({post:{reference:{cacheId:'song_v1'}}}),'/library/song_v1/vocals');
  assert.equal(soulxOriginalReference({post:{reference:{cacheId:'song_lead_v1',vocalMode:'lead'}}}),'/library/song_lead_v1/lead');
  assert.throws(()=>soulxOriginalReference({}));
});
test('original song is a full-length source without a recorded take or microphone delay',()=>{
  assert.equal(soulxSongSource(null),null);assert.equal(soulxSongSource({cacheId:'x',duration:264}),null);
  const song=soulxSongSource({cacheId:'song_lead_v1',duration:264.5,hasPreview:true,vocalMode:'lead',title:'Song'});
  assert.equal(song.rawBytes,undefined);assert.equal(song.appliedDelayMs,0);assert.equal(song.seconds,264.5);
  assert.deepEqual(song.stems,['accompaniment','backing']);assert.deepEqual(song.post.segments,[{offset:0,songTime:0,duration:264.5}]);
  const saved=soulxSavedMetadata({row:song,interval:{start:0,end:264.5},report:{settings:soulxSettings({reference:'custom'}),sourceSamples:6348000,outputSamples:6348000,sampleRate:24000},delayMs:0,blend:100,match:true,useBacking:true,bytes:10,rawBytes:8});
  assert.equal(saved.parentId,undefined);assert.equal(saved.soulx.sourceKind,'original');assert.equal(saved.soulx.sourceCacheId,'song_lead_v1');assert.match(saved.title,/原唱換聲.*整首/);
});
test('SoulX ranges reject reversed, non-finite and overly long input',()=>{
  for(const args of [[1,0,20],[0,20,10],[0,601,1000],[NaN,10,20],[0,.5,10]])assert.throws(()=>soulxInterval(...args));
  assert.deepEqual(soulxInterval(5,25,25),{start:5,end:25});
});
test('SoulX full-song labels require the actual end and saved clips rebase backing without double calibration',()=>{
  assert.match(soulxRangeLabel({start:0,end:260},261.490666),/^片段/);
  assert.match(soulxRangeLabel({start:0,end:261.490666},261.490666),/^整首/);
  const row={id:'original',title:'Song',seconds:20,appliedDelayMs:200,stems:['accompaniment'],postResult:{score:100},post:{offsetMs:200,reference:{duration:30},samples:[{offset:5,hz:440}],audioAnalysis:{stale:true},segments:[{offset:0,songTime:10,duration:6},{offset:6,songTime:20,duration:10}]}};
  const input={row,interval:{start:5,end:10},delayMs:200,report:{settings:soulxSettings(),sampleRate:24000,sourceSamples:120000,outputSamples:120000},blend:75,match:true,useBacking:true,bytes:10,rawBytes:8};
  const saved=soulxSavedMetadata(input);
  assert.notEqual(saved.id,row.id);assert.equal(saved.appliedDelayMs,0);assert.equal(saved.post.offsetMs,0);assert.equal(saved.soulx.sourceDelayMs,200);
  assert.deepEqual(saved.post.segments,[{offset:0,songTime:15,duration:1},{offset:1,songTime:20,duration:4}]);
  assert.equal(saved.seconds,5);assert.equal(saved.sourceSeconds,5);assert.equal(saved.post.audioAnalysis,undefined);assert.equal(saved.postResult,undefined);assert.deepEqual(saved.post.samples,[]);assert.equal(row.post.offsetMs,200);
  assert.match(saved.title,/SoulX.*片段5-10秒_AI75%/);
  const full=soulxSavedMetadata({...input,interval:{start:0,end:20},report:{...input.report,sourceSamples:480000,outputSamples:480000},useBacking:false});
  assert.match(full.title,/整首/);assert.equal(full.mode,'voice');assert.deepEqual(full.stems,[]);
  assert.throws(()=>soulxSavedMetadata({...input,report:{...input.report,outputSamples:100}}));
});
