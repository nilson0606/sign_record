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
export function soulxRangeLabel(interval,duration){
  const full=Math.abs(interval.start)<1/24000&&Math.abs(interval.end-duration)<1/24000;
  return `${full?'整首':'片段'} ${interval.start.toFixed(2)}～${interval.end.toFixed(2)} 秒（${(interval.end-interval.start).toFixed(2)} 秒／原始 ${duration.toFixed(2)} 秒）`;
}
export function soulxSavedMetadata({row,interval,report,delayMs,blend,match,useBacking,commonGain=1,bytes,rawBytes}){
  const duration=report.outputSamples/report.sampleRate;
  if(report.sourceSamples!==report.outputSamples||Math.abs(duration-(interval.end-interval.start))>1/24000)throw Error('生成長度與選取範圍不符，未保存。');
  const segments=(row.post?.segments??[]).flatMap(s=>{
    const start=Math.max(s.offset,interval.start),end=Math.min(s.offset+s.duration,interval.end);
    return end>start?[{offset:start-interval.start,songTime:s.songTime+start-s.offset,duration:end-start}]:[];
  });
  const range=soulxRangeLabel(interval,row.sourceSeconds??row.seconds),s=report.settings;
  const suffix=`_SoulX_${SOULX_REFERENCES[s.reference]}_${range.startsWith('整首')?'整首':`片段${interval.start}-${interval.end}秒`}_AI${blend}%`;
  const result={id:crypto.randomUUID(),created:Date.now(),title:row.title.slice(0,500-suffix.length)+suffix,parentId:row.id,
    videoId:row.videoId,mode:useBacking?'mix':'voice',stems:useBacking?structuredClone(row.stems??[]):[],mime:'audio/wav',rawMime:'audio/wav',
    complete:true,seconds:duration,sourceSeconds:duration,bytes,rawBytes,appliedDelayMs:0,delayMs:0,
    balance:{manual:true,voice:(row.balance?.voice??70)*commonGain,backing:(row.balance?.backing??50)*commonGain},
    postVolume:{voice:100,backing:100},vocalSoftening:{version:2,strength:'off'},vocalEffects:{version:1,reverb:0},
    postEdit:{version:1,start:0,end:null,fadeIn:0,fadeOut:0},
    soulx:{version:1,report:structuredClone(report),range:structuredClone(interval),sourceSeconds:row.sourceSeconds??row.seconds,sourceDelayMs:delayMs,blend,match,useBacking,commonGain}};
  if(row.post)result.post={version:row.post.version??1,reference:structuredClone(row.post.reference),scoring:structuredClone(row.post.scoring),segments,samples:[],offsetMs:0};
  return result;
}
