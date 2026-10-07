import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentDraft,splitSegment,moveBoundary,mergeBoundary,validateSegmentDraft,normalizeSegmentNames,parseSegmentTime,formatSegmentTime,missingSegmentRanges,composeSegmentVoice} from '../recording-segments.mjs';

globalThis.AudioBuffer=class{constructor({length,sampleRate,numberOfChannels}){Object.assign(this,{length,sampleRate,numberOfChannels,duration:length/sampleRate});this.channels=Array.from({length:numberOfChannels},()=>new Float32Array(length));}getChannelData(c){return this.channels[c];}};
const ref={cacheId:'fixture',duration:4};
const draft=()=>segmentDraft(ref);
test('default names follow order after splits and merges while custom names survive',()=>{
 const d=draft();splitSegment(d,2);splitSegment(d,1);splitSegment(d,3);
 assert.deepEqual(d.parts.map(p=>p.name),['第 1 段','第 2 段','第 3 段','第 4 段']);
 d.parts[1].name='副歌';d.parts[1].autoName=false;d.parts[2].takeId='saved';const id=d.parts[2].id;
 mergeBoundary(d,1);assert.deepEqual(d.parts.map(p=>p.name),['第 1 段','第 2 段','第 3 段']);assert.equal(d.parts[1].id,id);assert.equal(d.parts[1].takeId,'saved');
 d.parts[1].name='第 99 段';d.parts[1].autoName=false;splitSegment(d,2.5);
 assert.equal(d.parts[1].name,'第 99 段');assert.equal(d.parts[2].name,'第 99 段（後段）');
});
test('legacy default names migrate without altering timing, source choices or custom labels',()=>{
 const d=draft();splitSegment(d,1);splitSegment(d,2);splitSegment(d,3);
 const names=['第 1 段','第 1 段（後段）','第 1 段（後段）（後段）','副歌'];
 d.parts.forEach((p,i)=>{delete p.autoName;p.name=names[i];p.takeId='take-'+i;});
 const before=d.parts.map(({id,start,end,takeId})=>({id,start,end,takeId}));normalizeSegmentNames(d);
 assert.deepEqual(d.parts.map(p=>p.name),['第 1 段','第 2 段','第 3 段','副歌']);
 assert.deepEqual(d.parts.map(({id,start,end,takeId})=>({id,start,end,takeId})),before);
 splitSegment(d,3.5);assert.equal(d.parts[3].name,'副歌');assert.equal(d.parts[4].name,'副歌（後段）');
});
function source(id,start,duration,value,rate=1000){const audio=new AudioBuffer({length:duration*rate,sampleRate:rate,numberOfChannels:1});audio.getChannelData(0).fill(value);return{audio,meta:{id,rawBytes:audio.length*2+44,seconds:duration,post:{segments:[{songTime:start,offset:0,duration}]}}};}

test('splitting, moving and merging share boundaries and preserve source choices',()=>{
 const d=draft();d.parts[0].takeId='take';splitSegment(d,2);assert.deepEqual(d.parts.map(p=>[p.start,p.end,p.takeId]),[[0,2,'take'],[2,4,'take']]);
 moveBoundary(d,1,1.7);assert.equal(d.parts[0].end,d.parts[1].start);assert.throws(()=>moveBoundary(d,1,4));assert.throws(()=>splitSegment(d,1.7));
 mergeBoundary(d,1);assert.equal(d.parts.length,1);assert.equal(d.parts[0].takeId,'take');assert.equal(d.parts[0].end,4);
 splitSegment(d,2);d.parts[1].takeId='other';mergeBoundary(d,1);assert.equal(d.parts[0].takeId,null,'different choices require reselection, no audio deleted');validateSegmentDraft(d);
});
test('precise time input does not lose milliseconds or allow invalid input',()=>{
 assert.equal(parseSegmentTime('01:22.300'),82.3);assert.equal(formatSegmentTime(82.3),'01:22.300');assert.equal(formatSegmentTime(59.9999),'01:00.000');assert.throws(()=>parseSegmentTime('1:70'));assert.throws(()=>parseSegmentTime('abc'));
});
test('coverage includes source clock gaps and moved boundaries',()=>{
 const d=draft();splitSegment(d,2);d.baseId='base';d.parts[1].takeId='patch';
 const base=source('base',0,4,.1),patch=source('patch',1.8,2.2,.5);
 assert.deepEqual(missingSegmentRanges(d,[base.meta,patch.meta],200),[]);
 moveBoundary(d,1,1);assert.deepEqual(missingSegmentRanges(d,[base.meta,patch.meta],200),[d.parts[1].name]);
 patch.meta.post.segments=[{songTime:1,offset:0,duration:.3},{songTime:2,offset:.3,duration:2}];assert.equal(missingSegmentRanges(d,[base.meta,patch.meta],0).length,1);
 assert.equal(missingSegmentRanges(d,[base.meta],0).length,1,'missing selected take is not silently replaced');
});
test('splice stays at the selected song time after +200 ms correction, sources unchanged',()=>{
 const d=draft();splitSegment(d,2);d.baseId='base';d.parts[1].takeId='patch';
 const base=source('base',0,4,.1),patch=source('patch',1,3,.5,2000),before=base.audio.getChannelData(0).slice();
 const raw=composeSegmentVoice(d,new Map([['base',base],['patch',patch]]),{sampleRate:1000,delayMs:200,crossfade:0});
 assert.equal(raw.length,4200);assert.ok(Math.abs(raw.getChannelData(0)[2199]-.1)<1e-6);assert.equal(raw.getChannelData(0)[2200],.5);
 assert.equal(raw.getChannelData(0)[4100],0);assert.deepEqual(base.audio.getChannelData(0),before);
});
test('crossfade removes a hard join with handles; gap silence does not stretch song time',()=>{
 const d=draft();splitSegment(d,2);d.parts[0].takeId='a';d.parts[1].takeId='b';const a=source('a',0,4,.1),b=source('b',0,4,.5);
 const raw=composeSegmentVoice(d,new Map([['a',a],['b',b]]),{sampleRate:1000,delayMs:0,crossfade:.012});
 assert.ok(Math.abs(raw.getChannelData(0)[2000]-.3)<1e-6);assert.ok(Math.abs(raw.getChannelData(0)[1999]-raw.getChannelData(0)[2000])<.02);
 const gap=composeSegmentVoice(d,new Map([['b',b]]),{sampleRate:1000,delayMs:0});assert.equal(gap.length,4000);assert.equal(gap.getChannelData(0)[1000],0);assert.equal(gap.getChannelData(0)[3000],.5);
});
test('source pause and seek mappings place samples on the song clock',()=>{
 const d=draft();d.baseId='a';const a=source('a',0,2,.2);a.meta.post.segments=[{songTime:0,offset:0,duration:1},{songTime:3,offset:1,duration:1}];
 const raw=composeSegmentVoice(d,new Map([['a',a]]),{sampleRate:1000,delayMs:0});assert.ok(raw.getChannelData(0)[500]>.19);assert.equal(raw.getChannelData(0)[2000],0);assert.ok(raw.getChannelData(0)[3500]>.19);
});
