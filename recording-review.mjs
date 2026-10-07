import {remixRecording,wavBlob} from './recording-process.mjs';

// Pending whole-song takes stay durable, but are not offered to post-processing.
export function createRecordingReview({store,pause,loadStem,onChanged,isRecording}) {
  const $=id=>document.getElementById('recording-review-'+id);
  let rows=[],selected=null,working=false,loading=false,url=null,request=0;
  const status=text=>{$('status').textContent=document.getElementById('recording-status').textContent=text;};
  function clear(){
    request++;loading=false;$('audio').pause();$('audio').removeAttribute('src');$('audio').load();$('audio').hidden=true;
    if(url)URL.revokeObjectURL(url);url=null;
  }
  function controls(){
    const locked=working||isRecording();
    $('take').disabled=$('mode').disabled=locked;
    $('listen').disabled=locked||loading||!selected?.rawBytes;
    $('save').disabled=locked||!selected?.complete;
    $('delete').disabled=locked||!selected;
  }
  function refresh(all,savedId){
    rows=all.filter(row=>row.postPending&&!row.segmentTake);
    const id=rows.some(row=>row.id===savedId)?savedId:selected?.id;
    const next=rows.find(row=>row.id===id)||rows[0]||null;
    if(next?.id!==selected?.id)clear();selected=next;
    $('take').replaceChildren(...rows.map(row=>new Option(`${row.title} · ${new Date(row.created).toLocaleString()} · ${row.seconds.toFixed(1)} 秒${row.complete?'':' · 未完整結束'}`,row.id)));
    if(selected)$('take').value=selected.id;
    document.getElementById('recording-review').hidden=!rows.length;
    controls();
  }
  async function listen(){
    if(working||loading||isRecording()||!selected)return;
    const row=selected,mode=$('mode').value,delay=row.recordingDelayMs??200,ref=row.post.reference;
    if(mode==='mix'&&!ref.hasPreview)throw Error('沒有已保存的伴樂，請補建音軌或選「純人聲」。');
    clear();pause();const token=request,cancelled=()=>token!==request||isRecording();loading=true;controls();status('正在準備試聽…');
    let context;
    try{
      const blob=await store.blob(row,'voice');if(cancelled())return;
      if(!blob.size)throw Error('無法讀取人聲錄音。');
      context=new AudioContext({sampleRate:48000,sinkId:{type:'none'}});
      const raw=await context.decodeAudioData(await blob.arrayBuffer()),tracks=[];if(cancelled())return;
      if(mode==='mix')for(const stem of ['accompaniment',...(ref.vocalMode==='lead'?['backing']:[])]){
        const bytes=await loadStem(ref,stem);if(cancelled())return;
        const buffer=await context.decodeAudioData(bytes);if(cancelled())return;
        if(buffer.duration<Math.max(...row.post.segments.map(s=>s.songTime+s.duration))-.15)throw Error('伴樂長度不足，請補建完整音軌。');
        tracks.push(buffer);
      }
      const audio=await remixRecording(raw,tracks,{...row,mode},delay);if(cancelled())return;
      url=URL.createObjectURL(wavBlob(audio));$('audio').src=url;$('audio').hidden=false;await $('audio').play();
      if(!cancelled())status(`正在試聽${mode==='mix'?'人聲＋伴樂／和音':'純人聲'} · 校正 ${delay} ms。滿意後按「存到錄音後處理」。`);
    }catch(e){if(token===request){clear();throw e;}}
    finally{if(context)await context.close().catch(()=>{});if(token===request)loading=false;controls();}
  }
  async function save(){
    if(working||isRecording()||!selected?.complete)return;
    const row=selected;working=true;clear();controls();
    try{await store.save({...row,postPending:false});await onChanged(row.id);status('已存到錄音後處理。');}
    finally{working=false;controls();}
  }
  async function remove(){
    if(working||isRecording()||!selected)return;
    const row=selected;
    if(!confirm(`刪除待確認錄音「${row.title} · ${new Date(row.created).toLocaleString()}」？此版錄音與人聲將刪除，無法復原。`))return;
    working=true;clear();pause();controls();
    try{await store.delete(row.id);await onChanged();status('已刪除此版待確認錄音。');}
    finally{working=false;controls();}
  }
  for(const [id,fn]of [['listen',listen],['save',save],['delete',remove]])$(id).onclick=()=>Promise.resolve().then(fn).catch(e=>status(e.message));
  $('take').onchange=()=>{clear();selected=rows.find(row=>row.id===$('take').value)||null;controls();status('已選取待確認錄音，可先試聽。');};
  $('mode').onchange=()=>{clear();controls();status('試聽內容已變更，請按「試聽這一版」。');};
  $('audio').onplay=()=>{if(isRecording()||working){clear();controls();return;}pause();for(const audio of document.querySelectorAll('audio'))if(audio!==$('audio'))audio.pause();};
  document.addEventListener('play',event=>{if(event.target instanceof HTMLMediaElement&&event.target!==$('audio')){clear();controls();}},true);
  window.addEventListener('pagehide',clear);
  return {refresh,controls,clear};
}
