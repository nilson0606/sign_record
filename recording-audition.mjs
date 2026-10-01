// Temporary A/B renders share a source-time interval. They never write to the archive.
const $=id=>document.getElementById('post-audition-'+id);
export function comparisonLevels(buffers,matched=true){
  const rms=buffers.map(b=>{let sum=0;for(let c=0;c<b.numberOfChannels;c++)for(const x of b.getChannelData(c))sum+=x*x;return Math.sqrt(sum/(b.length*b.numberOfChannels));});
  const audible=rms.filter(x=>x>1e-6),target=audible.length?Math.min(...audible):0;
  return rms.map(x=>matched&&x>1e-6&&target?Math.min(1,target/x):1);
}
export function createRecordingAudition({read,apply,render,run,beforePlay}){
  let row=null,slots={},cache={},busy=false,context=null,active=null,origin=0,source=null,gain=null,timer=null,generation=0;
  const say=text=>$('status').textContent=text;
  function stop(){generation++;if(source){try{source.stop();}catch{}source.disconnect();source=null;}gain?.disconnect();gain=null;active=null;clearInterval(timer);timer=null;$('position').textContent='';if(context){void context.close();context=null;}controls(busy);}
  function invalidate(){stop();cache={};}
  function controls(value=busy){busy=value;const enabled=!!(row?.complete&&row.rawBytes&&row.post?.segments?.length);$('fields').disabled=busy||!enabled;
    for(const name of ['a','b'])for(const action of ['play','apply'])$(name+'-'+action).disabled=busy||!enabled||!slots[name];
    $('stop').disabled=!active&&!busy;$('mode').disabled=busy||!enabled||row?.mode==='voice';
  }
  function describe(name){const s=slots[name];$(name+'-info').textContent=s?`殘響 ${s.effects.reverb}% · 明亮 ${s.effects.reverbTone?.brightness??0} · 寬度 ${s.effects.reverbTone?.width??100}% · 回聲 ${s.effects.echo?.amount??0}% · ${s.effects.effectRegions?.length??0} 段局部效果 · 校正 ${s.delayMs} ms`:'尚未記住設定';}
  function capture(name){slots[name]=structuredClone(read());invalidate();describe(name);controls();say(`目前設定已記住為 ${name.toUpperCase()}，尚未另存錄音。`);}
  function reset(value,settings){invalidate();row=value;slots=value?{a:structuredClone(settings)}:{};for(const name of ['a','b'])describe(name);$('start').value=0;$('end').value=Math.min(10,value?.sourceSeconds??value?.seconds??10).toFixed(2);$('mode').value=value?.mode==='voice'?'voice':'mix';say(value?'A 已帶入這筆錄音保存的設定；調整後可試聽目前設定，或記住為 B。':'選取錄音後即可比較。');controls();}
  function range(){const start=$('start').value===''?NaN:Number($('start').value),end=$('end').value===''?NaN:Number($('end').value);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>3600||end-start>30)throw Error('試聽需設定有效起訖，每段最多 30 秒。');return {start,end};}
  function matchGain(){const names=Object.keys(cache),levels=comparisonLevels(names.map(n=>cache[n]),$('match').checked);return levels[names.indexOf(active)]??1;}
  function play(name){return run(async selected=>{
    if(!slots[name])throw Error('請先記住這組設定。');
    const interval=range(),token=generation;
    if(!cache[name]){say(`正在準備 ${name.toUpperCase()} 片段…`);const audio=await render(selected,slots[name],interval,$('mode').value==='voice');if(token!==generation)return;cache[name]=audio;}
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
    $(name+'-capture').addEventListener('click',()=>{try{capture(name);}catch(e){say(e.message);}});
    $(name+'-play').addEventListener('click',()=>play(name));
    $(name+'-apply').addEventListener('click',()=>{apply(structuredClone(slots[name]));say(`已套用 ${name.toUpperCase()} 設定，可繼續調整，或按「重新合成」另存。`);});
  }
  $('current').addEventListener('click',()=>{try{capture('b');void play('b');}catch(e){say(e.message);}});
  $('stop').addEventListener('click',()=>{stop();say('比較已停止，A／B 設定仍保留。');});
  for(const id of ['start','end','mode'])$(id).addEventListener('change',invalidate);
  $('match').addEventListener('change',()=>{if(gain)gain.gain.setTargetAtTime(matchGain(),context.currentTime,.02);});
  window.addEventListener('pagehide',stop);
  return {reset,stop,controls,playing:()=>!!active,position:()=>active?Number($('start').value)+(context.currentTime-origin)%cache[active].duration:null};
}
