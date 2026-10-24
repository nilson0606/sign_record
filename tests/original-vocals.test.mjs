import test from 'node:test';
import assert from 'node:assert/strict';
import {originalVocalRanges,originalVocalWindows} from '../recording-process.mjs';
import {segmentDraft,missingSegmentRanges} from '../recording-segments.mjs';
test('original vocal ranges are ordered, bounded and cannot conflict',()=>{
 const rows=[{start:3,end:4,mode:'original'},{start:1,end:2,mode:'duet'}],snapshot=structuredClone(rows);
 assert.deepEqual(originalVocalRanges(rows,5).map(r=>r.mode),['duet','original']);assert.deepEqual(rows,snapshot);
 for(const bad of [[{start:1,end:6,mode:'duet'}],[{start:-1,end:2,mode:'duet'}],[{start:1,end:2,mode:'bad'}],[{start:1,end:3,mode:'duet'},{start:2,end:4,mode:'original'}]])assert.throws(()=>originalVocalRanges(bad,5));
});
test('source song times map through recorded pauses without receiving microphone correction',()=>{
 const windows=originalVocalWindows([{start:1,end:4,mode:'original'}],[{offset:0,songTime:0,duration:2},{offset:2,songTime:3,duration:2}]);
 assert.deepEqual(windows.map(({source,when,duration})=>({source,when,duration})),[{source:1,when:1,duration:1},{source:3,when:2,duration:1}]);
 assert.equal(windows[0].envelope[0].gain,0);assert.equal(windows[0].envelope.at(-1).gain,1);
 assert.equal(windows[1].envelope[0].gain,1);assert.equal(windows[1].envelope.at(-1).gain,0);
});
test('original-only can cover missing recording, duet and pure voice still require it',()=>{
 const draft=segmentDraft({duration:4,cacheId:'song'});draft.originalVocalRanges=[{start:0,end:4,mode:'original'}];
 assert.deepEqual(missingSegmentRanges(draft,[],200,true),[]);assert.equal(missingSegmentRanges(draft,[],200).length,1);
 draft.originalVocalRanges[0].mode='duet';assert.equal(missingSegmentRanges(draft,[],200,true).length,1);
 draft.originalVocalRanges[0]={start:1,end:4,mode:'original'};assert.equal(missingSegmentRanges(draft,[],200,true).length,1);
});
