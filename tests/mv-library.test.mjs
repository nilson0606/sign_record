import test from 'node:test';
import assert from 'node:assert/strict';
import {mvDisplayName,mvMatches} from '../mv-library-client.mjs';

test('MV file names show as song · singer; unexpected names stay as they are',()=>{
 assert.equal(mvDisplayName('MV_小薇_大叔_1a2b3c4d.mp4'),'小薇 · 大叔');
 assert.equal(mvDisplayName('MV_我的_歌名_翻唱者_1a2b3c4d.mp4'),'我的 歌名 · 翻唱者');
 assert.equal(mvDisplayName('MV_獨唱_1a2b3c4d.mp4'),'獨唱');
 assert.equal(mvDisplayName('other.mp4'),'other.mp4');
});
test('search matches song or singer, every word, case-insensitive; empty search shows all',()=>{
 const e={name:'MV_Photograph_Nilson_1a2b3c4d.mp4'};
 assert.equal(mvMatches(e,''),true);
 assert.equal(mvMatches(e,'photo'),true);
 assert.equal(mvMatches(e,'nilson photo'),true);
 assert.equal(mvMatches(e,'photo 小薇'),false);
 assert.equal(mvMatches({name:'MV_小薇_大叔_1a2b3c4d.mp4'},'大叔'),true);
});
