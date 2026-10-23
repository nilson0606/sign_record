import {balanceGains,createRecordingMix} from './recording-mix.mjs';
import {voicePlacement,originalVocalRanges,originalVocalWindows} from './recording-process.mjs';

// The existing audio element remains the seek/pause/volume transport. Its baked
// mix is silenced while the original buffers feed two independently adjustable buses.
export function createLiveRecordingPreview(audio,{settings,onError=()=>{}}) {
  let context,media,mediaGain,master,preview=null,mix=null,nodes=[],anchor=null,serial=0;
  const listeners=[];
  const listen=(name,fn)=>{audio.addEventListener(name,fn);listeners.push([name,fn]);};
  function stop(){
    serial++;anchor=null;
    mix?.disconnect();mix=null;
    for(const node of nodes){try{node.stop?.();}catch{}node.disconnect();}nodes=[];
  }
  function ensureContext(){
    if(context)return;
    // These are saved tracks, not microphone monitoring. Prefer playback
    // buffering so brief device/CPU load spikes have more output headroom.
    context=new AudioContext({latencyHint:'playback'});media=context.createMediaElementSource(audio);
    master=context.createGain();master.connect(context.destination);
    // Keep pulling the media stream so its native transport clock keeps running.
    mediaGain=context.createGain();media.connect(mediaGain);mediaGain.connect(context.destination);
  }
  function volume(){if(master)master.gain.value=audio.muted?0:audio.volume;}
  function applyLevels(){
    if(!mix||!preview)return;
    mix.setLevels(preview.levels(audio.currentTime,settings()),context.currentTime);
  }
  async function start(){
    stop();if(!context)return;
    const request=serial;
    try{
      await context.resume();
      if(request!==serial||audio.paused||audio.seeking||!preview)return;
      const {raw,tracks,meta,ms,windows,originalIndex,duration}=preview;
      const position=audio.currentTime,speed=audio.playbackRate,clock=context.currentTime;
      if(position>=duration||speed<=0)return;
      anchor={position,speed,clock};volume();
      const voice=context.createGain();nodes.push(voice);
      mix=createRecordingMix(context,voice,master,{mode:meta.mode,settings:settings(),voiced:()=>false});
      const at=time=>clock+(time-position)/speed;
      function envelope(param,points,invert=false){
        const value=x=>invert?1-x:x;
        if(points.at(-1).time<=position)return;
        if(points[0].time<position){
          let i=1;while(i<points.length&&points[i].time<position)i++;
          const a=points[i-1],b=points[i],fraction=(position-a.time)/(b.time-a.time);
          param.setValueAtTime(value(a.gain+(b.gain-a.gain)*fraction),clock);
        }
        points.filter(p=>p.time>=position).forEach((p,i)=>{
          const method=i===0&&p.time===points[0].time?'setValueAtTime':'linearRampToValueAtTime';
          param[method](value(p.gain),at(p.time));
        });
      }
      function source(buffer,when,offset,length,target){
        const start=Math.max(position,when),end=Math.min(duration,when+length);
        if(end<=start)return;
        const node=context.createBufferSource();node.buffer=buffer;node.playbackRate.value=speed;
        node.connect(target);node.start(at(start),offset+start-when,end-start);nodes.push(node);
      }
      for(const w of windows.filter(w=>w.mode==='original'))envelope(voice.gain,w.envelope,true);
      const p=voicePlacement(raw.duration,ms);source(raw,p.when,p.source,p.duration,voice);
      for(const segment of meta.post.segments)for(const [i,buffer] of tracks.entries()){
        if(i===originalIndex)continue;
        const length=Math.min(segment.duration,buffer.duration-segment.songTime);
        if(segment.songTime>=0&&length>0)source(buffer,segment.offset,segment.songTime,length,mix.input);
      }
      for(const w of windows){
        if(w.when+w.duration<=position)continue;
        const gain=context.createGain();gain.gain.value=0;gain.connect(mix.input);nodes.push(gain);
        envelope(gain.gain,w.envelope);
        source(tracks[originalIndex],w.when,w.source,w.duration,gain);
      }
      applyLevels();
    }catch(error){stop();audio.pause();onError(error);}
  }
  function set(value){
    stop();ensureContext();preview=preparePreview(value);mediaGain.gain.value=0;
    void context.resume().catch(onError);
    if(!audio.paused&&!audio.seeking)void start();
  }
  function clear(){stop();preview=null;if(mediaGain)mediaGain.gain.value=1;}
  listen('playing',()=>void start());listen('pause',stop);listen('ended',stop);
  listen('seeking',stop);listen('waiting',stop);
  listen('seeked',()=>{if(!audio.paused&&audio.readyState>=3)void start();});
  listen('ratechange',()=>{if(!audio.paused)void start();});listen('volumechange',volume);
  const timer=setInterval(()=>{
    if(!anchor||!preview||audio.paused||audio.seeking)return;
    const predicted=anchor.position+(context.currentTime-anchor.clock)*anchor.speed;
    // Recover from media buffering or a device clock change without accumulating drift.
    if(Math.abs(predicted-audio.currentTime)>.12){void start();return;}
    applyLevels();
  },100);
  return {set,clear,update:applyLevels,dispose(){clear();clearInterval(timer);for(const [name,fn] of listeners)audio.removeEventListener(name,fn);media?.disconnect();mediaGain?.disconnect();master?.disconnect();void context?.close().catch(()=>{});}};
}

function preparePreview({raw,tracks,meta,ms}) {
  const original=meta.mode==='mix'?meta.post.originalVocals:null;
  const windows=originalVocalWindows(original?originalVocalRanges(original.ranges,meta.post.reference.duration):[],meta.post.segments);
  const originalIndex=original?meta.stems?.indexOf(original.stem):-1;
  if(original&&(originalIndex<0||!tracks[originalIndex]))throw Error('缺少原唱音軌，請重新試合。');
  const rms=(buffer,time)=>{
    const samples=buffer.getChannelData(0),start=Math.floor(time*buffer.sampleRate),end=Math.min(samples.length,start+Math.floor(.1*buffer.sampleRate));
    if(start<0||end<=start)return 0;
    let sum=0;for(let i=start;i<end;i++)sum+=samples[i]*samples[i];return Math.sqrt(sum/(end-start));
  };
  function levels(time,balance){
    const sourceTime=time+ms/1000,segment=meta.post.segments.find(s=>time>=s.offset&&time<s.offset+s.duration),samples=meta.post.samples;
    let low=0,high=samples.length;
    while(low<high){const mid=(low+high)>>1;if(samples[mid].offset<=sourceTime)low=mid+1;else high=mid;}
    const sample=samples[Math.max(0,low-1)],voiced=!!sample?.hz&&Math.abs(sample.offset-sourceTime)<.2;
    const backingRms=segment?Math.hypot(...tracks.map((buffer,i)=>i===originalIndex&&!windows.some(w=>time>=w.when&&time<w.when+w.duration)?0:rms(buffer,segment.songTime+time-segment.offset))):0;
    return balanceGains({mode:meta.mode,settings:balance,voiceRms:rms(raw,sourceTime),backingRms,voiced});
  }
  return {raw,tracks,meta,ms,windows,originalIndex,levels,duration:meta.postEdit?.end??meta.seconds};
}
