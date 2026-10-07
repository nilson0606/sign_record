import {segmentDraft,validateSegmentDraft,normalizeSegmentNames,splitSegment,moveBoundary,mergeBoundary,formatSegmentTime as fmt,parseSegmentTime,missingSegmentRanges,composeSegmentVoice} from './recording-segments.mjs';
import {remixRecording,wavBlob,delaySeconds} from './recording-process.mjs';
import {recordingSceneDefaultsVersion} from './recording-scenes.mjs';

export function createSegmentRecording(options) {
  const $=id=>document.getElementById('segment-'+id),store=options.recording.store;
  let enabled=false,draft=null,key=null,rows=[],selected=0,boundary=1,history=[],savedText=null;
  let work=false,capture=null,serial=0,loading=0,ending=Promise.resolve(),loop=false,previewEnd=null,audioEnd=null,trial=null,trialURL=null,conflict=false;
  let takeURL=null,takeRequest=0,takeLoading=false,takeSourceId=null,takeMode='mix';
  const takeModeIds=['take-mode','take-mode-player','take-mode-selected'];
  const takeModeLabel=()=>takeMode==='mix'?'人聲＋伴樂／和音':'純人聲';
  let guideMode='original';
  const guideModeIds=['guide-mode','guide-mode-player'];
  const status=text=>{$('status').textContent=$('player-status').textContent=text;},busy=()=>work||!!capture,reference=()=>options.reference(),part=()=>draft?.parts[selected];
  const storageKey=()=>`karaoke.segment-draft.v1.${key}`;
  const takeName=row=>{
    const name=row.segmentTake?.name;
    return /^第\s*\d+\s*段(?:（後段）)*$/.test(name)?draft?.parts.find(p=>p.id===row.segmentTake.partId)?.name||name:name;
  };
  function persist(undoHistory=history){
    if(!draft)return;
    if(conflict||localStorage.getItem(storageKey())!==savedText){conflict=true;throw Error('另一分頁已更新這份草稿，請重新整理頁面後繼續；錄音仍保留。');}
    validateSegmentDraft(draft);const text=JSON.stringify({...draft,undoHistory});localStorage.setItem(storageKey(),text);savedText=text;
  }
  function invalidate(){
    clearTakePreview();
    audioEnd=null;
    $('audio').pause();$('audio').removeAttribute('src');$('audio').load();$('audio').hidden=true;
    if(trialURL)URL.revokeObjectURL(trialURL);trialURL=null;trial=null;$('export').disabled=$('download').disabled=true;
  }
  function clearTakePreview(){
    takeRequest++;takeLoading=false;takeSourceId=null;
    const audio=$('take-audio');audio.pause();audio.removeAttribute('src');audio.load();audio.hidden=true;
    if(takeURL)URL.revokeObjectURL(takeURL);takeURL=null;
  }
  function showPlayer(){
    const target=document.getElementById('player-section');
    target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:'instant'});
  }
  async function listenTake(){
    if(busy()||takeLoading||!enabled)return;
    const row=validRows().find(r=>r.id===part()?.takeId&&r.segmentTake);
    if(!row)throw Error('本段尚未選用錄音，請先錄這一段，或在右側挑選演唱版本。');
    const mode=takeMode,delay=Number($('delay').value),ref=structuredClone(row.post.reference);delaySeconds(delay);
    if(mode==='mix'&&!reference()?.hasPreview)throw Error('加入伴樂需要已保存的伴奏音軌，請先補建音軌，或改選「純人聲」。');
    clearTakePreview();loop=false;previewEnd=null;options.player()?.pauseVideo?.();options.pauseOther();$('audio').pause();
    const request=takeRequest,cancelled=()=>request!==takeRequest||!enabled||busy();takeSourceId=row.id;takeLoading=true;render();showPlayer();status(`正在準備本段試聽：${takeModeLabel()}…`);
    let decoder;
    try{
      const blob=await store.blob(row,'voice');
      if(cancelled())return;
      if(!blob.size)throw Error('無法讀取本段人聲錄音，請確認歌曲庫。');
      decoder=new AudioContext({sampleRate:48000,sinkId:{type:'none'}});
      const raw=await decoder.decodeAudioData(await blob.arrayBuffer()),tracks=[];
      if(cancelled())return;
      if(mode==='mix'){
        if(!row.post.segments?.length)throw Error('此錄音缺少歌曲時間資訊，請改選「純人聲」。');
        const requiredEnd=Math.max(...row.post.segments.map(s=>s.songTime+s.duration));
        for(const stem of ['accompaniment',...(ref.vocalMode==='lead'?['backing']:[])]){
          const bytes=await options.loadStem(ref,stem);if(cancelled())return;
          const buffer=await decoder.decodeAudioData(bytes);if(cancelled())return;
          if(buffer.duration<requiredEnd-.15)throw Error('伴樂長度不足，請補建完整音軌，或改選「純人聲」。');
          tracks.push(buffer);
        }
      }
      // Keep this take's recording-to-song map so accompaniment starts at the
      // recorded section, including any pauses; correction moves only the voice.
      const meta={...row,mode,seconds:raw.duration,sourceSeconds:raw.duration,fixedMixGains:{version:1,voice:1,backing:1},postEdit:{version:1,start:0,end:raw.duration,fadeIn:0,fadeOut:0}};
      const preview=wavBlob(await remixRecording(raw,tracks,meta,delay));if(cancelled())return;
      takeURL=URL.createObjectURL(preview);$('take-audio').src=takeURL;$('take-audio').hidden=false;
      await $('take-audio').play();
      if(request===takeRequest)status(`正在試聽本段錄音：${takeModeLabel()} · 歌聲校正 ${delay} ms，含起唱與尾音餘量。`);
    }catch(e){if(request===takeRequest){clearTakePreview();throw e;}}
    finally{if(decoder)await decoder.close().catch(()=>{});if(request===takeRequest)takeLoading=false;render();}
  }
  async function deleteTake(){
    if(busy()||conflict||!enabled)return;
    const row=validRows().find(r=>r.id===part()?.takeId&&r.segmentTake);
    if(!row)return;
    const uses=draft.parts.filter(p=>p.takeId===row.id).length;
    if(!confirm(`刪除「${takeName(row)} · ${new Date(row.created).toLocaleString()} · ${row.seconds.toFixed(1)} 秒」這一版錄音？\n目前有 ${uses} 段選用此版本，刪除後需重新挑選。\n此版人聲及錄音檔會刪除，無法復原；其他版本與已另存成品保留。`))return;
    persist();work=true;invalidate();loop=false;previewEnd=null;options.player()?.pauseVideo?.();options.pauseOther();render();options.changed();
    let deleted=false;
    try{
      await store.delete(row.id);deleted=true;rows=rows.filter(r=>r.id!==row.id);
      // Undo can restore boundaries, but must never restore a deleted source choice.
      for(const plan of [draft,...history]){if(plan.baseId===row.id)plan.baseId=null;for(const p of plan.parts)if(p.takeId===row.id)p.takeId=null;}
      persist();await options.recording.refresh();status('已刪除此版錄音。請重新挑選本段版本或重新錄製；其他錄音與已另存成品保留。');
    }catch(e){throw Error((deleted?'此版錄音已刪除，但草稿或列表更新失敗：':'未能完成刪除：')+e.message);}
    finally{work=false;render();options.changed();}
  }
  function change(fn){
    if(busy()||!draft)return;const old=structuredClone(draft);
    try{fn();if(JSON.stringify(draft)===JSON.stringify(old)){render();return;}const nextHistory=[...history,old].slice(-40);persist(nextHistory);history=nextHistory;invalidate();render();status('分界與版本選擇已保存。原始錄音保留。');}
    catch(e){draft=old;render();status(e.message);}
  }
  const currentTime=()=>Number(options.player()?.getCurrentTime?.())||0;
  const validRows=()=>rows.filter(r=>r.complete&&r.rawBytes&&r.post?.reference?.cacheId===key&&Math.abs((r.post.reference.duration||0)-(draft?.duration||0))<.15);
  const option=(select,value,text)=>select.append(new Option(text,value));
  function render(){
    const ref=reference(),locked=busy()||conflict;
    $('open').disabled=!ref||busy();$('open').hidden=enabled;$('whole').hidden=!enabled;$('whole').disabled=busy();$('tools').hidden=!enabled;
    $('mode-label').textContent=enabled?'分段模式 · 不計整首分數':'整首評分模式';
    const playerSection=document.getElementById('player-section');
    playerSection.classList.toggle('segment-active',enabled);playerSection.parentElement.classList.toggle('segment-layout',enabled);$('side').hidden=$('player-tools').hidden=!enabled;
    for(const panel of [$('tools'),$('side')])for(const node of panel.querySelectorAll('button,input,select'))node.disabled=locked||!draft;
    $('stop').disabled=$('stop-player').disabled=!capture;$('download').disabled=locked||!trial;$('export').disabled=locked||!trial||!!trial.saved;
    $('export').textContent=trial?.saved?'已存到錄音後處理':'存到錄音後處理';
    if(draft){selected=Math.max(0,Math.min(selected,draft.parts.length-1));boundary=Math.max(1,Math.min(boundary,draft.parts.length-1));}
    if(takeSourceId&&takeSourceId!==part()?.takeId)clearTakePreview();
    const take=validRows().find(r=>r.id===part()?.takeId&&r.segmentTake);
    for(const id of ['listen','listen-player','listen-selected'])$(id).disabled=locked||takeLoading||!take;
    for(const id of ['delete','delete-player','delete-selected'])$(id).disabled=locked||!take;
    for(const id of takeModeIds){$(id).value=takeMode;$(id).disabled=locked||!draft;}
    for(const id of guideModeIds){$(id).value=guideMode;$(id).disabled=locked||!draft;}
    $('take-info').textContent=take?`本段錄音：${takeName(take)} · ${new Date(take.created).toLocaleTimeString()} · ${takeModeLabel()} · 歌聲校正 ${$('delay').value} ms（含起唱與尾音餘量）`:'本段尚未選用錄音；錄完保存後即可試聽，也可在右側挑選已錄版本。';
    if(!draft)return;
    const p=part();$('song').textContent=ref?.title||'';$('seek').max=draft.duration;
    $('selected-summary').textContent=`${p.name} · ${fmt(p.start)}–${fmt(p.end)}`;
    $('part').replaceChildren();draft.parts.forEach((p,i)=>option($('part'),String(i),`${p.name} · ${fmt(p.start)}–${fmt(p.end)}`));$('part').value=String(selected);
    $('name').value=p.name;$('boundary').replaceChildren();draft.parts.slice(1).forEach((p,i)=>option($('boundary'),String(i+1),`${i+1}｜${fmt(p.start)}`));$('boundary').value=String(boundary);
    const hasBoundary=draft.parts.length>1;
    for(const id of ['boundary','boundary-time','step','earlier','later','boundary-play','merge','merge-all'])$(id).disabled=locked||!hasBoundary;
    $('boundary-time').value=hasBoundary?fmt(draft.parts[boundary].start):'00:00.000';$('undo').disabled=locked||(!history.length&&!hasBoundary);
    $('timeline').replaceChildren();
    draft.parts.forEach((p,i)=>{
      const b=document.createElement('button');b.type='button';b.className='segment-block'+(i===selected?' selected':'');b.style.width=(p.end-p.start)/draft.duration*100+'%';b.textContent=String(i+1);b.title=`${p.name} ${fmt(p.start)}–${fmt(p.end)}`;b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',String(i===selected));b.disabled=locked;b.onclick=()=>{selected=i;render();};$('timeline').append(b);
      if(i){const marker=document.createElement('button');marker.type='button';marker.className='segment-marker';marker.style.left=p.start/draft.duration*100+'%';marker.setAttribute('aria-label',`拖曳分界 ${i}，${fmt(p.start)}`);marker.disabled=locked;marker.textContent='│';marker.onclick=()=>{boundary=i;render();};
        marker.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();boundary=i;change(()=>moveBoundary(draft,i,p.start+(e.key==='ArrowRight'?1:-1)*Number($('step').value)));}};
        marker.onpointerdown=e=>{if(locked)return;e.preventDefault();marker.setPointerCapture(e.pointerId);const rect=$('timeline').getBoundingClientRect();let t=p.start;marker.onpointermove=ev=>{t=Math.max(draft.parts[i-1].start+.1,Math.min(p.end-.1,(ev.clientX-rect.left)/rect.width*draft.duration));marker.style.left=t/draft.duration*100+'%';$('boundary-time').value=fmt(t);};marker.onpointerup=()=>{marker.onpointermove=null;boundary=i;change(()=>moveBoundary(draft,i,t));};marker.onpointercancel=()=>render();};$('timeline').append(marker);}
    });
    const eligible=validRows();$('base').replaceChildren();option($('base'),'','從空白開始分段錄');
    eligible.filter(r=>!r.segmentTake&&r.post.segments?.some(s=>s.songTime<.2)&&r.seconds>=draft.duration-.5).forEach(r=>option($('base'),r.id,`${r.title} · ${new Date(r.created).toLocaleString()}`));
    if(draft.baseId&&![...$('base').options].some(o=>o.value===draft.baseId))option($('base'),draft.baseId,'底稿未找到（請重新讀取／確認歌曲庫）');$('base').value=draft.baseId||'';
    $('take').replaceChildren();option($('take'),'','沿用底稿／未錄處留空');
    const partTakes=eligible.filter(r=>r.segmentTake?.partId===p.id);
    partTakes.forEach(r=>option($('take'),r.id,`${takeName(r)} · ${new Date(r.created).toLocaleString()} · ${r.seconds.toFixed(1)} 秒`));
    // Preserve an existing choice inherited by splitting or an older draft, without offering other sections' takes.
    const inherited=p.takeId&&!partTakes.some(r=>r.id===p.takeId)?eligible.find(r=>r.id===p.takeId):null;
    if(p.takeId&&![...$('take').options].some(o=>o.value===p.takeId))option($('take'),p.takeId,inherited?`沿用已選錄音 · ${takeName(inherited)||inherited.title} · ${new Date(inherited.created).toLocaleString()}`:'已選版本未找到');$('take').value=p.takeId||'';
    $('take-count').textContent=`本段共有 ${partTakes.length} 個錄音版本，全部列出；可重錄多次，沒有三次上限。${inherited?'另保留草稿原先選用的錄音，可改選本段版本。':''}`;
    const missing=missingSegmentRanges(draft,eligible,Number($('delay').value)||0);$('coverage').textContent=missing.length?`待補錄或涵蓋不足：${missing.join('、')}。可改選版本／底稿，或明確勾選保留靜音。`:'所有段落都有可用人聲；可試合完整版本。';
    $('loop').setAttribute('aria-pressed',String(loop));$('loop').textContent=loop?'停止循環練唱':'循環練唱本段';$('record').disabled=locked||!ref||(guideMode==='backing'&&!ref.hasPreview);
  }
  async function refresh(){const request=++loading,currentKey=key,list=await store.list();if(request!==loading||currentKey!==key)return;rows=list;render();}
  function referenceChanged(){
    const ref=reference(),next=ref?.cacheId||null;if(next===key){render();return;}
    serial++;loading++;enabled=false;loop=false;previewEnd=null;invalidate();key=next;draft=null;rows=[];history=[];selected=0;boundary=1;conflict=false;
    if(next){try{
      savedText=localStorage.getItem(storageKey());
      const {undoHistory=[],...stored}=savedText?JSON.parse(savedText):segmentDraft(ref);
      draft=normalizeSegmentNames(validateSegmentDraft(stored));
      if(draft.key!==next||Math.abs(draft.duration-ref.duration)>.01)throw Error('歌曲範圍與草稿不同，請載入原先版本。');
      // Old drafts have no history. Invalid history must not prevent loading the saved draft.
      try{history=Array.isArray(undoHistory)?undoHistory.slice(-40).map(item=>{
        const {undoHistory:ignored,...snapshot}=item;validateSegmentDraft(snapshot);
        if(snapshot.key!==next||Math.abs(snapshot.duration-draft.duration)>.01)throw Error('復原紀錄歌曲不同。');
        return normalizeSegmentNames(snapshot);
      }):[];}catch{history=[];}
      status(savedText?'已讀取分段草稿。':'可開啟分段模式，邊播放邊加入分界。');refresh().catch(e=>status(e.message));
    }catch(e){draft=null;status('無法開啟草稿：'+e.message);}}
    else status('載入歌曲後，可開啟分段模式。');render();
  }
  function enter(){
    if(busy()||!draft)return;if(!options.canEnter()){status('請先結束並結算目前的整首演唱，再使用分段模式。');return;}
    options.player()?.pauseVideo?.();options.pauseOther();enabled=true;render();options.changed();status('分段模式已開啟。播放中按「在此分段」，稍後可拖曳或精確調整時間。');
  }
  function leave(){if(busy())return false;clearTakePreview();enabled=false;loop=false;previewEnd=null;$('audio').pause();options.player()?.pauseVideo?.();render();options.changed();return true;}
  async function seek(time,cancelled=()=>false){
    const p=options.player();if(!p?.seekTo)throw Error('播放器尚未就緒。');p.pauseVideo();const deadline=performance.now()+10000;let requested=false;
    while(performance.now()<deadline){if(cancelled())throw Error('分段操作已取消。');if(!requested&&[0,2,5,-1].includes(p.getPlayerState())){p.seekTo(time,true);requested=true;}if(requested&&Math.abs(p.getCurrentTime()-time)<.15)return;await new Promise(r=>setTimeout(r,50));}
    throw Error('播放器尚未確認跳到指定位置，請重試。');
  }
  function stopMonitor(c){for(const n of c?.nodes||[]){try{n.stop();}catch{}n.disconnect();}if(c)c.nodes=[];}
  function syncMonitor(c,time){
    if(!c?.monitor||!c.armed)return;if(c.nodes.length&&Math.abs(c.anchorTime+c.monitor.currentTime-c.anchorClock-time)<.12)return;
    stopMonitor(c);c.anchorTime=time;c.anchorClock=c.monitor.currentTime;
    for(const buffer of c.buffers){if(time>=buffer.duration)continue;const n=c.monitor.createBufferSource();n.buffer=buffer;n.connect(c.monitor.destination);n.start(c.anchorClock,Math.max(0,time));c.nodes.push(n);}
  }
  async function stop(error=null){
    serial++;loop=false;previewEnd=null;const c=capture;if(!c)return ending;
    capture=null;c.armed=false;work=true;stopMonitor(c);options.player()?.pauseVideo?.();
    const stopped=options.recording.stop(error); // Drain PCM before microphone/context is released.
    ending=(async()=>{
      try{const row=await stopped;if(row?.segmentTake?.captureId===c.captureId&&draft?.key===c.key){rows=[row,...rows.filter(r=>r.id!==row.id)];const p=draft.parts.find(p=>p.id===c.partId);if(p)p.takeId=row.id;persist();invalidate();status('本段已保存，可按「試聽本段錄音」立即聽這一版，也可切換演唱版本；原先錄音保留。');}else status(error?'本段收音中斷，請查看錄音狀態中的保留片段。':'沒有完成新的錄音；既有版本保留。');}
      catch(e){status('錄音已停止；草稿／保存狀態請確認：'+e.message);}
      finally{if(c.monitor)await c.monitor.close().catch(()=>{});if(c.wasMuted)c.player.mute?.();else c.player.unMute?.();work=false;render();options.changed();}
    })();return ending;
  }
  async function record(){
    if(busy()||!enabled||!draft)return;if(!options.canEnter())throw Error('請先結束整首演唱。');
    persist();options.pauseOther();invalidate();loop=false;previewEnd=null;
    const ref=structuredClone(reference()),p=structuredClone(part()),request=++serial,player=options.player();
    const c={key,partId:p.id,captureId:crypto.randomUUID(),player,guideMode,wasMuted:!!player.isMuted?.(),nodes:[],buffers:[],armed:false,monitor:null,start:Math.max(0,p.start-Number($('preroll').value)),end:Math.min(draft.duration,p.end+Number($('tail').value))};capture=c;render();options.changed();const cancelled=()=>request!==serial||capture!==c;
    showPlayer();
    try{
      player.pauseVideo();status(`正在準備本段${c.guideMode==='original'?'原唱＋伴樂':'伴樂'}帶唱與收音…`);
      if(c.guideMode==='backing'){
        if(!ref.hasPreview)throw Error('只有伴樂帶唱需要已保存的伴奏音軌，請先補建音軌。');
        c.monitor=new AudioContext();await c.monitor.resume();
        const stems=['accompaniment',...(ref.vocalMode==='lead'?['backing']:[])];
        for(const stem of stems){const bytes=await options.loadStem(ref,stem);if(cancelled())return;c.buffers.push(await c.monitor.decodeAudioData(bytes));if(cancelled())return;}
        if(c.buffers.some(b=>b.duration<draft.duration-.15))throw Error('伴樂長度不足，請補建完整試聽音軌。');
      }
      if(!options.micReady())await options.startMic();if(cancelled())return;if(!options.micReady())throw Error('麥克風未就緒，請查看收音設定。');
      await options.recording.prepare(ref,()=>{}, {}, {mode:'voice',delayMs:0,segmentTake:{version:1,key,partId:p.id,captureId:c.captureId,name:p.name,start:p.start,end:p.end,guideMode:c.guideMode}});
      if(cancelled())return;await seek(c.start,cancelled);if(cancelled())return;
      player.setPlaybackRate?.(1);if(c.guideMode==='backing')player.mute?.();else player.unMute?.();c.armed=true;player.playVideo();if(player.getPlayerState()===1)playerState(1);
      status(`準備起唱：${p.name}，${fmt(p.start)}–${fmt(p.end)} · ${c.guideMode==='original'?'原唱＋伴樂':'只有伴樂／和音'}帶唱；到尾音餘量後自動保存。`);
    }catch(e){if(!cancelled()){await stop(e);status('無法完成本段錄音：'+e.message);}}
  }
  function playerState(state){if(state===1){clearTakePreview();$('audio').pause();options.recording.clearPreview();render();}const c=capture;if(!c?.armed)return;if(state===0){stop().catch(e=>status(e.message));return;}options.recording.playerState(state,currentTime());if(state===1)syncMonitor(c,currentTime());else stopMonitor(c);}
  async function compose(join=false){
    if(busy()||!draft||!enabled)return;const delay=Number($('delay').value);delaySeconds(delay);persist();
    const ref=structuredClone(reference()),plan=structuredClone(draft),mode=$('output').value,request=++serial;
    work=true;loop=false;previewEnd=null;options.player()?.pauseVideo?.();options.pauseOther();invalidate();render();options.changed();
    const decoder=new AudioContext({sampleRate:48000,sinkId:{type:'none'}});
    try{
      status('正在讀取各段乾淨人聲並試合…');await refresh();const missing=missingSegmentRanges(plan,validRows(),delay);
      if(missing.length&&!$('allow-gaps').checked)throw Error('尚未完整涵蓋：'+missing.join('、')+'。請補唱，或勾選「允許未錄範圍保留靜音」。');
      const sources=new Map();
      for(const id of new Set(plan.parts.map(p=>p.takeId||plan.baseId).filter(Boolean))){const meta=validRows().find(r=>r.id===id);if(!meta){if($('allow-gaps').checked)continue;throw Error('找不到採用版本，請確認歌曲庫。');}const blob=await store.blob(meta,'voice');if(!blob.size)throw Error('乾淨人聲音檔無法讀取。');sources.set(id,{meta,audio:await decoder.decodeAudioData(await blob.arrayBuffer())});}
      if(!sources.size)throw Error('至少需錄好一段或選擇整首底稿。');
      const raw=composeSegmentVoice(plan,sources,{sampleRate:decoder.sampleRate,delayMs:delay}),voice=wavBlob(raw),tracks=[],stems=[];
      if(mode==='mix'){if(!ref.hasPreview)throw Error('加入伴樂需要已保存的伴奏音軌。');stems.push('accompaniment');if(ref.vocalMode==='lead')stems.push('backing');for(const stem of stems){const b=await decoder.decodeAudioData(await options.loadStem(ref,stem));if(b.duration<plan.duration-.15)throw Error('伴樂長度不足，請補建完整音軌。');tracks.push(b);}}
      const meta={id:crypto.randomUUID(),title:ref.title+' · 分段合成',videoId:ref.videoId,created:Date.now(),mime:'audio/wav',rawMime:'audio/wav',rawBytes:voice.size,mode,stems,seconds:plan.duration,sourceSeconds:plan.duration,complete:true,appliedDelayMs:delay,recordingDelayMs:delay,postDefaults:recordingSceneDefaultsVersion,fixedMixGains:{version:1,voice:1,backing:1},postEdit:{version:1,start:0,end:plan.duration,fadeIn:0,fadeOut:0},segmentComposition:{version:1,draft:plan,delayMs:delay,crossfadeSeconds:.012},post:{version:1,reference:ref,scoring:{},offsetMs:delay,segments:[{offset:0,songTime:0,duration:plan.duration}],samples:[]}};
      const mix=wavBlob(await remixRecording(raw,tracks,meta,delay,{edit:meta.postEdit}));meta.bytes=mix.size;if(request!==serial||key!==plan.key)return;
      trial={meta,mix,voice};trialURL=URL.createObjectURL(mix);$('audio').src=trialURL;$('audio').hidden=false;$('audio').load();
      if(join){$('audio').currentTime=Math.max(0,part().start-3);audioEnd=Math.min(plan.duration,part().end+3);await $('audio').play();}
      status(`已試合完整 ${fmt(plan.duration)} · ${mode==='mix'?'人聲＋伴樂／和音':'純人聲'} · 歌聲校正 ${delay} ms。目前為暫存試聽；滿意後按「存到錄音後處理」。`);
    }finally{await decoder.close().catch(()=>{});work=false;render();options.changed();}
  }
  function action(id,fn){$(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>status(e.message)));}
  action('open',enter);action('whole',leave);action('split',()=>change(()=>{selected=splitSegment(draft,currentTime());boundary=selected;}));
  action('undo',()=>{
    if(busy()||conflict||!draft||(!history.length&&draft.parts.length===1))return;
    const old=draft,hasHistory=history.length>0,nextHistory=history.slice(0,-1);
    try{
      draft=structuredClone(hasHistory?history.at(-1):draft);
      // Older saved drafts may have boundaries but no undo history. Remove the
      // last remaining boundary without adding an undo entry that would toggle it back.
      const different=!hasHistory&&draft.parts.at(-2).takeId!==draft.parts.at(-1).takeId;
      if(!hasHistory)mergeBoundary(draft,draft.parts.length-1);
      persist(nextHistory);history=nextHistory;invalidate();render();
      status(hasHistory?'已復原上一次分界／版本調整。':`已移除最後一道分界，剩 ${draft.parts.length} 段。原始錄音保留。${different?'合併的兩段使用不同版本，請重新挑選演唱版本。':''}`);
    }catch(e){draft=old;render();throw e;}
  });
  action('merge-all',()=>change(()=>{while(draft.parts.length>1)mergeBoundary(draft,1);selected=0;}));
  action('save',()=>{persist();status('草稿已保存於目前瀏覽器；各次演唱錄音沿用歌曲庫保存。');});action('refresh',refresh);
  action('earlier',()=>change(()=>moveBoundary(draft,boundary,draft.parts[boundary].start-Number($('step').value))));action('later',()=>change(()=>moveBoundary(draft,boundary,draft.parts[boundary].start+Number($('step').value))));
  action('merge',()=>{const different=draft.parts[boundary-1].takeId!==draft.parts[boundary].takeId;change(()=>mergeBoundary(draft,boundary));if(different)status('已移除分界。兩段原先採用的版本不同，合併後請重新挑選版本；原始錄音都保留。');});
  action('play',()=>{loop=false;previewEnd=null;$('audio').pause();options.pauseOther();const p=options.player();if(p.getPlayerState()===1)p.pauseVideo();else p.playVideo();render();});
  action('boundary-play',async()=>{loop=false;const t=draft.parts[boundary].start;previewEnd=Math.min(draft.duration,t+3);await seek(Math.max(0,t-3));options.player().playVideo();});
  action('loop',async()=>{loop=!loop;previewEnd=null;render();if(loop){$('audio').pause();await seek(part().start);options.player().playVideo();}else options.player()?.pauseVideo?.();});
  action('record',record);action('stop',()=>stop());action('compose',()=>compose());action('join',()=>compose(true));
  action('stop-player',()=>stop());
  for(const id of ['listen','listen-player','listen-selected'])action(id,listenTake);
  for(const id of ['delete','delete-player','delete-selected'])action(id,deleteTake);
  for(const id of takeModeIds)$(id).onchange=()=>{takeMode=$(id).value==='voice'?'voice':'mix';clearTakePreview();render();status(`已切換為${takeModeLabel()}，請按「試聽本段錄音」。`);};
  for(const id of guideModeIds)$(id).onchange=()=>{guideMode=$(id).value==='backing'?'backing':'original';render();status(guideMode==='backing'?'下次分段錄音只用伴樂／和音帶唱。':'下次分段錄音播放原唱＋伴樂帶唱。');};
  action('export',async()=>{if(!trial||trial.saved||busy())return;work=true;render();options.changed();try{await store.saveRemix(trial.meta,trial.mix,trial.voice);trial.saved=true;await options.recording.refresh(trial.meta.id);status('已存到錄音後處理，可繼續調整與 A/B 比較。分段素材仍保留在分段區。');}finally{work=false;render();options.changed();}});
  action('download',()=>{if(!trial)return;const a=document.createElement('a');a.href=trialURL;a.download=trial.meta.title.replace(/[\\/:*?"<>|]/g,'_')+`-${trial.meta.mode}-${trial.meta.appliedDelayMs}ms.wav`;a.click();});
  $('part').onchange=()=>{selected=Number($('part').value);loop=false;render();};$('boundary').onchange=()=>{boundary=Number($('boundary').value);render();};
  $('name').onchange=()=>change(()=>{const name=$('name').value.trim();part().autoName=!name;part().name=name||`第 ${selected+1} 段`;});$('boundary-time').onchange=()=>change(()=>moveBoundary(draft,boundary,parseSegmentTime($('boundary-time').value)));
  $('base').onchange=()=>change(()=>{draft.baseId=$('base').value||null;});$('take').onchange=()=>change(()=>{part().takeId=$('take').value||null;});
  $('seek').oninput=()=>{$('position').textContent=fmt(Number($('seek').value));};$('seek').onchange=()=>{options.player()?.seekTo?.(Number($('seek').value),true);};
  for(const id of ['delay','output','allow-gaps'])$(id).onchange=()=>{invalidate();render();status('試合設定已變更，請重新試合完整一版。');};
  $('audio').onplay=()=>{loop=false;previewEnd=null;options.player()?.pauseVideo?.();options.pauseOther();};$('audio').onended=()=>{audioEnd=null;};$('audio').ontimeupdate=()=>{if(audioEnd!==null&&$('audio').currentTime>=audioEnd){$('audio').pause();audioEnd=null;}};
  $('take-audio').onplay=()=>{
    if(busy()||!enabled){clearTakePreview();return;}
    loop=false;previewEnd=null;options.player()?.pauseVideo?.();options.pauseOther();
    for(const audio of document.querySelectorAll('audio'))if(audio!==$('take-audio'))audio.pause();
  };
  document.addEventListener('play',e=>{if(e.target instanceof HTMLMediaElement&&e.target!==$('take-audio')){clearTakePreview();render();}},true);
  window.addEventListener('storage',e=>{if(key&&e.key===storageKey()&&e.newValue!==savedText){conflict=true;render();status('另一分頁已變更草稿，請重新整理後再編輯；現有錄音保留。');}});
  window.addEventListener('segment-capture-stopped',e=>{if(capture?.captureId===e.detail?.captureId)stop().catch(error=>status(error.message));});
  const timer=setInterval(()=>{
    if(!enabled||!draft)return;const t=currentTime(),player=options.player();if(document.activeElement!==$('seek'))$('seek').value=t;$('position').textContent=fmt(t);
    if(capture?.armed&&player?.getPlayerState?.()===1){
      if(t>=capture.end||t<capture.start-.2){stop().catch(e=>status(e.message));return;}
      if(player.getPlaybackRate?.()!==undefined&&player.getPlaybackRate()!==1){stop(Error('分段錄音需使用原速播放。')).catch(e=>status(e.message));return;}
      syncMonitor(capture,t);const p=part();status(t<p.start?`準備起唱 · 還有 ${(p.start-t).toFixed(1)} 秒`:`● ${t>=p.end?'保留尾音':'錄製中'} · ${p.name} · ${fmt(t)}`);
    }else if(!busy()&&player?.getPlayerState?.()===1){if(loop&&t>=part().end)player.seekTo(part().start,true);else if(previewEnd!==null&&t>=previewEnd){player.pauseVideo();previewEnd=null;}}
  },80);
  window.addEventListener('pagehide',()=>{clearInterval(timer);stop();invalidate();});render();
  return {enabled:()=>enabled,busy,enter,leave,referenceChanged,playerState,stop};
}
