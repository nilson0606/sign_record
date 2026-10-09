import {wavBlob} from './recording-process.mjs';
import {ARRANGEMENT_PRESETS,ARRANGEMENT_INSTRUMENTS,ARRANGEMENT_STYLES,ARRANGEMENT_MOODS,ARRANGEMENT_CHORDS,ARRANGEMENT_KEYS,arrangementSections,arrangementPlan,arrangementSettings,arrangementRange,arrangementLabel} from './arrangement-settings.mjs';
const $=id=>document.getElementById('arrangement-'+id),BASE='http://127.0.0.1:4274';
async function request(route,options={}){
  let session;try{const r=await fetch(BASE+'/session',{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error();session=await r.json();}catch{throw Error('請啟動本機唱錄工具。');}
  const r=await fetch(BASE+route,{...options,headers:{'X-Karaoke-Token':session.token,...(options.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(120000)});
  if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.error||'配樂功能尚未就緒，請重新啟動新版工具。');}return r;
}
async function slice(buffer,start,end){const c=new OfflineAudioContext(2,Math.round((end-start)*48000),48000),n=c.createBufferSource();n.buffer=buffer;n.connect(c.destination);n.start(0,start,end-start);return c.startRendering();}
function rms(b){let sum=0;for(let c=0;c<b.numberOfChannels;c++)for(const x of b.getChannelData(c))sum+=x*x;return Math.sqrt(sum/(b.length*b.numberOfChannels));}
// Both alternatives use exactly the same singer, offsets, and common headroom.
export async function arrangementMixes(original,generated,voice,{solo=false,match=true}={}){
  if(original.length!==generated.length||original.sampleRate!==generated.sampleRate||(!solo&&voice.length!==original.length))throw Error('試聽音軌長度不一致。');
  const gain=match?Math.min(4,rms(original)/Math.max(.00001,rms(generated))):1;
  const render=async(back,level)=>{const c=new OfflineAudioContext(2,original.length,original.sampleRate);for(const [b,g] of [[back,level],...(!solo?[[voice,1]]:[])]){const n=c.createBufferSource(),v=c.createGain();n.buffer=b;v.gain.value=g;n.connect(v);v.connect(c.destination);n.start();}return c.startRendering();};
  const audio=await Promise.all([render(original,1),render(generated,gain)]);let peak=0;
  for(const b of audio)for(let c=0;c<b.numberOfChannels;c++)for(const x of b.getChannelData(c))peak=Math.max(peak,Math.abs(x));
  const headroom=Math.min(1,.98/Math.max(.00001,peak));if(headroom<1)for(const b of audio)for(let c=0;c<b.numberOfChannels;c++){const a=b.getChannelData(c);for(let i=0;i<a.length;i++)a[i]*=headroom;}
  return audio;
}
export function createArrangement({getReference,beforePlay}){
  // Start disabled even if the browser restored controls from the previous visit.
  $('panel').open=false;$('enable').checked=false;
  let sourceId=null,modelReady=false,busy=false,saving=false,locked=false,revision=0,active=null,result=null,library=[],urls=[],mixes=null,renderVersion=0,playVersion=0,timer=null;
  const player=$('audio'),say=t=>{$('status').textContent=t;},enabled=()=>$('enable').checked;
  const source=()=>{const r=getReference();return r?.hasPreview&&r.cacheId?r:null;};
  function relation(meta){
    const ref=getReference();if(!ref?.cacheId)return 'none';
    if(meta.cacheId===ref.cacheId)return 'match';
    const video=m=>m.videoId||/^([\w-]{11})_/.exec(m.cacheId??'')?.[1];
    return video(meta)&&video(meta)===video(ref)?'related':'other';
  }
  function libraryRelation(){
    const labels={match:'同曲同版本',related:'同曲・不同分離版本',other:'其他歌曲',none:'未載入歌曲'};
    for(const option of $('library').options){const meta=library.find(m=>m.id===option.value);if(!meta)continue;const kind=relation(meta);option.dataset.relation=kind;const text=`【${labels[kind]}】${meta.title}`;if(option.textContent!==text)option.textContent=text;}
    const selected=library.find(m=>m.id===$('library').value),kind=selected?relation(selected):'none';
    $('library').dataset.relation=kind;$('library-relation').dataset.relation=kind;
    const title=getReference()?.title??'目前歌曲';
    $('library-relation').textContent=!selected?'高亮：同曲同版本 · 金色：同曲不同分離版本 · 暗色：其他歌曲。全部都可選取、試聽或刪除。':kind==='match'?`✓ 與「${title}」同曲同版本。Voice Lab 可選用，配樂範圍仍需涵蓋歌聲。`:kind==='related'?`△ 與「${title}」是同一首歌，但分離版本不同。目前 Voice Lab 只提供同版本配樂選用。`:kind==='other'?`這份配樂屬於其他歌曲，與目前載入的「${title}」不同。`:'尚未載入歌曲，暫不判斷關聯；仍可試聽或刪除。';
  }
  function controls(){
    $('content').hidden=!enabled();$('fields').disabled=!enabled()||!source()||busy||saving||locked;$('enable').disabled=saving;$('generate').disabled=!modelReady||busy||saving||locked;$('cancel').disabled=!busy||!active;
    for(const id of ['listen-original','listen-new','download','load','delete','refresh','listen-mode','match','library'])$(id).disabled=busy||saving||locked;
    $('save').disabled=!result||!!result.saved||!result.jobId||busy||saving||locked;
    $('load').disabled||=!$('library').value;
    $('delete').disabled||=!$('library').value;
    libraryRelation();
  }
  function resetAudio(){player.pause();player.removeAttribute('src');player.load();urls.forEach(URL.revokeObjectURL);urls=[];mixes=null;renderVersion++;playVersion++;}
  function clear(){resetAudio();result=null;$('result').hidden=true;}
  function settings(){return arrangementSettings({preset:$('preset').value,style:$('style').value,mood:$('mood').value,density:$('density').value,instruments:[...$('instruments').querySelectorAll('input:checked')].map(n=>n.value),chordStyle:$('chordStyle').value,chordsPerBar:Number($('chordsPerBar').value),key:$('key').value,sections:arrangementSections($('sections').value),seed:Number($('seed').value)});}
  function preset(key){const p=ARRANGEMENT_PRESETS[key];if(!p)return;for(const id of ['style','mood','density'])$(id).value=p[id];for(const n of $('instruments').querySelectorAll('input'))n.checked=p.instruments.includes(n.value);}
  for(const [id,items] of [['preset',Object.fromEntries([...Object.entries(ARRANGEMENT_PRESETS).map(([k,v])=>[k,v.label]),['custom','自選組合']])],['style',ARRANGEMENT_STYLES],['mood',ARRANGEMENT_MOODS]])for(const [key,v] of Object.entries(items))$(id).add(new Option(Array.isArray(v)?v[0]:v,key));
  for(const [key,[label]] of Object.entries(ARRANGEMENT_INSTRUMENTS)){const l=document.createElement('label'),n=document.createElement('input');n.type='checkbox';n.value=key;l.append(n,document.createTextNode(' '+label));$('instruments').append(l);}
  for(const [key,label] of Object.entries(ARRANGEMENT_CHORDS))$('chordStyle').add(new Option(label,key));
  for(const key of ARRANGEMENT_KEYS)$('key').add(new Option(key==='auto'?'自動分析':key.endsWith('m')?key.slice(0,-1)+' 小調':key+' 大調',key));
  preset('piano');
  $('preset').addEventListener('change',()=>preset($('preset').value));
  for(const id of ['instruments','style','mood','density'])$(id).addEventListener('change',()=>{$('preset').value='custom';});
  $('fields').addEventListener('input',()=>{if(result)say('設定已調整，目前試聽仍是上次生成結果；按「產生 MIDI-SAG 配樂」套用。');});
  $('random').addEventListener('click',()=>{$('seed').value=crypto.getRandomValues(new Uint32Array(1))[0]%2147483648;});
  $('full').addEventListener('click',()=>{const r=source();if(!r)return;if(r.duration>600){say('每次最多 10 分鐘，請選取範圍。');return;}$('start').value=0;$('end').value=r.duration;});
  $('clip').addEventListener('click',()=>{const r=source();if(!r)return;const t=Math.min(r.duration-1,(result?.meta.start??0)+(player.currentTime||0));$('start').value=t.toFixed(2);$('end').value=Math.min(r.duration,t+30).toFixed(2);});
  async function refresh(){const data=await(await request('/arrangements/library')).json();library=data.records;const previous=$('library').value;$('library').replaceChildren(new Option(library.length?'選擇已保存配樂':'尚無已保存配樂',''));for(const m of library)$('library').add(new Option(m.title,m.id));if(library.some(m=>m.id===previous))$('library').value=previous;$('library-path').textContent=`本機保存位置：${data.path}。共 ${library.length} 份，包含所有歌曲與分離版本。`;controls();}
  async function cancel(){revision++;player.pause();if(active)await request('/arrangements/jobs/'+active,{method:'DELETE'}).catch(()=>{});say('已取消；原曲保留。');}
  $('cancel').addEventListener('click',()=>void cancel());
  $('enable').addEventListener('change',async()=>{modelReady=false;controls();if(!enabled()){void cancel();return;}syncSource();const rev=revision;try{const state=await(await request('/arrangements')).json();if(rev!==revision||!enabled())return;modelReady=state.installed===true&&state.model==='midi-sag';$('model-state').textContent=modelReady?'MIDI-SAG 已通過本機生成驗證。':state.model==='midi-sag'?(state.message||'MIDI-SAG 尚未安裝與驗證完成，暫不開放生成。'):'請重新啟動新版本機工具，以使用 MIDI-SAG。';say(modelReady?'MIDI-SAG 已就緒，預選整首；可調整和弦與音色方向。':$('model-state').textContent);controls();await refresh();}catch(e){say(e.message);}});
  $('panel').addEventListener('toggle',()=>{if(!$('panel').open)player.pause();});
  $('refresh').addEventListener('click',()=>void refresh().catch(e=>say(e.message)));$('library').addEventListener('change',controls);
  $('delete').addEventListener('click',async()=>{
    if(busy||saving||locked)return;const meta=library.find(m=>m.id===$('library').value);if(!meta)return;
    if(!window.confirm(`刪除這份已保存配樂？\n${meta.title}\n\n會移除本機配樂檔案，無法復原。`))return;
    saving=true;controls();
    try{await request(`/arrangements/library/${meta.id}?root=${encodeURIComponent(meta._archiveRoot)}`,{method:'DELETE'});
      if(result&&(result.meta.id===meta.id||result.jobId===meta.id))clear();
      window.dispatchEvent(new CustomEvent('arrangement-deleted',{detail:{id:meta.id}}));
      await refresh();say('已刪除選取配樂。');
    }catch(e){say('配樂未刪除：'+e.message);}finally{saving=false;controls();}
  });
  async function decode(blob){const c=new AudioContext({sampleRate:48000,sinkId:{type:'none'}});try{return await c.decodeAudioData(await blob.arrayBuffer());}finally{await c.close();}}
  function present(){
    const m=result.meta,adjust=(m.outputSamples-m.generatedSamples)/48000,isMidi=m.model==='MIDI-SAG';
    if(result.saved&&isMidi){const cfg=arrangementSettings(m.settings);for(const k of ['preset','style','mood','density','seed','chordStyle','chordsPerBar','key'])$(k).value=cfg[k];for(const n of $('instruments').querySelectorAll('input'))n.checked=cfg.instruments.includes(n.value);$('sections').value=cfg.sections.map(r=>`${r.start} ${r.tag}`).join('\n');$('start').value=m.start;$('end').value=m.end;}
    $('result').hidden=false;
    const description=isMidi?`${ARRANGEMENT_CHORDS[m.settings.chordStyle]} · ${m.settings.key==='auto'?'自動調性':m.settings.key} · 每小節 ${m.settings.chordsPerBar} 次和弦`:'舊版保存配樂（可繼續試聽及使用）';
    $('result-info').textContent=`${arrangementLabel(m.settings)} · ${m.start.toFixed(2)}～${m.end.toFixed(2)} 秒 · ${description} · 種子 ${m.settings.seed}。${Number.isFinite(adjust)&&Math.abs(adjust)>.0001?`尾端${adjust>0?'補靜音':'裁去'} ${Math.abs(adjust).toFixed(3)} 秒，沒有拉伸整首。`:''}請比較和聲、拍點與段落銜接。`;controls();
  }
  $('generate').addEventListener('click',async()=>{
    if(busy||saving||locked||!modelReady||!enabled()||!source())return;
    if(document.getElementById('mic-stop')&&!document.getElementById('mic-stop').disabled){say('請先停止收音，再生成配樂。');return;}
    const ref=structuredClone(source()),rev=++revision;busy=true;clear();controls();beforePlay();const began=performance.now();
    $('progress').hidden=false;$('progress-bar').removeAttribute('value');$('progress-label').textContent='準備生成…';
    const elapsed=()=>{const sec=Math.floor((performance.now()-began)/1000);$('elapsed').textContent=`已用時間 ${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;};elapsed();timer=setInterval(elapsed,1000);
    try{
      const range=arrangementRange(Number($('start').value),Number($('end').value),ref.duration),config=settings();arrangementPlan(config,range.start,range.end);
      let state=await(await request('/arrangements/jobs',{method:'POST',body:JSON.stringify({cacheId:ref.cacheId,...range,settings:config})})).json();active=state.id;controls();
      if(rev!==revision){await request('/arrangements/jobs/'+active,{method:'DELETE'});return;}
      while(rev===revision){say(state.message);$('progress-label').textContent=state.message+(state.progress!==null?` 生成進度 ${Math.round(state.progress)}%`:'');if(Number.isFinite(state.progress))$('progress-bar').value=state.progress;else $('progress-bar').removeAttribute('value');if(state.stage==='ready')break;if(['failed','cancelled'].includes(state.stage))throw Error(state.message);await new Promise(r=>setTimeout(r,1500));if(rev!==revision)return;state=await(await request('/arrangements/jobs/'+active)).json();}
      if(rev!==revision)return;
      const generated=await decode(await(await request('/arrangements/jobs/'+active+'/audio')).blob());if(rev!==revision)return;
      if(generated.length!==state.result.outputSamples)throw Error('新配樂長度檢查未通過。');
      result={meta:state.result,generated,jobId:active,saved:false};present();$('progress-bar').value=100;$('progress-label').textContent='已完成，可試聽及保存。';say('新配樂完成，按「原配樂／新配樂」同位置比較。');
    }catch(e){if(rev===revision){say(e.message);$('progress-label').textContent='未完成：'+e.message;}if(active)await request('/arrangements/jobs/'+active,{method:'DELETE'}).catch(()=>{});}
    finally{clearInterval(timer);timer=null;busy=false;active=null;controls();}
  });
  async function build(){
    if(!result)throw Error('請先產生或載入配樂。');const snapshot=result,version=++renderVersion,key=JSON.stringify([$('listen-mode').value,$('match').checked]);if(mixes?.key===key)return mixes;
    $('listen-status').textContent='準備試聽…';const m=snapshot.meta;
    if(!snapshot.original)snapshot.original=await slice(await decode(await(await request(`/library/${m.cacheId}/accompaniment`)).blob()),m.start,m.end);
    if($('listen-mode').value==='mix'&&!snapshot.voice)snapshot.voice=await slice(await decode(await(await request(`/library/${m.cacheId}/vocals`)).blob()),m.start,m.end);
    const audio=await arrangementMixes(snapshot.original,snapshot.generated,snapshot.voice,{solo:$('listen-mode').value==='solo',match:$('match').checked});
    if(result!==snapshot||version!==renderVersion)throw Error('試聽設定已改，請再按一次。');
    urls.forEach(URL.revokeObjectURL);urls=audio.map(b=>URL.createObjectURL(wavBlob(b)));mixes={key,urls};$('listen-status').textContent=`${$('listen-mode').value==='solo'?'只聽配樂':'原唱＋配樂'} · 同位置切換比較`;return mixes;
  }
  async function play(which){const version=++playVersion,position=player.currentTime||0;player.pause();beforePlay();try{const m=await build();if(version!==playVersion)return;player.src=m.urls[which==='original'?0:1];player.currentTime=Math.min(position,Math.max(0,result.generated.duration-.01));player.loop=$('loop').checked;await player.play();for(const id of ['original','new'])$('listen-'+id).setAttribute('aria-pressed',String(id===which));}catch(e){$('listen-status').textContent=e.message;}}
  for(const id of ['original','new'])$('listen-'+id).addEventListener('click',()=>void play(id));
  for(const id of ['listen-mode','match'])$(id).addEventListener('change',()=>{player.pause();renderVersion++;playVersion++;mixes=null;$('listen-status').textContent='試聽內容已改，請按原配樂或新配樂。';});
  $('loop').addEventListener('change',()=>{player.loop=$('loop').checked;});
  $('save').addEventListener('click',async()=>{if(!result?.jobId||saving||result.saved)return;const snapshot=result;saving=true;controls();try{const saved=await(await request('/arrangements/jobs/'+snapshot.jobId+'/save',{method:'POST'})).json();snapshot.saved=true;await refresh();$('library').value=saved.id;window.dispatchEvent(new CustomEvent('arrangement-saved',{detail:saved}));say('已保存至 '+saved._archiveRoot+'；可到 Voice Lab 選擇此配樂。');}catch(e){say('保存未完成：'+e.message);}finally{saving=false;controls();}});
  $('load').addEventListener('click',async()=>{if(busy||saving||locked)return;const meta=library.find(m=>m.id===$('library').value);if(!meta)return;const rev=++revision;busy=true;clear();controls();try{const full=await decode(await(await request(`/arrangements/library/${meta.id}/audio`)).blob()),generated=await slice(full,meta.start,meta.end);if(rev!==revision)return;result={meta,generated,saved:true};present();say('已載入保存配樂，可直接試聽。');}catch(e){say(e.message);}finally{busy=false;controls();}});
  $('download').addEventListener('click',async()=>{try{const snapshot=result,m=await build();if(result!==snapshot)return;const a=document.createElement('a');a.href=m.urls[1];a.download=`${snapshot.meta.title}_新配樂_${arrangementLabel(snapshot.meta.settings)}_${snapshot.meta.start}-${snapshot.meta.end}秒_${$('listen-mode').value==='solo'?'配樂':'原唱混音'}.wav`.replace(/[\\/:*?"<>|]/g,'_');a.click();}catch(e){say(e.message);}});
  function syncSource(){const r=source();if((r?.cacheId??null)!==sourceId){sourceId=r?.cacheId??null;void cancel();clear();$('start').value=0;$('end').value=Math.min(600,r?.duration??30);if(enabled())void refresh().catch(e=>say(e.message));}$('source').textContent=r?`來源：${r.title} · ${r.duration.toFixed(2)} 秒`:'請先載入保有分離音軌的歌曲。';controls();}
  window.addEventListener('pagehide',()=>{void cancel();clearInterval(timer);resetAudio();});syncSource();
  return {pause:()=>{player.pause();playVersion++;},sync(value){locked=value;syncSource();}};
}
