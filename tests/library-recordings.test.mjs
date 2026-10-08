import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryRecordingCounts} from '../library-recordings.mjs';
import {recordingReviewKey} from '../recording-review.mjs';

test('library badges include whole pending and retained segments, isolate song versions and keys',()=>{
  const ref={cacheId:'wine',videoId:'video',pitchShift:4};
  const row=extra=>({post:{reference:ref},...extra});
  const counts=libraryRecordingCounts([
    row({postPending:true}),row({postPending:true,complete:false}),
    row({segmentTake:{key:'wine'}}),row({segmentTake:{key:'wine'},postPending:true}),
    row({postPending:false}),row({}),row({segmentComposition:{},postPending:true}),
    row({postPending:true,post:{reference:{...ref,pitchShift:0}}}),
    row({segmentTake:{},post:{reference:{...ref,cacheId:'other-model'}}}),
    {postPending:true},{segmentTake:{}},
  ]);
  assert.deepEqual(counts.get(recordingReviewKey(ref)),{whole:2,segments:2});
  assert.deepEqual(counts.get(recordingReviewKey({...ref,pitchShift:0})),{whole:1,segments:0});
  assert.deepEqual(counts.get(recordingReviewKey({...ref,cacheId:'other-model'})),{whole:0,segments:1});
  assert.equal(counts.size,3);
  assert.equal(libraryRecordingCounts([]).size,0);
});
