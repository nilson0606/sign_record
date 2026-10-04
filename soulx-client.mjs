import {wavBlob} from './recording-process.mjs';
import {SOULX_DEFAULTS,SOULX_REFERENCES,soulxSettings,soulxInterval} from './soulx-settings.mjs';
const BASE='http://127.0.0.1:4274';
const $=id=>document.getElementById('soulx-'+id);
async function request(path,options={}){
  let session;
  try{const response=await fetch(BASE+'/session',{signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error();session=await response.json();}
  catch{throw Error('請啟動本機唱錄工具，再使用 SoulX。');}
  const response=await fetch(BASE+path,{...options,headers:{'X-Karaoke-Token':session.token,...(options.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(options.body?120000:30000)});
  if(!response.ok){const e=await response.json().catch(()=>({}));throw Error(e.error||(response.status===404?'請重新啟動新版本機工具，才能使用 SoulX。':'SoulX 本機請求失敗。'));}
  return response;
}
const encode=async blob=>{const bytes=new Uint8Array(await blob.arrayBuffer()),parts=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(parts.join(''));};
export async function soulxSlice(buffer,start,end){
  const c=new OfflineAudioContext(1,Math.round((end-start)*24000),24000),node=c.createBufferSource();node.buffer=buffer;node.connect(c.destination);
  const when=Math.max(0,-start),offset=Math.max(0,start),duration=Math.min(buffer.duration-offset,end-start-when);
  if(duration>0)node.start(when,offset,duration);return c.startRendering();
}
function rms(buffer){const a=buffer.getChannelData(0);let sum=0;for(const x of a)sum+=x*x;return Math.sqrt(sum/a.length);}
function automaticReference(buffer,seconds){
  if(buffer.duration<seconds)throw Error('參考音檔比設定長度短，請縮短參考秒數。');
  const a=buffer.getChannelData(0),rate=buffer.sampleRate,hop=Math.max(1,Math.floor(rate/100));
  let best=0,bestPower=-1;
  for(let start=0;start+seconds<=buffer.duration;start+=.5){let sum=0;for(let i=Math.floor(start*rate);i<Math.floor((start+seconds)*rate);i+=hop)sum+=a[i]*a[i];if(sum>bestPower){best=start;bestPower=sum;}}
  return best;
}
export function createSoulx({store,getSelected,getPosition,beforePlay}){
  let selectedId=null,externalBusy=false,busy=false,revision=0,active=null,result=null,urls=[],mixes=null,rendering=0,side='ai';
  const say=text=>{$('status').textContent=text;};
  const eligible=()=>!!(getSelected()?.complete&&getSelected()?.rawBytes);
  const enabled=()=>$('enable').checked;
  const player=$('audio');
  function clear(){player.pause();player.removeAttribute('src');player.load();for(const u of urls)URL.revokeObjectURL(u);urls=[];mixes=null;result=null;rendering++;$('result').hidden=true;}
  function controls(){
    $('content').hidden=!enabled();$('fields').disabled=!enabled()||!eligible()||busy||externalBusy;
    $('cancel').disabled=!busy||!active;
    for(const id of ['listen-original','listen-ai','download'])$(id).disabled=!result||busy||externalBusy;
    $('backing').disabled=!result||result.row.mode!=='mix';
  }
  function labels(){for(const [id,unit] of [['steps',' 步'],['guidance',''],['reference-seconds',' 秒'],['blend','%']])$(id+'-value').textContent=$(id).value+unit;$('upload-label').hidden=$('reference').value!=='custom';}
  function settings(){return soulxSettings({reference:$('reference').value,referenceStart:$('reference-start').value===''?null:Number($('reference-start').value),referenceSeconds:Number($('reference-seconds').value),steps:Number($('steps').value),guidance:Number($('guidance').value),seed:Number($('seed').value)});}
  function reset(){for(const [id,key] of [['reference','reference'],['reference-seconds','referenceSeconds'],['steps','steps'],['guidance','guidance'],['seed','seed']])$(id).value=SOULX_DEFAULTS[key];$('reference-start').value='';labels();}
  async function cancel(){revision++;player.pause();if(active)try{await request('/soulx/jobs/'+active,{method:'DELETE'});}catch{}say(enabled()?'已取消 SoulX；原始錄音保留。':'SoulX 已關閉。');}
  $('enable').addEventListener('change',async()=>{
    controls();if(!enabled()){void cancel();return;}
    const rev=revision;say('檢查本機 SoulX 環境…');
    try{const state=await(await request('/soulx')).json();if(enabled()&&revision===rev)say(state.installed?'SoulX 已就緒。先選參考與範圍，再按「產生 SoulX 試聽」。':'SoulX 尚未安裝完成。');}catch(e){if(enabled()&&revision===rev)say(e.message);}
  });
  $('panel').addEventListener('toggle',()=>{if(!$('panel').open)player.pause();});
  $('cancel').addEventListener('click',()=>void cancel());
  $('random').addEventListener('click',()=>{$('seed').value=crypto.getRandomValues(new Uint32Array(1))[0]%2147483648;dirty();});
  $('reset').addEventListener('click',()=>{reset();dirty();});
  function dirty(){labels();if(result)say('參數已修改；目前試聽仍是上次結果，請重新產生以套用。');}
  $('fields').addEventListener('input',dirty);$('fields').addEventListener('change',dirty);
  $('now').addEventListener('click',()=>{const row=getSelected(),duration=row.sourceSeconds??row.seconds;const start=Math.min(Math.max(0,duration-1),getPosition());$('start').value=start.toFixed(2);$('end').value=Math.min(duration,start+20).toFixed(2);dirty();});
  $('full').addEventListener('click',()=>{const row=getSelected(),duration=row.sourceSeconds??row.seconds;if(duration>600){say('每次最多 10 分鐘，請分段選取。');return;}$('start').value=0;$('end').value=duration;dirty();});
  async function prepare(row,config){
    const interval=soulxInterval(Number($('start').value),Number($('end').value),row.sourceSeconds??row.seconds);
    const delayMs=row.appliedDelayMs??row.recordingDelayMs??row.post?.offsetMs??0;
    const context=new AudioContext({sampleRate:24000,sinkId:{type:'none'}});
    try{
      const blob=await store.blob(row,'voice');if(!blob.size||blob.size!==row.rawBytes)throw Error('原始人聲不完整，無法轉換。');
      const raw=await context.decodeAudioData(await blob.arrayBuffer());
      const source=await soulxSlice(raw,interval.start+delayMs/1000,interval.end+delayMs/1000);
      const audio=await encode(wavBlob(source));let referenceAudio;
      if(['self','custom'].includes(config.reference)){
        let ref=raw;
        if(config.reference==='custom'){
          const file=$('upload').files[0];if(!file||file.size>50*1024*1024)throw Error('請選擇 50 MB 以內的參考音檔。');
          ref=await context.decodeAudioData(await file.arrayBuffer());
        }
        const start=config.referenceStart??automaticReference(ref,config.referenceSeconds),end=start+config.referenceSeconds;
        if(end>ref.duration+.001)throw Error('參考區段超出音檔長度。');
        config={...config,referenceStart:start};referenceAudio=await encode(wavBlob(await soulxSlice(ref,start,end)));
      }
      return {payload:{audio,referenceAudio,settings:config},interval,delayMs};
    }finally{await context.close();}
  }
  $('generate').addEventListener('click',async()=>{
    if(!enabled()||busy||externalBusy||!eligible())return;
    if(document.getElementById('mic-stop')&&!document.getElementById('mic-stop').disabled){say('請先停止收音，再生成 SoulX，避免影響錄製。');return;}
    const rev=++revision,row=structuredClone(getSelected());busy=true;clear();controls();
    try{
      beforePlay();say('準備原始人聲與參考片段…');const input=await prepare(row,settings());if(rev!==revision)return;
      let state=await(await request('/soulx/jobs',{method:'POST',body:JSON.stringify(input.payload)})).json();active=state.id;controls();
      if(rev!==revision){await request('/soulx/jobs/'+active,{method:'DELETE'});return;}
      for(let attempt=0;attempt<610;attempt++){
        if(rev!==revision)return;say(state.message);
        if(state.stage==='ready')break;if(['failed','cancelled'].includes(state.stage))throw Error(state.message);
        await new Promise(resolve=>setTimeout(resolve,1500));if(rev!==revision)return;
        state=await(await request('/soulx/jobs/'+active)).json();
      }
      if(state.stage!=='ready')throw Error('生成逾時，請重新嘗試。');
      const blobs=await Promise.all(['source','result'].map(async name=>(await request('/soulx/jobs/'+active+'/'+name)).blob()));if(rev!==revision)return;
      const context=new AudioContext({sampleRate:24000,sinkId:{type:'none'}});
      try{const [original,converted]=await Promise.all(blobs.map(async b=>context.decodeAudioData(await b.arrayBuffer())));if(rev!==revision)return;result={row,original,converted,report:state.result,interval:input.interval,delayMs:input.delayMs,tracks:null};}finally{await context.close();}
      $('result').hidden=false;$('blend').value=100;$('backing').checked=row.mode==='mix';labels();
      const s=result.report.settings;$('result-info').textContent=`本次：${SOULX_REFERENCES[s.reference]} · ${s.steps} 步 · CFG ${s.guidance} · 種子 ${s.seed} · ${input.interval.start.toFixed(2)}～${input.interval.end.toFixed(2)} 秒 · 沿用校正 ${input.delayMs} ms。總長度一致不代表逐字對齊；尚屬實驗結果。`;
      say('已完成。按「原聲／SoulX」同位置切換比較；原錄音與 A／B 設定保留。');
    }catch(e){if(rev===revision)say(e.message);if(active)await request('/soulx/jobs/'+active,{method:'DELETE'}).catch(()=>{});}
    finally{busy=false;active=null;controls();}
  });
  async function buildMixes(){
    if(!result)throw Error('請先產生 SoulX。');const snapshot=result,rev=revision,pass=++rendering;
    const useBacking=$('backing').checked&&snapshot.row.mode==='mix',match=$('match').checked,blend=Number($('blend').value)/100;
    const key=JSON.stringify([useBacking,match,blend]);if(mixes?.key===key)return mixes;
    $('listen-status').textContent='準備試聽音訊…';
    if(useBacking&&!snapshot.tracks){
      const context=new AudioContext({sampleRate:24000,sinkId:{type:'none'}});
      try{const tracks=[];for(const stem of snapshot.row.stems??[]){const blob=await(await request(`/library/${snapshot.row.post.reference.cacheId}/${stem}`)).blob();tracks.push(await context.decodeAudioData(await blob.arrayBuffer()));}snapshot.tracks=tracks;}finally{await context.close();}
    }
    const gain=match?Math.min(4,rms(snapshot.original)/Math.max(rms(snapshot.converted),.00001)):1;
    async function render(ai){
      const context=new OfflineAudioContext(2,snapshot.original.length,24000),balance=snapshot.row.balance??{},voiceGain=(balance.voice??70)/100,backGain=(balance.backing??50)/100;
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
    mixes={key,blobs,urls};$('listen-status').textContent=`${useBacking?'同一份配樂':'只聽人聲'} · AI ${Math.round(blend*100)}%${match?' · 音量匹配':''}；切換保留目前播放位置。`;return mixes;
  }
  async function play(next){
    if(!result)return;const position=player.currentTime||0;side=next;beforePlay();
    try{const mix=await buildMixes();player.src=mix.urls[side==='original'?0:1];player.loop=$('loop').checked;player.currentTime=Math.min(position,Math.max(0,result.original.duration-.01));await player.play();
      for(const id of ['original','ai'])$('listen-'+id).setAttribute('aria-pressed',String(id===side));
    }catch(e){$('listen-status').textContent=e.message;}
  }
  $('listen-original').addEventListener('click',()=>void play('original'));$('listen-ai').addEventListener('click',()=>void play('ai'));
  for(const id of ['blend','backing','match'])$(id).addEventListener('input',()=>{labels();mixes=null;rendering++;player.pause();$('listen-status').textContent='試聽混音已改，按「原聲／SoulX」聽新效果；不需重新生成。';});
  $('loop').addEventListener('change',()=>{player.loop=$('loop').checked;});
  $('download').addEventListener('click',async()=>{
    try{const mix=await buildMixes(),s=result.report.settings,a=document.createElement('a');a.href=mix.urls[1];a.download=`${result.row.title}_SoulX_${SOULX_REFERENCES[s.reference]}_${s.steps}步_CFG${s.guidance}_${result.interval.start}-${result.interval.end}秒_AI${$('blend').value}%_試聽.wav`.replace(/[\\/:*?"<>|]/g,'_');a.click();}catch(e){$('listen-status').textContent=e.message;}
  });
  window.addEventListener('pagehide',()=>{void cancel();clear();});
  reset();controls();
  return {pause:()=>player.pause(),sync(row,locked){
    externalBusy=locked;
    if((row?.id??null)!==selectedId){selectedId=row?.id??null;void cancel();clear();$('start').value=0;$('end').value=Math.min(20,row?.sourceSeconds??row?.seconds??20);}
    $('source-info').textContent=row?`來源：${row.title} · ${Number(row.sourceSeconds??row.seconds).toFixed(2)} 秒 · 校正 ${row.appliedDelayMs??row.recordingDelayMs??row.post?.offsetMs??0} ms`:'請在上方選擇保留原始人聲的錄音。';controls();
  }};
}
