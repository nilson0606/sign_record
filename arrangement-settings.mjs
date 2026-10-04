export const ARRANGEMENT_INSTRUMENTS=Object.freeze({piano:['鋼琴','acoustic piano'],guitar:['木吉他','acoustic guitar'],electric:['電吉他','clean electric guitar'],strings:['弦樂','warm string ensemble'],bass:['貝斯','bass guitar'],drums:['鼓組','acoustic drums'],brushes:['刷鼓','brushed drums'],pad:['柔和合成器','soft synth pads'],sax:['薩克斯風','saxophone'],flute:['長笛','flute'],percussion:['輕打擊','light percussion'],synth:['電子合成器','analog synthesizer']});
export const ARRANGEMENT_STYLES=Object.freeze({ballad:['抒情','pop ballad'],acoustic:['木吉他民謠','acoustic folk'],pop:['流行','pop band'],jazz:['爵士','smooth jazz'],orchestral:['管弦樂','cinematic orchestral'],electronic:['電子','electronic pop']});
export const ARRANGEMENT_MOODS=Object.freeze({warm:['溫暖','warm and intimate'],romantic:['浪漫','romantic and tender'],bright:['明亮','bright and uplifting'],melancholy:['感傷','melancholic and gentle'],dramatic:['壯闊','dramatic and expansive']});
export const ARRANGEMENT_PRESETS=Object.freeze({
  piano:{label:'鋼琴＋弦樂',instruments:['piano','strings','bass'],style:'ballad',mood:'romantic',density:'light'},
  acoustic:{label:'木吉他＋輕鼓',instruments:['guitar','bass','brushes'],style:'acoustic',mood:'warm',density:'light'},
  band:{label:'流行樂團',instruments:['piano','electric','bass','drums'],style:'pop',mood:'bright',density:'balanced'},
  jazz:{label:'爵士小酒館',instruments:['piano','bass','brushes','sax'],style:'jazz',mood:'warm',density:'light'},
  cinematic:{label:'電影弦樂',instruments:['piano','strings','flute','percussion'],style:'orchestral',mood:'dramatic',density:'rich'},
  electronic:{label:'柔和電子',instruments:['synth','pad','bass','drums'],style:'electronic',mood:'bright',density:'balanced'}
});
export function arrangementSettings(v={}){
  const s={...ARRANGEMENT_PRESETS.piano,preset:'piano',strength:.8,seed:20261004,...v};
  if(!['custom',...Object.keys(ARRANGEMENT_PRESETS)].includes(s.preset)||!Object.hasOwn(ARRANGEMENT_STYLES,s.style)||!Object.hasOwn(ARRANGEMENT_MOODS,s.mood)||!['light','balanced','rich'].includes(s.density))throw Error('配樂風格設定無效。');
  if(!Array.isArray(s.instruments)||s.instruments.length<1||s.instruments.length>8||new Set(s.instruments).size!==s.instruments.length||s.instruments.some(x=>!Object.hasOwn(ARRANGEMENT_INSTRUMENTS,x)))throw Error('請選擇 1～8 種樂器。');
  if(!Number.isFinite(s.strength)||s.strength<.3||s.strength>1||!Number.isInteger(s.seed)||s.seed<0||s.seed>2147483647)throw Error('配樂生成參數超出範圍。');
  return {preset:s.preset,instruments:[...s.instruments],style:s.style,mood:s.mood,density:s.density,strength:s.strength,seed:s.seed};
}
export function arrangementCaption(settings){const s=arrangementSettings(settings);return `Instrumental accompaniment, no vocals, no singing. ${ARRANGEMENT_STYLES[s.style][1]}, ${ARRANGEMENT_MOODS[s.mood][1]}. Instruments: ${s.instruments.map(x=>ARRANGEMENT_INSTRUMENTS[x][1]).join(', ')}. ${s.density==='light'?'Sparse, leave room for the singer':s.density==='rich'?'Rich layered arrangement':'Balanced arrangement'}. Follow the source harmony, tempo, phrasing and song structure.`;}
export function arrangementLabel(s){return s.preset!=='custom'?ARRANGEMENT_PRESETS[s.preset].label:`自選・${s.instruments.map(x=>ARRANGEMENT_INSTRUMENTS[x][0]).join('＋')}`;}
export function arrangementRange(start,end,duration){if(![start,end,duration].every(Number.isFinite)||start<0||end>duration+.001||end-start<1||end-start>600)throw Error('配樂範圍需在歌曲內，每次 1 秒～10 分鐘。');return {start,end};}
export function arrangementCovers(meta,row,interval){
  if(!meta||meta.cacheId!==row?.post?.reference?.cacheId)return false;
  const segments=(row.post.segments??[]).map(s=>({start:Math.max(s.offset,interval.start),end:Math.min(s.offset+s.duration,interval.end),offset:s.offset,song:s.songTime})).filter(s=>s.end>s.start);
  return segments.length>0&&segments.every(s=>s.song+s.start-s.offset>=meta.start-.001&&s.song+s.end-s.offset<=meta.end+.001);
}
export function recordingBackingRoute(row,stem){return row.arrangement?`/arrangements/library/${row.arrangement.id}/audio`:`/library/${row.post.reference.cacheId}/${stem}`;}
