// Temporary A/B renders share a source-time interval. They never write to the archive.
import {reverbSpaces} from './recording-soften.mjs';
const $=id=>document.getElementById('post-audition-'+id);
// Compare displayed settings, including inactive effect parameters, without touching audio.
export function settingDifferences(a,b,{includeBacking=true}={}){
  const rows=[],add=(label,left,right,format=String)=>{if(left!==right)rows.push({label,a:left==null?'未設定':format(left),b:right==null?'未設定':format(right)});};
  const unit=suffix=>value=>`${value}${suffix}`,signed=suffix=>value=>`${value>0?'+':''}${value}${suffix}`;
  const strength=value=>({off:'關閉',light:'輕度',medium:'中度',strong:'強烈'})[value]??value;
  add('歌唱者音量',a.volume?.voice??100,b.volume?.voice??100,unit('%'));
  if(includeBacking)add('配樂／和音音量',a.volume?.backing??100,b.volume?.backing??100,unit('%'));
  add('歌聲延時校正',a.delayMs??0,b.delayMs??0,signed(' ms'));
  add('歌聲柔化',a.softening??'off',b.softening??'off',strength);
  const x=a.effects??{},y=b.effects??{};
  for(const [key,label] of [['low','低頻'],['mid','中頻'],['high','高頻']])add(`EQ ${label}`,x.eq?.[key]??0,y.eq?.[key]??0,signed(' dB'));
  add('動態壓縮',x.compression??'off',y.compression??'off',strength);
  add('殘響音量',x.reverb??0,y.reverb??0,unit('%'));
  add('殘響空間',x.reverbOptions?.space??'classic',y.reverbOptions?.space??'classic',value=>reverbSpaces[value]??value);
  for(const [key,label,fallback,suffix] of [['decay','尾音長度',.8,' 秒'],['preDelayMs','預延遲',15,' ms']])add(label,x.reverbOptions?.[key]??fallback,y.reverbOptions?.[key]??fallback,unit(suffix));
  add('殘響明亮度',x.reverbTone?.brightness??0,y.reverbTone?.brightness??0,signed(''));
  add('殘響立體寬度',x.reverbTone?.width??100,y.reverbTone?.width??100,unit('%'));
  for(const [key,label,fallback,suffix] of [['amount','回聲音量',0,'%'],['timeMs','回聲重複間隔',300,' ms'],['repeats','回聲重複次數',3,' 次'],['feedback','回聲每次保留音量',40,'%']])add(label,x.echo?.[key]??fallback,y.echo?.[key]??fallback,unit(suffix));
  add('回聲位置',x.echo?.pingPong??false,y.echo?.pingPong??false,value=>value?'左右交替':'中央');
  for(const [key,label,fields] of [
    ['regions','局部音量',[['start','開始',' 秒'],['end','結束',' 秒'],['volume','音量','%']]],
    ['effectRegions','局部效果',[['start','開始',' 秒'],['end','結束',' 秒'],['reverb','殘響','%'],['decay','尾音',' 秒'],['echo','回聲','%']]]
  ]){
    const left=[...(x[key]??[])].sort((p,q)=>p.start-q.start),right=[...(y[key]??[])].sort((p,q)=>p.start-q.start);
    for(let i=0;i<Math.max(left.length,right.length);i++)for(const [field,title,suffix] of fields)add(`${label} 第 ${i+1} 段 · ${title}`,left[i]?.[field],right[i]?.[field],unit(suffix));
  }
  return rows;
}
export function comparisonLevels(buffers,matched=true){
  const rms=buffers.map(b=>{let sum=0;for(let c=0;c<b.numberOfChannels;c++)for(const x of b.getChannelData(c))sum+=x*x;return Math.sqrt(sum/(b.length*b.numberOfChannels));});
  const audible=rms.filter(x=>x>1e-6),target=audible.length?Math.min(...audible):0;
  return rms.map(x=>matched&&x>1e-6&&target?Math.min(1,target/x):1);
}
export function createRecordingAudition({read,apply,render,run,beforePlay,onEditor=()=>{},getPosition=()=>0}){
  let row=null,slots={},initial={},cache={},editor='b',busy=false,context=null,active=null,origin=0,source=null,gain=null,timer=null,generation=0,loading=null;
  const say=text=>$('status').textContent=text;
  function showTab(name){editor=name;for(const key of ['a','b']){const current=key===name;$(key+'-tab').setAttribute('aria-selected',String(current));$(key+'-tab').tabIndex=current?0:-1;$(key+'-pane').hidden=!current;$(key+'-edit').setAttribute('aria-pressed',String(current));}$('reset').textContent=`還原 ${name.toUpperCase()} 初始設定`;onEditor(name);refreshDifferences();}
  function refreshDifferences(){
    $('differences-body').replaceChildren();$('differences-table').hidden=true;
    if(!slots.a||!slots.b){$('differences-count').textContent='選取錄音後顯示差異。';return;}
    try{
      const drafts={...slots,[editor]:read()},rows=settingDifferences(drafts.a,drafts.b,{includeBacking:row.mode!=='voice'});
      $('differences-count').textContent=rows.length?`${rows.length} 項不同`:'目前 A／B 設定相同';
      for(const difference of rows){const tr=document.createElement('tr');for(const key of ['label','a','b']){const cell=document.createElement(key==='label'?'th':'td');if(key==='label')cell.scope='row';else cell.className='audition-slot-'+key;cell.textContent=difference[key];tr.append(cell);}$('differences-body').append(tr);}
      $('differences-table').hidden=!rows.length;
    }catch(error){$('differences-count').textContent=`${editor.toUpperCase()} 組欄位尚未完成：${error.message} 補齊後會繼續顯示差異。`;}
  }
  // Read before switching so even dynamically added regions belong to their own draft.
  // Invalid fields must stay visible instead of being silently lost on a tab change.
  function remember(){if(!slots[editor])return;const next=structuredClone(read());if(JSON.stringify(next)!==JSON.stringify(slots[editor])){if(active)stop();delete cache[editor];slots[editor]=next;describe(editor);}}
  function selectTab(name){remember();if(slots[name])apply(structuredClone(slots[name]));showTab(name);}
  function switchEditor(name){try{selectTab(name);say(`正在調整 ${name.toUpperCase()}，兩組設定各自保留；按試聽才會播放新效果。`);return true;}catch(e){say(e.message);return false;}}
  function stop(){generation++;if(source){try{source.stop();}catch{}source.disconnect();source=null;}gain?.disconnect();gain=null;active=null;clearInterval(timer);timer=null;$('position').textContent='';if(context){void context.close();context=null;}controls(busy);}
  function invalidate(){stop();cache={};}
  function controls(value=busy){busy=value;const enabled=!!(row?.complete&&row.rawBytes&&row.post?.segments?.length);$('fields').disabled=busy||!enabled;
    for(const name of ['a','b'])$(name+'-edit').disabled=busy||!enabled;
    $('reset').disabled=busy||!enabled;
    for(const name of ['a','b'])for(const action of ['play','apply'])$(name+'-'+action).disabled=busy||!enabled||!slots[name];
    for(const name of ['a','b']){const button=$(name+'-play');button.setAttribute('aria-pressed',String(active===name));button.textContent=loading===name?`準備 ${name.toUpperCase()}…`:active===name?`● 正在聽 ${name.toUpperCase()}`:`▶ 試聽 ${name.toUpperCase()}`;}
    $('stop').disabled=!active&&!busy;$('mode').disabled=busy||!enabled||row?.mode==='voice';
  }
  function describe(name){const s=slots[name];$(name+'-info').textContent=s?`殘響 ${s.effects.reverb}% · 明亮 ${s.effects.reverbTone?.brightness??0} · 寬度 ${s.effects.reverbTone?.width??100}% · 回聲 ${s.effects.echo?.amount??0}% · ${s.effects.effectRegions?.length??0} 段局部效果 · 校正 ${s.delayMs} ms`:'尚未記住設定';}
  function reset(value){invalidate();row=value;const settings=value?read():null;slots=value?{a:structuredClone(settings),b:structuredClone(settings)}:{};initial=structuredClone(slots);for(const name of ['a','b'])describe(name);showTab('b');$('start').value=0;$('end').value=Math.min(10,value?.sourceSeconds??value?.seconds??10).toFixed(2);$('mode').value=value?.mode==='voice'?'voice':'mix';say(value?'A、B 已帶入相同的初始設定，可各自調整後比較。預設調整 B；點標籤即可切換整組數值。':'選取錄音後即可比較。');controls();}
  function restoreEditor(){
    if(busy||!initial[editor])return;
    // Skip reading the draft: restoring must also recover incomplete/invalid fields.
    stop();delete cache[editor];slots[editor]=structuredClone(initial[editor]);
    apply(structuredClone(slots[editor]));describe(editor);showTab(editor);controls();
    say(`已還原 ${editor.toUpperCase()} 本次載入的音量、延時與效果設定；另一組保留。按試聽即可重新比較。`);
  }
  function range(){const start=$('start').value===''?NaN:Number($('start').value),end=$('end').value===''?NaN:Number($('end').value);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>3600||end-start>30)throw Error('試聽需設定有效起訖，每段最多 30 秒。');return {start,end};}
  function matchGain(){const names=Object.keys(cache),levels=comparisonLevels(names.map(n=>cache[n]),$('match').checked);return levels[names.indexOf(active)]??1;}
  function play(name){return run(async selected=>{
    if(!slots[name])throw Error('請先記住這組設定。');
    selectTab(name);
    const interval=range(),token=generation;
    if(!cache[name]){say(`正在準備 ${name.toUpperCase()} 片段…`);loading=name;controls();try{const audio=await render(selected,slots[name],interval,$('mode').value==='voice');if(token!==generation)return;cache[name]=audio;}finally{loading=null;controls();}}
    beforePlay();
    if(!context)context=new AudioContext();await context.resume();if(token!==generation)return;
    const now=context.currentTime,offset=active?(now-origin)%cache[name].duration:0;
    const oldSource=source,oldGain=gain;
    source=context.createBufferSource();source.buffer=cache[name];source.loop=true;gain=context.createGain();active=name;
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(matchGain(),now+.012);source.connect(gain);gain.connect(context.destination);source.start(now,offset);origin=now-offset;
    if(oldSource){oldGain.gain.cancelScheduledValues(now);oldGain.gain.setValueAtTime(oldGain.gain.value,now);oldGain.gain.linearRampToValueAtTime(0,now+.012);oldSource.stop(now+.015);oldSource.onended=()=>{oldSource.disconnect();oldGain.disconnect();};}
    clearInterval(timer);timer=setInterval(()=>{if(context&&active)$('position').textContent=`${active.toUpperCase()} · 原始錄音 ${(interval.start+(context.currentTime-origin)%cache[active].duration).toFixed(2)} 秒 · 循環試聽中`;},100);
    say(`正在比較 ${name.toUpperCase()}：${interval.start}～${interval.end} 秒${$('match').checked?' · 近似音量匹配':''}。試聽不另存錄音。`);controls();
  },'post-audition-status');}
  for(const name of ['a','b']){
    $(name+'-tab').addEventListener('click',()=>switchEditor(name));
    $(name+'-edit').addEventListener('click',()=>switchEditor(name));
    $(name+'-tab').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?'a':event.key==='End'?'b':name==='a'?'b':'a';if(switchEditor(next))$(next+'-tab').focus();});
    $(name+'-play').addEventListener('click',()=>play(name));
    $(name+'-apply').addEventListener('click',()=>{if(switchEditor(name))document.getElementById('post-ab-editor').scrollIntoView({block:'start'});});
  }
  $('from-playhead').addEventListener('click',()=>{const limit=row.sourceSeconds??row.seconds,start=Math.max(0,Math.min(getPosition(),limit-.1));invalidate();$('start').value=start.toFixed(2);$('end').value=Math.min(limit,start+10).toFixed(2);say(`已選 ${$('start').value}～${$('end').value} 秒，可按 A／B 試聽。`);});
  $('stop').addEventListener('click',()=>{stop();say('比較已停止，A／B 設定仍保留。');});
  $('reset').addEventListener('click',restoreEditor);
  for(const id of ['start','end','mode'])$(id).addEventListener('change',invalidate);
  $('match').addEventListener('change',()=>{if(gain)gain.gain.setTargetAtTime(matchGain(),context.currentTime,.02);});
  // Delegation includes added/removed regions and preset/reset buttons. Reading drafts
  // here must not invalidate a playing buffer or overwrite the other group's settings.
  for(const event of ['input','change','click'])document.getElementById('post-ab-editor').addEventListener(event,refreshDifferences);
  document.getElementById('post-delay').addEventListener('input',refreshDifferences);
  window.addEventListener('pagehide',stop);
  return {reset,stop,controls,playCurrent:()=>play(editor),playing:()=>!!active,position:()=>active?Number($('start').value)+(context.currentTime-origin)%cache[active].duration:null};
}
