import {arrangementCovers,recordingBackingRoute} from './arrangement-settings.mjs';
import {wavBlob} from './recording-process.mjs';
import {createVoiceLabStorage} from './voicelab-storage-client.mjs';
import {VOICELAB_DEFAULTS,VOICELAB_MODELS,VOICELAB_F0_METHODS,voicelabSettings,voicelabInterval,voicelabRangeLabel,voicelabSavedMetadata,voicelabOriginalReference,voicelabSongSource,voicelabPitchLabel,voicelabModelLabel,voicelabBackingStems} from './voicelab-settings.mjs';
const BASE='http://127.0.0.1:4274';
const $=id=>document.getElementById('voicelab-'+id);
async function request(path,options={}){
  let session;
  try{const response=await fetch(BASE+'/session',{signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error();session=await response.json();}
  catch{throw Error('請啟動本機唱錄工具，再使用 Voice Lab。');}
  const response=await fetch(BASE+path,{...options,headers:{'X-Karaoke-Token':session.token,...(options.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(options.body?120000:30000)});
  if(!response.ok){const e=await response.json().catch(()=>({}));throw Error(e.error||(response.status===404?'請重新啟動新版本機工具，才能使用 Voice Lab。':'Voice Lab 本機請求失敗。'));}
  return response;
}
const encode=async blob=>{const bytes=new Uint8Array(await blob.arrayBuffer()),parts=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(parts.join(''));};
export async function voicelabSlice(buffer,start,end){
  const c=new OfflineAudioContext(1,Math.round((end-start)*48000),48000),node=c.createBufferSource();node.buffer=buffer;node.connect(c.destination);
  const when=Math.max(0,-start),offset=Math.max(0,start),duration=Math.min(buffer.duration-offset,end-start-when);
  if(duration>0)node.start(when,offset,duration);return c.startRendering();
}
function rms(buffer){const a=buffer.getChannelData(0);let sum=0;for(const x of a)sum+=x*x;return Math.sqrt(sum/a.length);}
export function createVoiceLab({store,getSelected,getPosition,getReference=()=>null,beforePlay,onSaved=async()=>{},onMakeMV=()=>{}}){
  // Start disabled even if the browser restored controls from the previous visit.
  $('panel').open=false;$('enable').checked=false;$('advanced').open=false;
  let savedBackings=[],models=[],scanning=false,modelsReady=false;
  let selectedId=null,externalBusy=false,busy=false,saving=false,revision=0,active=null,result=null,urls=[],mixes=null,rendering=0,side='ai';
  const say=text=>{$('status').textContent=text;};
  let progressTimer=null,progressStarted=0;
  function stopProgress(){clearInterval(progressTimer);progressTimer=null;}
  function showProgress(stage,detail,progress=null){
    const names={preparing:'準備音訊',starting:'啟動本機環境',pitch:'分析旋律',loading:'載入模型',converting:'轉換歌聲',finalizing:'整理與檢查音檔',ready:'已完成',failed:'未完成',cancelled:'已取消'};
    $('progress').hidden=false;$('progress-stage').textContent=names[stage]??'處理中';
    const bar=$('progress-bar');bar.hidden=['failed','cancelled'].includes(stage);
    const unit=stage==='converting'?'segments':stage==='pitch'?'frames':null;
    if(unit&&progress?.unit===unit&&Number.isSafeInteger(progress.total)&&progress.total>0&&Number.isSafeInteger(progress.completed)&&progress.completed>=0&&progress.completed<=progress.total){
      const percent=Math.floor(progress.completed/progress.total*100);bar.value=percent;
      detail=unit==='segments'?`已完成 ${progress.completed}／${progress.total} 段 · 本階段 ${percent}%。${detail}`:`旋律分析 ${percent}%。${detail}`;
    }else if(stage==='ready')bar.value=100;
    else bar.removeAttribute('value');
    $('progress-detail').textContent=detail;
    if(['ready','failed','cancelled'].includes(stage))stopProgress();
  }
  function startProgress(){
    stopProgress();progressStarted=performance.now();
    const tick=()=>{const seconds=Math.floor((performance.now()-progressStarted)/1000);$('elapsed').textContent=`已用時間 ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
    tick();progressTimer=setInterval(tick,1000);showProgress('preparing','正在準備來源人聲與個人音色模型…');
  }
  const source=()=>$('source').value==='original'?voicelabSongSource(getReference()):getSelected();
  const eligible=()=>{const row=source();return !!(row?.complete&&(row.rawBytes||row.voicelabSource==='original'));};
  const enabled=()=>$('enable').checked;
  const player=$('audio');
  function clear(){player.pause();player.removeAttribute('src');player.load();for(const u of urls)URL.revokeObjectURL(u);urls=[];mixes=null;result=null;rendering++;$('result').hidden=true;}
  function controls(){
    $('content').hidden=!enabled();$('fields').disabled=!enabled()||!eligible()||busy||saving||externalBusy||scanning;
    $('model').disabled=!enabled()||busy||saving||externalBusy||scanning;
    $('model-refresh').disabled=!enabled()||busy||saving||externalBusy||scanning;
    $('generate').disabled=!modelsReady||!$('model').value;
    $('source').disabled=!enabled()||busy||saving||externalBusy;
    $('cancel').disabled=!busy||!active;
    for(const id of ['listen-original','listen-ai','download','save','mv'])$(id).disabled=!result||busy||saving||externalBusy;
    $('mv').disabled||=!!result&&result.draft!==draft();
    $('save').disabled||=!!result&&result.draft!==draft();
    $('enable').disabled=saving;
    for(const id of ['blend','match','loop','backing-choice','backing-refresh','voice-volume','backing-volume'])$(id).disabled=saving;
    $('backing').disabled=saving||!result||result.row.mode!=='mix';
    $('autotune-strength').disabled=!$('autotune').checked;
  }
  function labels(){
    for(const id of ['index-rate','protect','volume-envelope'])$(id+'-value').textContent=Number($(id).value).toFixed(2);
    $('autotune-strength-value').textContent=Math.round(Number($('autotune-strength').value)*100)+'%';
    $('blend-value').textContent=$('blend').value+'%';
    for(const id of ['voice-volume','backing-volume'])$(id+'-value').textContent=$(id).value+'%';
    const pitch=$('pitch').valueAsNumber;$('pitch-value').textContent=Number.isInteger(pitch)&&pitch>=-12&&pitch<=12?voicelabPitchLabel(pitch):'請輸入 −12～+12 的整數';
    for(const button of document.querySelectorAll('[data-voicelab-pitch]'))button.setAttribute('aria-pressed',String(Number(button.dataset.voicelabPitch)===pitch));
    $('advanced-summary').textContent=`${VOICELAB_F0_METHODS[$('f0-method').value]} · ${voicelabPitchLabel(pitch)} · 檢索 ${$('index-rate').value} · 保護 ${$('protect').value} · 包絡 ${$('volume-envelope').value} · 修音${$('autotune').checked?Math.round(Number($('autotune-strength').value)*100)+'%':'關閉'}`;
  }
  function settings(){return voicelabSettings({model:$('model').value,pitchShift:$('pitch').valueAsNumber,indexRate:Number($('index-rate').value),protect:Number($('protect').value),volumeEnvelope:Number($('volume-envelope').value),f0Method:$('f0-method').value,autotune:$('autotune').checked,autotuneStrength:Number($('autotune-strength').value)});}
  function reset(){for(const [id,key] of [['index-rate','indexRate'],['protect','protect'],['pitch','pitchShift'],['volume-envelope','volumeEnvelope'],['f0-method','f0Method'],['autotune-strength','autotuneStrength']])$(id).value=VOICELAB_DEFAULTS[key];$('model').value=models.find(m=>m.id===VOICELAB_DEFAULTS.model)?.id??models[0]?.id??'';$('autotune').checked=VOICELAB_DEFAULTS.autotune;labels();}
  async function cancel(){revision++;player.pause();if(busy)showProgress('cancelled','已取消轉換；原始音檔保留。');else{stopProgress();$('progress').hidden=true;}if(active)try{await request('/voicelab/jobs/'+active,{method:'DELETE'});}catch{}say(enabled()?'已取消 Voice Lab；原始錄音保留。':'Voice Lab 已關閉。');}
  $('enable').addEventListener('change',async()=>{
    controls();if(!enabled()){void cancel();return;}
    void refreshBackings();void refreshModels();
  });
  async function refreshModels(){
    if(scanning||busy||saving||externalBusy)return;
    scanning=true;modelsReady=false;controls();$('model-status').textContent='正在掃描本機音色資料夾…';
    try{
      const state=await(await request('/voicelab')).json(),previous=$('model').value;
      models=(state.models??[]).map(m=>({id:m.id,label:m.label||VOICELAB_MODELS[m.id]||m.id}));
      $('model').replaceChildren(...models.map(m=>new Option(m.label+(m.id===VOICELAB_DEFAULTS.model?'（預設）':''),m.id)));
      if(!models.length)$('model').add(new Option('未找到完整模型',''));
      $('model').value=models.find(m=>m.id===previous)?.id??models.find(m=>m.id===VOICELAB_DEFAULTS.model)?.id??models[0]?.id??'';
      $('model-root').textContent=state.modelsRoot||'本機設定的模型目錄';
      const issues=state.modelIssues??[];$('model-issues').replaceChildren(...issues.map(issue=>{const li=document.createElement('li');li.textContent=(issue.folder?issue.folder+'：':'')+issue.message;return li;}));$('model-issues').hidden=!issues.length;
      modelsReady=!!state.installed&&models.length>0;
      $('model-status').textContent=`已找到 ${models.length} 個音色模型。${issues.length?`${issues.length} 個資料夾需整理，詳見下方。`:''}${state.modelDiscoveryVersion===1?'新增資料夾後可再次掃描，不需重啟。':'本機工具尚未支援自動發現新模型，請更新並重新啟動本機工具。'}${previous&&previous!==$('model').value?'原選模型已不在清單，請確認目前選擇。':''}`;
      dirty();if(enabled()&&(!result||result.draft===draft()))say(modelsReady?'Voice Lab 已就緒。選個人模型與範圍，再按「產生 Voice Lab 試聽」。':'找不到可用模型或換聲環境，請確認 Applio 與下方模型掃描結果。');
    }catch(e){$('model-status').textContent='掃描未完成：'+e.message;if(enabled())say(e.message);}
    finally{scanning=false;controls();}
  }
  $('model-refresh').addEventListener('click',()=>void refreshModels());
  $('model').addEventListener('change',dirty);
  $('panel').addEventListener('toggle',()=>{if(!$('panel').open)player.pause();});
  $('cancel').addEventListener('click',()=>void cancel());
  $('reset').addEventListener('click',()=>{reset();dirty();});
  for(const button of document.querySelectorAll('[data-voicelab-pitch]'))button.addEventListener('click',()=>{$('pitch').value=button.dataset.voicelabPitch;dirty();});
  function draft(){return JSON.stringify([...['source','start','end','model','index-rate','protect','pitch','volume-envelope','f0-method','autotune-strength'].map(id=>$(id).value),$('autotune').checked]);}
  function rangeLabel(){const row=source();try{$('range-info').textContent='將轉換：'+voicelabRangeLabel(voicelabInterval(Number($('start').value),Number($('end').value),row?.sourceSeconds??row?.seconds),row.sourceSeconds??row.seconds);}catch{$('range-info').textContent='請設定有效的轉換起訖範圍。';}}
  function dirty(){labels();rangeLabel();controls();if(result)say(result.draft===draft()?'設定與已生成結果一致，可以試聽或保存。':'參數／範圍已修改；目前仍是上次結果，請重新產生後再保存。');}
  $('fields').addEventListener('input',dirty);$('fields').addEventListener('change',dirty);
  $('source').addEventListener('change',()=>{syncSource();labels();});
  $('now').addEventListener('click',()=>{const row=source(),duration=row.sourceSeconds??row.seconds;const position=row.voicelabSource==='original'?(result?result.interval.start+player.currentTime:0):getPosition();const start=Math.min(Math.max(0,duration-1),position);$('start').value=start.toFixed(2);$('end').value=Math.min(duration,start+20).toFixed(2);dirty();});
  $('full').addEventListener('click',()=>{const row=source(),duration=row.sourceSeconds??row.seconds;if(duration>600){say('每次最多 10 分鐘，請分段選取。');return;}$('start').value=0;$('end').value=duration;dirty();});
  async function prepare(row,config){
    const interval=voicelabInterval(Number($('start').value),Number($('end').value),row.sourceSeconds??row.seconds);
    const delayMs=row.appliedDelayMs??row.recordingDelayMs??row.post?.offsetMs??0;
    const context=new AudioContext({sampleRate:48000,sinkId:{type:'none'}});
    try{
      const blob=row.voicelabSource==='original'?await(await request(voicelabOriginalReference(row))).blob():await store.blob(row,'voice');
      if(!blob.size||(row.voicelabSource!=='original'&&blob.size!==row.rawBytes))throw Error('來源人聲不完整，無法轉換。');
      const raw=await context.decodeAudioData(await blob.arrayBuffer());
      const source=await voicelabSlice(raw,interval.start+delayMs/1000,interval.end+delayMs/1000);
      const audio=await encode(wavBlob(source));
      return {payload:{audio,settings:config},interval,delayMs};
    }finally{await context.close();}
  }
  $('generate').addEventListener('click',async()=>{
    if(!enabled()||busy||externalBusy||scanning||!modelsReady||!eligible())return;
    if(document.getElementById('mic-stop')&&!document.getElementById('mic-stop').disabled){say('請先停止收音，再生成 Voice Lab，避免影響錄製。');return;}
    const rev=++revision,row=structuredClone(source()),generatedDraft=draft();busy=true;clear();controls();startProgress();
    try{
      beforePlay();say('準備來源人聲與個人音色模型…');const config=settings();
      if(config.pitchShift!==0){const support=await(await request('/voicelab')).json();if(support.pitchShiftRange?.[0]!==-12||support.pitchShiftRange?.[1]!==12)throw Error('本機工具尚未支援歌聲移調，請更新並重新啟動本機工具。');if(rev!==revision)return;}
      if(![-12,0,12].includes(config.pitchShift)||['volumeEnvelope','f0Method','autotune','autotuneStrength'].some(k=>config[k]!==VOICELAB_DEFAULTS[k])){const support=await(await request('/voicelab')).json();if(support.advancedSettingsVersion!==1||!support.f0Methods?.includes(config.f0Method))throw Error('請更新並重新啟動本機工具，才能套用 RVC 進階設定。');if(rev!==revision)return;}
      const input=await prepare(row,config);if(rev!==revision)return;
      let state=await(await request('/voicelab/jobs',{method:'POST',body:JSON.stringify(input.payload)})).json();active=state.id;controls();
      if(rev!==revision){await request('/voicelab/jobs/'+active,{method:'DELETE'});return;}
      for(let attempt=0;attempt<610;attempt++){
        if(rev!==revision)return;say(state.message);
        showProgress(state.stage==='ready'?'finalizing':state.stage,state.stage==='ready'?'模型已完成，正在取得音檔並確認取樣長度…':state.message,state.progress);
        if(state.stage==='ready')break;if(['failed','cancelled'].includes(state.stage))throw Error(state.message);
        await new Promise(resolve=>setTimeout(resolve,1500));if(rev!==revision)return;
        state=await(await request('/voicelab/jobs/'+active)).json();
      }
      if(state.stage!=='ready')throw Error('生成逾時，請重新嘗試。');
      if((state.result.pitchShift??0)!==input.payload.settings.pitchShift)throw Error('模型回報的移調值與設定不符，未接受結果；請更新本機工具後重試。');
      const applied=voicelabSettings(state.result.settings);if(Object.keys(VOICELAB_DEFAULTS).some(k=>applied[k]!==config[k]))throw Error('模型回報的 RVC 參數與設定不符，未接受結果；請更新本機工具後重試。');
      state.result.modelLabel||=models.find(m=>m.id===config.model)?.label??config.model;
      const blobs=await Promise.all(['source','result'].map(async name=>(await request('/voicelab/jobs/'+active+'/'+name)).blob()));if(rev!==revision)return;
      const context=new AudioContext({sampleRate:48000,sinkId:{type:'none'}});
      try{const [original,converted]=await Promise.all(blobs.map(async b=>context.decodeAudioData(await b.arrayBuffer())));if(rev!==revision)return;
        if(original.length!==converted.length||converted.length!==state.result.outputSamples||Math.abs(converted.duration-(input.interval.end-input.interval.start))>1/48000)throw Error('輸出長度與選取範圍不符，未接受結果。');
        result={jobId:active,row,original,converted,report:state.result,interval:input.interval,delayMs:input.delayMs,tracks:null,draft:generatedDraft};}finally{await context.close();}
      $('result').hidden=false;$('blend').value=100;$('backing').checked=row.mode==='mix';labels();
      const s=applied;$('result-info').textContent=`已轉換：${row.voicelabSource==='original'?'原曲原唱':'我的錄音'} → ${voicelabModelLabel(result.report)} · ${voicelabRangeLabel(input.interval,row.sourceSeconds??row.seconds)} · ${voicelabPitchLabel(s.pitchShift)} · ${VOICELAB_F0_METHODS[s.f0Method]} · 檢索比例 ${s.indexRate} · 子音保護 ${s.protect} · 音量包絡 ${s.volumeEnvelope} · 修音${s.autotune?Math.round(s.autotuneStrength*100)+'%':'關閉'} · 校正 ${input.delayMs} ms。請試聽確認音色與對嘴。`;
      say('已完成。按「原聲／Voice Lab」同位置切換比較；原錄音與 A／B 設定保留。');
      showProgress('ready','音檔長度檢查通過，可以試聽。');
      window.dispatchEvent(new Event('voicelab-result-ready'));
    }catch(e){if(rev===revision){say(e.message);showProgress('failed',e.message);}if(active)await request('/voicelab/jobs/'+active,{method:'DELETE'}).catch(()=>{});}
    finally{stopProgress();busy=false;active=null;controls();}
  });
  async function buildMixes(){
    if(!result)throw Error('請先產生 Voice Lab。');const snapshot=result,rev=revision,pass=++rendering;
    const useBacking=$('backing').checked&&snapshot.row.mode==='mix',match=$('match').checked,blend=Number($('blend').value)/100;
    const voiceVolume=Number($('voice-volume').value),backingVolume=Number($('backing-volume').value);
    const chosen=$('backing-choice').value,custom=chosen?savedBackings.find(m=>m.id===chosen):null;
    if(useBacking&&chosen&&(!custom||!arrangementCovers(custom,snapshot.row,snapshot.interval)))throw Error('所選配樂未涵蓋這段歌聲，請選整首或範圍相符的配樂。');
    const arrangement=useBacking?(custom??snapshot.row.arrangement??null):null;
    const key=JSON.stringify([useBacking,match,blend,arrangement?.id,voiceVolume,backingVolume]);if(mixes?.key===key)return mixes;
    $('listen-status').textContent='準備試聽音訊…';
    if(useBacking&&(!snapshot.tracks||snapshot.tracksKey!==(arrangement?.id??'original'))){
      const context=new AudioContext({sampleRate:48000,sinkId:{type:'none'}});
      try{const tracks=[],routes=voicelabBackingStems(snapshot.row,arrangement).map(stem=>recordingBackingRoute({...snapshot.row,arrangement},stem));for(const route of routes){const blob=await(await request(route)).blob();tracks.push(await context.decodeAudioData(await blob.arrayBuffer()));}snapshot.tracks=tracks;snapshot.tracksKey=arrangement?.id??'original';}finally{await context.close();}
    }
    const gain=match?Math.min(4,rms(snapshot.original)/Math.max(rms(snapshot.converted),.00001)):1;
    async function render(ai){
      const context=new OfflineAudioContext(2,snapshot.original.length,48000),balance=snapshot.row.balance??{},voiceGain=(balance.voice??70)/100*voiceVolume/100,backGain=(balance.backing??50)/100*backingVolume/100;
      const add=(buffer,level,when=0,offset=0,duration)=>{if(level===0||duration===0)return;const node=context.createBufferSource(),g=context.createGain();node.buffer=buffer;g.gain.value=level;node.connect(g);g.connect(context.destination);node.start(when,offset,duration);};
      add(snapshot.original,voiceGain*(ai?1-blend:1));if(ai)add(snapshot.converted,voiceGain*blend*gain);
      if(useBacking)for(const segment of snapshot.row.post.segments)for(const track of snapshot.tracks){
        const start=Math.max(segment.offset,snapshot.interval.start),end=Math.min(segment.offset+segment.duration,snapshot.interval.end);
        const offset=segment.songTime+start-segment.offset,length=Math.min(end-start,track.duration-offset);
        if(length>0&&offset>=0)add(track,backGain,start-snapshot.interval.start,offset,length);
      }
      return context.startRendering();
    }
    const audio=await Promise.all([render(false),render(true)]);let peak=0;
    for(const b of audio)for(let c=0;c<b.numberOfChannels;c++)for(const x of b.getChannelData(c))peak=Math.max(peak,Math.abs(x));
    const commonGain=Math.min(1,.98/Math.max(peak,.00001));if(commonGain<1)for(const b of audio)for(let c=0;c<b.numberOfChannels;c++){const a=b.getChannelData(c);for(let i=0;i<a.length;i++)a[i]*=commonGain;}
    if(rev!==revision||snapshot!==result||pass!==rendering)throw Error('試聽設定已變更，請再按一次。');
    const blobs=audio.map(wavBlob);player.pause();for(const u of urls)URL.revokeObjectURL(u);urls=blobs.map(URL.createObjectURL);
    const voice=new AudioBuffer({numberOfChannels:1,length:snapshot.original.length,sampleRate:48000}),out=voice.getChannelData(0),original=snapshot.original.getChannelData(0),converted=snapshot.converted.getChannelData(0);
    for(let i=0;i<out.length;i++)out[i]=original[i]*(1-blend)+converted[i]*blend*gain;
    // Preserve the blended dry vocal without PCM clipping; fold its scale into the saved bus gain.
    let voicePeak=1;for(const x of out)voicePeak=Math.max(voicePeak,Math.abs(x));if(voicePeak>1)for(let i=0;i<out.length;i++)out[i]/=voicePeak;
    mixes={key,blobs,urls,voice:wavBlob(voice),voiceScale:voicePeak,useBacking,match,blend:Math.round(blend*100),commonGain,arrangement,voiceVolume,backingVolume};$('listen-status').textContent=`${useBacking?(arrangement?'已保存的新配樂':'同一份配樂')+(voicelabBackingStems(snapshot.row,arrangement).includes('backing')?'＋原和音':''):'只聽人聲'} · 人聲 ${voiceVolume}% · 配樂 ${useBacking?backingVolume:0}% · AI ${Math.round(blend*100)}%${match?' · 音量匹配':''}；切換保留目前播放位置。`;return mixes;
  }
  async function play(next){
    if(!result)return;const position=player.currentTime||0;side=next;beforePlay();
    try{const mix=await buildMixes();player.src=mix.urls[side==='original'?0:1];player.loop=$('loop').checked;player.currentTime=Math.min(position,Math.max(0,result.original.duration-.01));await player.play();
      for(const id of ['original','ai'])$('listen-'+id).setAttribute('aria-pressed',String(id===side));
    }catch(e){$('listen-status').textContent=e.message;}
  }
  $('listen-original').addEventListener('click',()=>void play('original'));$('listen-ai').addEventListener('click',()=>void play('ai'));
  for(const id of ['blend','backing','match','backing-choice','voice-volume','backing-volume'])$(id).addEventListener('input',()=>{labels();mixes=null;rendering++;player.pause();$('listen-status').textContent='試聽混音已改，按「原聲／Voice Lab」聽新效果；不需重新生成。';});
  $('loop').addEventListener('change',()=>{player.loop=$('loop').checked;});
  $('download').addEventListener('click',async()=>{
    try{const mix=await buildMixes(),s=result.report.settings,a=document.createElement('a'),pitch=s.pitchShift??0;a.href=mix.urls[1];a.download=`${result.row.title}_Voice Lab_${voicelabModelLabel(result.report)}_${result.interval.start}-${result.interval.end}秒${pitch?`_移調${pitch>0?'+':''}${pitch}半音`:''}_AI${$('blend').value}%_試聽.wav`.replace(/[\\/:*?"<>|]/g,'_');a.click();}catch(e){$('listen-status').textContent=e.message;}
  });
  $('save').addEventListener('click',async()=>{
    if(!result||busy||saving||externalBusy||result.draft!==draft())return;
    const snapshot=result,rev=revision;saving=true;controls();player.pause();say('正在保存 Voice Lab 成品與獨立人聲…');
    try{
      const mix=await buildMixes();if(rev!==revision||snapshot!==result)throw Error('選取錄音已變更，未保存。');
      const meta=voicelabSavedMetadata({...snapshot,...mix,bytes:mix.blobs[1].size,rawBytes:mix.voice.size});
      meta.fixedMixGains={version:1,voice:meta.balance.voice/100*mix.voiceScale,backing:meta.balance.backing/100};
      await store.saveRemix(meta,mix.blobs[1],mix.voice);
      await onSaved(meta);
      say('已另存 Voice Lab 至錄音清單；原錄音保留。');
    }catch(e){say('Voice Lab 保存未完成：'+e.message);}
    finally{saving=false;controls();}
  });
  $('mv').addEventListener('click',async()=>{
    if(!result||busy||saving||externalBusy||result.draft!==draft())return;
    const snapshot=result;saving=true;controls();player.pause();
    try{const mix=await buildMixes();if(snapshot!==result)throw Error('來源已變更，請重新選取。');onMakeMV({title:snapshot.row.title,blob:mix.blobs[1],label:`${snapshot.row.title} · Voice Lab · ${voicelabModelLabel(snapshot.report)} · ${snapshot.interval.start.toFixed(2)}～${snapshot.interval.end.toFixed(2)} 秒 · 人聲 ${mix.voiceVolume}%／配樂 ${mix.useBacking?mix.backingVolume:0}%`});}catch(e){$('listen-status').textContent=e.message;}finally{saving=false;controls();}
  });
  window.addEventListener('pagehide',()=>{void cancel();clear();});
  function syncSource(){
    const row=source();
    if((row?.id??null)!==selectedId){selectedId=row?.id??null;void cancel();clear();$('backing-choice').replaceChildren(new Option('錄音原配樂',''));savedBackings=[];if(enabled())void refreshBackings();$('start').value=0;$('end').value=Math.min(20,row?.sourceSeconds??row?.seconds??20);}
    $('source-info').textContent=row?`待轉換：${row.voicelabSource==='original'?'原曲原唱':'我的錄音'} · ${row.title} · ${Number(row.sourceSeconds??row.seconds).toFixed(2)} 秒 · 校正 ${row.appliedDelayMs??row.recordingDelayMs??row.post?.offsetMs??0} ms`:$('source').value==='original'?'請先從歌曲庫載入含分離音軌的歌曲，不需要先錄音。':'請在上方選擇保留原始人聲的錄音。';
    $('source-routing').textContent=!row?'':row.voicelabSource==='original'?(row.post?.reference?.vocalMode==='lead'?'已載入主唱／和音版本：只轉換主唱，原和音與配樂一起混回，跟隨配樂音量；改用新配樂仍保留原和音。':'目前是人聲／伴奏兩軌：人聲中的和音也會一起換聲。要保留非主唱聲音，請先建立並載入主唱／和音版本。'):'轉換自己的錄音人聲；有獨立和音音軌時，會與配樂一起保留。';
    $('now').textContent=row?.voicelabSource==='original'?'從 Voice Lab 試聽位置取 20 秒':'從目前位置取 20 秒';rangeLabel();controls();
  }
  async function refreshBackings(){
    const cacheId=source()?.post?.reference?.cacheId;
    try{const data=await(await request('/arrangements/library')).json();if(cacheId!==source()?.post?.reference?.cacheId)return;const previous=$('backing-choice').value;savedBackings=data.records.filter(m=>m.cacheId===cacheId);$('backing-choice').replaceChildren(new Option('錄音原配樂',''));for(const m of savedBackings)$('backing-choice').add(new Option(m.title,m.id));if(savedBackings.some(m=>m.id===previous))$('backing-choice').value=previous;else if(previous){mixes=null;rendering++;player.pause();}}
    catch{/* Original accompaniment remains available on older helpers. */}
  }
  $('backing-refresh').addEventListener('click',()=>void refreshBackings());window.addEventListener('arrangement-saved',()=>void refreshBackings());
  window.addEventListener('arrangement-deleted',({detail})=>{if($('backing-choice').value===detail.id){$('backing-choice').value='';player.pause();mixes=null;rendering++;$('listen-status').textContent='所選新配樂已刪除，已切回錄音原配樂，請重新試聽。';}void refreshBackings();});
  reset();syncSource();
  createVoiceLabStorage({getProtectedIds:()=>[active,result?.jobId].filter(Boolean),beforePlay:()=>{player.pause();beforePlay();}});
  return {pause:()=>player.pause(),sync(row,locked){externalBusy=locked;syncSource();}};
}
