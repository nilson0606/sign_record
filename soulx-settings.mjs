export const SOULX_DEFAULTS=Object.freeze({reference:'self',referenceStart:null,referenceSeconds:8,steps:32,guidance:3,seed:20261004});
export const SOULX_REFERENCES=Object.freeze({self:'自己的歌聲',zh:'官方中文示範',en:'官方英文示範',custom:'自選參考歌聲'});
export function soulxSettings(v={}){
  const s={...SOULX_DEFAULTS,...v};
  if(!Object.hasOwn(SOULX_REFERENCES,s.reference))throw Error('請選擇參考歌聲。');
  for(const [key,min,max,integer] of [['steps',8,64,true],['guidance',0,5,false],['seed',0,2147483647,true],['referenceSeconds',3,15,false]]){
    if(!Number.isFinite(s[key])||s[key]<min||s[key]>max||(integer&&!Number.isInteger(s[key])))throw Error(`${key} 超出允許範圍。`);
  }
  if(s.referenceStart!==null&&(!Number.isFinite(s.referenceStart)||s.referenceStart<0||s.referenceStart>1800))throw Error('參考起點需介於 0～1800 秒，留白則自動挑選有聲片段。');
  return Object.fromEntries(Object.keys(SOULX_DEFAULTS).map(key=>[key,s[key]]));
}
export function soulxInterval(start,end,duration){
  if(![start,end,duration].every(Number.isFinite)||start<0||end>duration+.001||end-start<1||end-start>600)throw Error('轉換範圍需在原始錄音內，每次 1 秒～10 分鐘。');
  return {start,end};
}
