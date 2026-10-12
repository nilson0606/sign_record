export const VOICELAB_DEFAULTS=Object.freeze({model:'ver3',pitchShift:0,indexRate:.75,protect:.33,volumeEnvelope:1,f0Method:'rmvpe',autotune:false,autotuneStrength:1});
export const VOICELAB_F0_METHODS=Object.freeze({rmvpe:'RMVPE',fcpe:'FCPE',crepe:'CREPE'});
export const VOICELAB_MODELS=Object.freeze({ver1:'我的音色 Ver1',ver2:'我的音色 Ver2',ver3:'我的音色 Ver3',wife_ver1:'Wife Ver1',wife_ver2:'Wife Ver2',mosi_ver1:'Mosi Ver1',n_1_ver1:'N_1 Ver1',n2_ver:'N2_VER',n3_ver:'N3_VER',n4_ver:'N4_VER'});
export const voicelabModelLabel=report=>report.modelLabel||VOICELAB_MODELS[report.settings.model]||report.settings.model;
export function voicelabBackingStems(row,arrangement=null){
  const harmony=row.post?.reference?.vocalMode==='lead'||row.stems?.includes('backing');
  return arrangement?['arrangement',...(harmony?['backing']:[])]:[...new Set([...(row.stems??[]).filter(s=>!['vocals','lead'].includes(s)),...(harmony?['backing']:[])])];
}
export function voicelabPitchLabel(value=0){
  return value===0?'原八度（預設）':`${value===-12?'降低八度':value===12?'提高八度':'移調'}（${value>0?'+':''}${value} 半音）`;
}
export function voicelabOriginalReference(row){
  const reference=row?.post?.reference;
  if(!reference?.cacheId)throw Error('這筆錄音沒有原曲音軌資料，請改選自選參考歌聲檔。');
  return `/library/${encodeURIComponent(reference.cacheId)}/${reference.vocalMode==='lead'?'lead':'vocals'}`;
}
export function voicelabSongSource(reference){
  if(!reference?.cacheId||!reference.hasPreview||!Number.isFinite(reference.duration)||reference.duration<1)return null;
  const duration=reference.duration;
  return {id:'song:'+reference.cacheId,voicelabSource:'original',title:reference.title||'原曲原唱',videoId:reference.videoId,
    complete:true,seconds:duration,sourceSeconds:duration,appliedDelayMs:0,mode:'mix',
    stems:reference.vocalMode==='lead'?['accompaniment','backing']:['accompaniment'],balance:{manual:true,voice:100,backing:100},
    post:{version:1,reference:structuredClone(reference),segments:[{offset:0,songTime:0,duration}],samples:[],offsetMs:0}};
}
export function voicelabSettings(v={}){
  const s={...VOICELAB_DEFAULTS,...v};
  if(typeof s.model!=='string'||(!Object.hasOwn(VOICELAB_MODELS,s.model)&&!/^folder-[a-f0-9]{64}$/.test(s.model)))throw Error('請選擇已安裝的個人音色模型。');
  if(!Object.hasOwn(VOICELAB_F0_METHODS,s.f0Method))throw Error('請選擇支援的音高擷取方法。');
  if(typeof s.autotune!=='boolean')throw Error('自動修音設定無效。');
  for(const [key,min,max,integer] of [['pitchShift',-12,12,true],['indexRate',0,1,false],['protect',0,.5,false],['volumeEnvelope',0,1,false],['autotuneStrength',0,1,false]]){
    if(!Number.isFinite(s[key])||s[key]<min||s[key]>max||(integer&&!Number.isInteger(s[key])))throw Error(`${key} 超出允許範圍。`);
  }
  return Object.fromEntries(Object.keys(VOICELAB_DEFAULTS).map(key=>[key,s[key]]));
}
export function voicelabInterval(start,end,duration){
  if(![start,end,duration].every(Number.isFinite)||start<0||end>duration+.001||end-start<1||end-start>600)throw Error('轉換範圍需在原始錄音內，每次 1 秒～10 分鐘。');
  return {start,end};
}
export function voicelabRangeLabel(interval,duration){
  const full=Math.abs(interval.start)<1/48000&&Math.abs(interval.end-duration)<1/48000;
  return `${full?'整首':'片段'} ${interval.start.toFixed(2)}～${interval.end.toFixed(2)} 秒（${(interval.end-interval.start).toFixed(2)} 秒／原始 ${duration.toFixed(2)} 秒）`;
}
export function voicelabSavedMetadata({row,interval,report,delayMs,blend,match,useBacking,arrangement=null,commonGain=1,voiceVolume=100,backingVolume=100,bytes,rawBytes}){
  const duration=report.outputSamples/report.sampleRate;
  if(report.sourceSamples!==report.outputSamples||Math.abs(duration-(interval.end-interval.start))>1/48000)throw Error('生成長度與選取範圍不符，未保存。');
  const segments=(row.post?.segments??[]).flatMap(s=>{
    const start=Math.max(s.offset,interval.start),end=Math.min(s.offset+s.duration,interval.end);
    return end>start?[{offset:start-interval.start,songTime:s.songTime+start-s.offset,duration:end-start}]:[];
  });
  const range=voicelabRangeLabel(interval,row.sourceSeconds??row.seconds),s=report.settings;
  const pitch=s.pitchShift??0;
  const suffix=`_VoiceLab_${row.voicelabSource==='original'?'原唱換聲_':''}${voicelabModelLabel(report)}_${range.startsWith('整首')?'整首':`片段${interval.start}-${interval.end}秒`}${pitch?`_移調${pitch>0?'+':''}${pitch}半音`:''}_AI${blend}%${useBacking&&(arrangement??row.arrangement)?'_新配樂':''}`;
  const result={id:crypto.randomUUID(),created:Date.now(),title:row.title.slice(0,500-suffix.length)+suffix,...(row.voicelabSource==='original'?{}:{parentId:row.id}),
    videoId:row.videoId,mode:useBacking?'mix':'voice',stems:useBacking?voicelabBackingStems(row,arrangement??row.arrangement):[],mime:'audio/wav',rawMime:'audio/wav',
    complete:true,seconds:duration,sourceSeconds:duration,bytes,rawBytes,appliedDelayMs:0,delayMs:0,
    balance:{manual:true,voice:(row.balance?.voice??70)*voiceVolume/100*commonGain,backing:(row.balance?.backing??50)*backingVolume/100*commonGain},
    postVolume:{voice:100,backing:100},vocalSoftening:{version:2,strength:'off'},vocalEffects:{version:1,reverb:0},
    postEdit:{version:1,start:0,end:null,fadeIn:0,fadeOut:0},
    voicelab:{version:1,sourceKind:row.voicelabSource==='original'?'original':'recording',sourceCacheId:row.post?.reference?.cacheId,report:structuredClone(report),range:structuredClone(interval),sourceSeconds:row.sourceSeconds??row.seconds,sourceDelayMs:delayMs,blend,match,useBacking,commonGain,voiceVolume,backingVolume}};
  if(useBacking&&(arrangement??row.arrangement))result.arrangement=structuredClone(arrangement??row.arrangement);
  if(row.post)result.post={version:row.post.version??1,reference:structuredClone(row.post.reference),scoring:structuredClone(row.post.scoring),segments,samples:[],offsetMs:0};
  return result;
}
