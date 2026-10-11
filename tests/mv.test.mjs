import test from 'node:test';
import assert from 'node:assert/strict';
import {mvLabels,mvFilter} from '../mv-server.mjs';
test('MV labels require bounded literal text and never enter the FFmpeg filter',()=>{
  for(const [title,artist] of [['','Singer'],['Song',''],['x'.repeat(61),'Singer'],['Song','a\nb']])assert.throws(()=>mvLabels(title,artist));
  const labels=mvLabels('  歌名: 100% %{filename}  ','翻唱者');assert.equal(labels.title,'歌名: 100% %{filename}');
  const filter=mvFilter(labels.title,labels.artist);assert.ok(!filter.includes(labels.title));assert.ok(filter.includes('expansion=none'));assert.ok(filter.includes('showfreqs='));
});
