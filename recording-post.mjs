import { recordingTuningSuffix } from './recording-tune.mjs';
import { softeningProfile, recordingSofteningSuffix } from './recording-soften.mjs';
import { scoringProfile } from './scoring.mjs';
import { recordingVolume } from './recording-mix.mjs';
import { rescoreRecording, remixRecording, wavBlob, delaySeconds, referenceForRescore, recordingDelaySuffix } from './recording-process.mjs';
const $=id=>document.getElementById(id), BASE='http://127.0.0.1:4274';
async function localRequest(path,body) {
  let response;
  try {
    const session=await fetch(BASE+'/session',{signal:AbortSignal.timeout(8000)});
    if(!session.ok)throw new Error();const info=await session.json();
    if(body&&!info.features?.includes('recording-mp3'))throw new Error('請更新並重新啟動本機工具，才能轉 MP3。');
    response=await fetch(BASE+path,{method:body?'POST':'GET',headers:{'X-Karaoke-Token':info.token,...(body?{'Content-Type':'application/octet-stream'}:{})},body,signal:AbortSignal.timeout(body?180000:30000)});
  }catch(error){throw new Error(error.message.includes('MP3')?error.message:'無法連接本機工具，請啟動後再試。');}
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'所需音軌不存在，請還原相同版本的歌曲音軌。');}
  return response;
}
async function recordedAnalysis(blob, progress) {
  const context=new AudioContext({sampleRate:16000,sinkId:{type:'none'}});
  let audio,sampleRate;
  try {
    const decoded=await context.decodeAudioData(await blob.arrayBuffer());sampleRate=decoded.sampleRate;
    audio=new Float32Array(decoded.length);
    for(let c=0;c<decoded.numberOfChannels;c++){const channel=decoded.getChannelData(c);for(let i=0;i<audio.length;i++)audio[i]+=channel[i]/decoded.numberOfChannels;}
  } finally {await context.close();}
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./recording-analysis.mjs',import.meta.url),{type:'module'});
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('歌聲分析逾時，請重試。'));},600000);
    const done=(error,value)=>{clearTimeout(timer);worker.terminate();error?reject(error):resolve(value);};
    worker.onerror=()=>done(new Error('歌聲分析無法啟動，請更新頁面後重試。'));
    worker.onmessage=({data})=>{if(data.error)done(new Error(data.error));else if(data.result)done(null,data.result);else progress(data.progress);};
    worker.postMessage({audio,sampleRate},[audio.buffer]);
  });
}
export function createRecordingPost({store,stop,pause,download,onDelete,reference=()=>null}) {
  let rows=[],selected=null,busy=false,url=null,statusTarget='post-status';
  const status=text=>{$(statusTarget).textContent=text;};
  function clearAudio(){const a=$('post-audio');a.pause();a.removeAttribute('src');a.load();a.hidden=true;if(url)URL.revokeObjectURL(url);url=null;}
  function referenceName(ref) {
    if(!ref)return '尚未載入';
    return `${(ref.pitchMethod||'yin').toUpperCase()} · ${({demucs:'Demucs','bs-roformer':'BS-RoFormer','mel-roformer':'Mel-Band RoFormer'})[ref.separationModel]||'Demucs'} · ${ref.separationMethod==='residual'?'二次分離＋相減':'單次分離'} · ${ref.vocalMode==='lead'?'主唱':'人聲'} · ${Math.round(ref.duration??ref.frames.length*ref.step)} 秒`;
  }
  function controls(){
    const editable=!!(selected?.complete&&selected.rawBytes&&selected.post?.segments?.length);
    $('post-diagnostic').disabled=busy||!editable;
    for(const action of ['preview','download','delete'])$('selected-recording-'+action).disabled=busy||!selected;
    $('selected-recording-edit').disabled=busy||!editable;
    $('post-recording').disabled=busy;$('score-recording').disabled=busy;
    $('post-delay').disabled=busy||!editable;$('remix-delay').disabled=busy||!editable;
    $('post-reference-source').disabled=busy||!editable;
    $('post-difficulty').disabled=busy||!editable;
    $('post-softening').disabled=busy||!editable;
    $('post-voice-level').disabled=busy||!editable;
    $('post-backing-level').disabled=busy||!editable||selected?.mode!=='mix';
    const current=reference();let referenceError='';
    if(editable&&$('post-reference-source').value==='current')try{referenceForRescore(selected.post,current);}catch(error){referenceError=error.message;}
    $('post-reference-info').textContent=editable?`錄音原始基準：${referenceName(selected.post.reference)}。目前已載入：${referenceName(current)}。${referenceError||($('post-reference-source').value==='current'?'這次使用目前已載入基準，保留錄音當時的遮罩、八度與評分範圍，難度使用「評分設定」中的重新評分難度。':'這次使用錄音當時的基準；換歌曲庫版本不會自動套用。')}`:'';
    $('post-rescore').disabled=busy||!editable||!!referenceError;$('post-remix').disabled=busy||!editable;$('post-mp3').disabled=busy||!selected;
  }
  function choose(){
    clearAudio();selected=rows.find(x=>x.id===$('post-recording').value)||null;
    $('score-recording').value=$('post-recording').value;
    $('rescore-status').textContent=selected?'已選取錄音，可調整設定後重新評分。':'請先保存一段演唱錄音。';
    $('post-reference-source').value='original';
    $('post-softening').value=selected?.vocalSoftening?.strength||'off';
    const volume=recordingVolume(selected?.postVolume);
    $('post-voice-level').value=volume.voice;$('post-backing-level').value=volume.backing;
    volumeLabels();
    $('post-difficulty').value='relaxed';
    $('post-delay').value=selected?.postResult?.delayMs??selected?.post?.offsetMs??0;
    $('remix-delay').value=$('post-delay').value;
    $('post-info').textContent=selected?(selected.post&&selected.rawBytes?'已保存乾淨歌聲、播放位置與當次基準，可重評／重合成。':'此錄音未保存後處理來源，可轉 MP3 下載。'): '請先保存一段演唱錄音。';
    showScore();controls();
  }
  function showScore(){const r=selected?.postResult;$('post-score').textContent=r?`${r.source==='decoded-voice-v1'?'音檔重評':'舊版即時資料重評'} · ${r.referenceSource==='current'?'改用已載入基準':'錄音當時基準'} ${(r.reference?.pitchMethod||selected.post?.reference?.pitchMethod||'yin').toUpperCase()} · ${scoringProfile(r.scoring?.difficulty??selected.post?.scoring?.difficulty).label} · 校正 ${r.delayMs} ms · 總分 ${r.score??'—'} · 音準 ${r.pitch} · 進拍 ${r.rhythm} · 完整度 ${r.coverage} · 可計分旋律 ${r.referenceSeconds} 秒${r.baseline ? ` · 同音檔 0 ms 進拍 ${r.baseline.rhythm}` : ''}`:'';}
  function refresh(value){rows=value;const old=$('post-recording').value;const options=rows.map(row=>{const o=document.createElement('option');o.value=row.id;o.textContent=`${row.title}${recordingSofteningSuffix(row)}${recordingTuningSuffix(row)}${recordingDelaySuffix(row)?" "+recordingDelaySuffix(row):""} · ${new Date(row.created).toLocaleString()}`;return o;});$('post-recording').replaceChildren(...options);$('score-recording').replaceChildren(...options.map(o=>o.cloneNode(true)));if(rows.some(r=>r.id===old))$('post-recording').value=old;if(selected?.id===old&&rows.some(r=>r.id===old)){selected=rows.find(r=>r.id===old);$('score-recording').value=old;controls();}else if(!busy)choose();}
  function select(id,{scroll=true}={}){if(!rows.some(row=>row.id===id))return;$('post-recording').value=id;choose();if(scroll)$('recording-post').scrollIntoView({block:'start'});}
  async function run(action,target='post-status'){if(busy||!selected)return;statusTarget=target;busy=true;controls();try{const row=selected;await stop();pause();if(row)await action(row);}catch(error){status(error.message);}finally{busy=false;controls();statusTarget='post-status';}}
  $('selected-recording-preview').addEventListener('click',()=>run(async row=>{
    clearAudio();url=URL.createObjectURL(await store.blob(row));
    $('post-audio').src=url;$('post-audio').hidden=false;await $('post-audio').play();
    status('正在試聽：'+row.title+recordingDelaySuffix(row));
  }));
  $('selected-recording-download').addEventListener('click',()=>run(async row=>{
    download(await store.blob(row),row);status('已開始下載選取的錄音。');
  }));
  $('selected-recording-edit').addEventListener('click',()=>{
    if(busy||!selected)return;
    $('remix-delay').scrollIntoView({block:'center'});$('remix-delay').focus({preventScroll:true});
  });
  $('selected-recording-delete').addEventListener('click',()=>{
    if(busy||!selected)return;
    if(!confirm('刪除這筆錄音、原始歌聲及其後處理資料？此操作無法復原。\n'+selected.title+' · '+new Date(selected.created).toLocaleString()))return;
    run(async row=>{clearAudio();await store.delete(row.id);await onDelete();choose();status('已刪除選取的錄音。');});
  });
  $('post-audio').addEventListener('play',pause);
  $('post-recording').addEventListener('change',choose);
  $('score-recording').addEventListener('change',()=>{$('post-recording').value=$('score-recording').value;choose();});
  $('post-delay').addEventListener('input',()=>{$('remix-delay').value=$('post-delay').value;});
  $('remix-delay').addEventListener('input',()=>{$('post-delay').value=$('remix-delay').value;});
  $('post-reference-source').addEventListener('change',controls);
  function volumeLabels(){
    $('post-voice-value').textContent=$('post-voice-level').value+'%';
    $('post-backing-value').textContent=$('post-backing-level').value+'%';
  }
  for(const id of ['post-voice-level','post-backing-level'])$(id).addEventListener('input',volumeLabels);
  $('post-rescore').addEventListener('click',()=>run(async row=>{
    const delayMs=Number($('post-delay').value);delaySeconds(delayMs);
    const referenceSource=$('post-reference-source').value;
    const scoringReference=referenceSource==='current'?referenceForRescore(row.post,reference()):structuredClone(row.post.reference);
    status(`正在以 ${referenceName(scoringReference)} 重新評分…`);
    if(row.post.audioAnalysis?.source!=='decoded-voice-v1') {
      status('正在從保存的乾淨歌聲重新擷取音高…');
      row.post.audioAnalysis=await recordedAnalysis(await store.blob(row,'voice'),percent=>status(`正在分析乾淨歌聲 ${percent}%…`));
    }
    const scoring={...row.post.scoring,difficulty:scoringProfile($('post-difficulty').value).id};
    const scoringPost={...row.post,reference:scoringReference,scoring};
    row.postResult={...rescoreRecording(scoringPost,delayMs),delayMs,scoring,source:'decoded-voice-v1',referenceSource,reference:scoringReference,baseline:rescoreRecording(scoringPost,0)};await store.save(row);showScore();status('重評完成：直接分析保存的歌聲，使用與重混相同的時間軸；結果、難度與所用基準已保存，錄音原始基準及成績紀錄保留。');
  },'rescore-status'));
  $('post-remix').addEventListener('click',()=>run(async row=>{
    const delayMs=Number($('remix-delay').value);delaySeconds(delayMs);
    const softening=softeningProfile($('post-softening').value);
    const volume=recordingVolume({voice:Number($('post-voice-level').value),backing:Number($('post-backing-level').value)});
    status('正在載入乾淨歌聲與配樂／和音…');
    const context=new AudioContext({sinkId:{type:'none'}});
    try{
      const rawBlob=await store.blob(row,'voice');
      if(!rawBlob.size||rawBlob.size!==row.rawBytes)throw new Error('原始歌聲不完整，無法另存可繼續後製的成品。');
      const raw=await context.decodeAudioData(await rawBlob.arrayBuffer()),tracks=[];
      if(row.mode==='mix')for(const stem of row.stems){const response=await localRequest(`/library/${row.post.reference.cacheId}/${stem}`);tracks.push(await context.decodeAudioData(await response.arrayBuffer()));}
      status(softening.id==='off'?'正在校正歌聲位置並合成…':`正在套用${softening.label}歌聲柔化並合成…`);
      const audio=await remixRecording(raw,tracks,row,delayMs,{softening:softening.id,volume}),blob=wavBlob(audio);
      const result={id:crypto.randomUUID(),title:row.title,videoId:row.videoId,mode:row.mode,stems:row.stems,mime:'audio/wav',created:Date.now(),seconds:audio.duration,bytes:blob.size,complete:true,parentId:row.id,delayMs,appliedDelayMs:delayMs,vocalSoftening:{version:2,strength:softening.id}};
      result.postVolume=volume;
      result.rawBytes=rawBlob.size;result.rawMime=row.rawMime||rawBlob.type||row.mime;
      result.post=structuredClone(row.post);result.post.offsetMs=delayMs;
      result.balance=structuredClone(row.balance);
      result.sourceSeconds=row.sourceSeconds??row.seconds;
      await store.saveRemix(result,blob,rawBlob);refresh(await store.list());$('post-recording').value=result.id;choose();clearAudio();url=URL.createObjectURL(blob);$('post-audio').src=url;$('post-audio').hidden=false;
      status(`已另存校正後錄音${softening.id==='off'?'':`（歌聲柔化：${softening.label}）`} · 歌唱者 ${volume.voice}%${row.mode==='mix'?` · 配樂／和音 ${volume.backing}%`:''}，請按播放器試聽；可轉 MP3。原錄音保留，這筆成品也可繼續後製。`);
      window.dispatchEvent(new Event('recording-post-saved'));
    }finally{await context.close();}
  }));
  $('post-diagnostic').addEventListener('click',()=>run(async row=>{
    status('正在打包這筆錄音的本機診斷資料…');
    async function audioPart(track){
      const blob=await store.blob(row,track);
      if(blob.size>128*1024*1024)throw new Error('這筆錄音超過診斷匯出大小限制，請改用較短錄音。');
      const bytes=new Uint8Array(await blob.arrayBuffer()),parts=[];
      for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
      return {mime:blob.type,base64:btoa(parts.join(''))};
    }
    const value={format:'karaoke-recording-diagnostic',version:1,exportedAt:new Date().toISOString(),appBuild:document.querySelector('meta[name="app-build"]')?.content,recording:row,audio:{voice:await audioPart('voice'),mix:await audioPart('mix')}};
    const blob=new Blob([JSON.stringify(value)],{type:'application/json'}),href=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=href;a.download=`karaoke-diagnostic-${row.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(href),60000);
    status('診斷檔已下載到本機。這份檔案含本次歌聲，請提供此檔或其本機路徑以檢查，不需重唱。');
  },'rescore-status'));
  $('post-mp3').addEventListener('click',()=>run(async row=>{
    status('正在本機轉成 MP3…');const blob=await store.blob(row),response=await localRequest('/recordings/mp3',blob),mp3=await response.blob();
    let savedPath='',saveError='';try{savedPath=(await store.saveMp3(row,mp3)).path;}catch(error){saveError=error.message;}
    const href=URL.createObjectURL(mp3),a=document.createElement('a');a.href=href;a.download=row.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,100)+recordingSofteningSuffix(row)+recordingTuningSuffix(row)+recordingDelaySuffix(row)+'.mp3';a.click();setTimeout(()=>URL.revokeObjectURL(href),60000);status(savedPath?'MP3 已轉換並開始下載，同時保存至 '+savedPath+'。':'MP3 已轉換並開始下載，但尚未存入錄音目錄：'+saveError);
  }));
  window.addEventListener('pagehide',clearAudio);
  return {refresh,select,controls,clearAudio};
}
