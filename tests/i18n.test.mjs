import test from 'node:test';
import assert from 'node:assert/strict';
import {messages,templates} from '../i18n-catalog.mjs';
import {translateMessage,setLanguage,getLanguage} from '../i18n.mjs';

test('Chinese is the default; English is explicit and unknown user text is unchanged',()=>{
 assert.equal(getLanguage(),'zh-Hant');
 assert.equal(translateMessage('開始'),'開始');
 setLanguage('en');assert.equal(translateMessage('開始'),'Start');
 assert.equal(translateMessage('我的歌名 <script>alert(1)</script>'),'我的歌名 <script>alert(1)</script>');
 setLanguage('invalid');assert.equal(getLanguage(),'zh-Hant');
});
test('catalog translates exact UI strings and preserves every template placeholder',()=>{
 for(const [source,target] of Object.entries(messages))assert.equal(translateMessage(source,'en'),target,source);
 for(const [source,target] of templates){
  const slots=s=>[...new Set([...s.matchAll(/\{(\d+)\}/g)].map(m=>m[1]))].sort();
  assert.deepEqual(slots(target),slots(source),source);
 }
});
test('nested UI fragments translate, while song titles and paths remain literal',()=>{
 assert.equal(translateMessage('錄製第 2 段','en'),'Record segment 2');
 assert.equal(translateMessage('下一步 3／8 · 選歌','en'),'Next 3/8 · Choose a song');
 assert.equal(translateMessage('歌曲庫位置：D:\\音樂\\開始。已記住這台電腦的設定。','en'),'Library location: D:\\音樂\\開始. Saved for this computer.');
 assert.equal(translateMessage('已匯入「開始」。可直接播放，或按「準備歌曲基準」使用錄音、評分與分段。','en'),'Imported “開始”. Play it directly, or prepare the reference for recording, scoring, and segments.');
 assert.equal(translateMessage('正在試聽：開始','en'),'Previewing: 開始');
 assert.equal(translateMessage('第 2 段 · 00:00.000–00:08.000','en'),'Segment 2 · 00:00.000–00:08.000');
 assert.equal(translateMessage('待補錄或涵蓋不足：第 1 段、原音。可改選本段版本，或明確勾選保留靜音。','en'),'Missing or insufficient coverage: Segment 1, 原音. Choose another take or explicitly allow silence.');
 assert.equal(translateMessage('  第 2 段\n','en'),'  Segment 2\n');
});
