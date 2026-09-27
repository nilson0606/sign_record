// Graded timbre effect on the singer bus: shelf + presence dip + high cut.
// This softens bright/breathy texture; it does not isolate or remove breath sounds.
const presets={off:{label:'關閉',maxDb:0},light:{label:'輕度',baseDb:2,maxDb:5,shelf:3500,presence:1,cutoff:12000},medium:{label:'中度',baseDb:5,maxDb:11,shelf:2800,presence:3,cutoff:7500},strong:{label:'強烈',baseDb:10,maxDb:18,shelf:2000,presence:6,cutoff:4500}};
export function softeningProfile(value='off') {
  if(!Object.hasOwn(presets,value))throw new Error('無效的歌聲柔化強度。');
  return {id:value,...presets[value]};
}
export function recordingSofteningSuffix(meta) {
  const id=meta?.vocalSoftening?.strength;
  return id&&id!=='off'&&Object.hasOwn(presets,id)?`_柔化${id==="strong"&&!(meta.vocalSoftening.version>=2)?"較強":presets[id].label}`:'';
}

// Versioned, repeatable recipe. Times refer to the rendered recording, not YouTube.
export function vocalEffects(value={},duration=3600) {
  if(value.version!==undefined&&value.version!==1)throw new Error('這筆人聲效果版本較新，請更新網頁後再編輯。');
  const number=(x,fallback,min,max,label)=>{
    const v=x===undefined?fallback:x;
    if(!Number.isFinite(v)||v<min||v>max)throw new Error(`${label}需介於 ${min} 與 ${max}。`);
    return v;
  };
  const eq=Object.fromEntries(['low','mid','high'].map(band=>[band,number(value.eq?.[band],0,-12,12,'EQ（dB）')]));
  const compression=value.compression??'off';
  if(!['off','light','medium'].includes(compression))throw new Error('無效的動態壓縮強度。');
  const reverb=number(value.reverb,0,0,20,'殘響（%）');
  if(!Array.isArray(value.regions??[])||(value.regions?.length??0)>100)throw new Error('局部音量最多 100 個區段。');
  const regions=(value.regions??[]).map(r=>({start:number(r.start,NaN,0,duration,'區段開始秒數'),end:number(r.end,NaN,0,duration,'區段結束秒數'),volume:number(r.volume,100,0,200,'區段音量（%）')})).sort((a,b)=>a.start-b.start);
  for(let i=0;i<regions.length;i++){
    if(regions[i].end<=regions[i].start)throw new Error('局部音量的結束時間必須晚於開始時間。');
    if(i&&regions[i].start<regions[i-1].end)throw new Error('局部音量區段不可重疊，請調整開始／結束時間。');
  }
  return {version:1,eq,compression,reverb,regions};
}

export const vocalReverbTail=.8;
export function processedVoice(context,source,recipe) {
  const nodes=[];let output=source;
  const append=node=>{output.connect(node);nodes.push(node);output=node;};
  for(const [band,type,frequency] of [['low','lowshelf',200],['mid','peaking',1500],['high','highshelf',5000]]){
    if(!recipe.eq[band])continue;
    const filter=context.createBiquadFilter();filter.type=type;filter.frequency.value=Math.min(frequency,context.sampleRate*.45);filter.Q.value=.8;filter.gain.value=recipe.eq[band];append(filter);
  }
  if(recipe.compression!=='off'){
    const compressor=context.createDynamicsCompressor(),medium=recipe.compression==='medium';
    compressor.threshold.value=medium?-24:-18;compressor.knee.value=12;compressor.ratio.value=medium?3:2;compressor.attack.value=.015;compressor.release.value=.18;append(compressor);
    const makeup=context.createGain();makeup.gain.value=10**((medium?3:2)/20);append(makeup);
  }
  if(recipe.regions.length){
    const local=context.createGain();local.gain.value=1;
    for(const r of recipe.regions){
      const fade=Math.min(.01,(r.end-r.start)/3),target=r.volume/100;
      local.gain.setValueAtTime(r.start===0?target:1,r.start);
      local.gain.linearRampToValueAtTime(target,r.start+fade);
      local.gain.setValueAtTime(target,r.end-fade);
      local.gain.linearRampToValueAtTime(1,r.end);
    }
    append(local);
  }
  if(recipe.reverb){
    const dry=output,convolver=context.createConvolver(),wet=context.createGain(),sum=context.createGain(),damping=context.createBiquadFilter();
    const impulse=context.createBuffer(2,Math.ceil(context.sampleRate*vocalReverbTail),context.sampleRate);
    // A fixed seed keeps repeated edits and solo previews identical.
    let seed=19237;
    for(let c=0;c<2;c++){
      const data=impulse.getChannelData(c);let energy=0;
      for(let i=Math.floor(context.sampleRate*.015);i<data.length;i++){
        seed=(Math.imul(seed,1664525)+1013904223)>>>0;
        data[i]=(seed/2147483648-1)*Math.exp(-7*i/data.length);energy+=data[i]*data[i];
      }
      const scale=.65/Math.sqrt(energy||1);for(let i=0;i<data.length;i++)data[i]*=scale;
    }
    convolver.normalize=false;convolver.buffer=impulse;wet.gain.value=recipe.reverb/100;
    damping.type='lowpass';damping.frequency.value=Math.min(5000,context.sampleRate*.45);
    dry.connect(sum);dry.connect(convolver);convolver.connect(damping);damping.connect(wet);wet.connect(sum);
    nodes.push(convolver,damping,wet,sum);output=sum;
  }
  return {output,disconnect(){source.disconnect();for(const node of nodes)node.disconnect();}};
}
export async function softenedVoice(context,source,raw,placement,strength='off') {
  const profile=softeningProfile(strength);
  if(!profile.maxDb)return source;
  const shelf=context.createBiquadFilter();shelf.type='highshelf';shelf.frequency.value=profile.shelf;shelf.gain.value=-profile.baseDb;source.connect(shelf);
  const presence=context.createBiquadFilter();presence.type='peaking';presence.frequency.value=2500;presence.Q.value=1.1;presence.gain.value=-profile.presence;shelf.connect(presence);
  const cutoff=context.createBiquadFilter();cutoff.type='lowpass';cutoff.frequency.value=Math.min(profile.cutoff,raw.sampleRate*.45);cutoff.Q.value=Math.SQRT1_2;presence.connect(cutoff);
  const rate=raw.sampleRate,hop=Math.max(1,Math.round(rate*.02));
  const channels=Array.from({length:raw.numberOfChannels},(_,c)=>raw.getChannelData(c));
  const low=new Float64Array(channels.length),alpha=1-Math.exp(-2*Math.PI*2500/rate);
  const first=Math.floor(placement.source*rate),end=Math.min(raw.length,Math.ceil((placement.source+placement.duration)*rate));
  let reduction=-profile.baseDb,block=0;
  for(let start=first;start<end;start+=hop){
    let total=0,high=0;const stop=Math.min(end,start+hop);
    for(let i=start;i<stop;i++)for(let c=0;c<channels.length;c++){
      const x=channels[c][i];low[c]+=alpha*(x-low[c]);const h=x-low[c];total+=x*x;high+=h*h;
    }
    const rms=Math.sqrt(total/Math.max(1,(stop-start)*channels.length));
    const ratio=Math.sqrt(high/Math.max(total,1e-20));
    // A fixed tonal change makes the option audible even when the old dynamic
    // detector would stay inactive; extra attenuation follows bright passages.
    const activity=Math.min(1,Math.max(0,(20*Math.log10(Math.max(rms,1e-10))+60)/18));
    const target=-profile.baseDb-(profile.maxDb-profile.baseDb)*Math.min(1,Math.max(0,(ratio-.12)/.35))*activity;
    const seconds=(stop-start)/rate,tau=target < reduction ? .025 : .15;
    reduction+=(target-reduction)*(1-Math.exp(-seconds/tau));
    shelf.gain.linearRampToValueAtTime(reduction,placement.when+(stop-first)/rate);
    if(++block%100===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  return cutoff;
}
