import test from 'node:test';
import assert from 'node:assert/strict';
import {repairChannels,repairSettings,analyzeRepairVoice,correctionCurve} from '../recording-repair.mjs';
import {vocalEffects,recordingEffectsSuffix} from '../recording-soften.mjs';
import {settingDifferences} from '../recording-audition.mjs';
const signal=(rate,seconds,fn)=>Float32Array.from({length:Math.round(rate*seconds)},(_,i)=>fn(i/rate,i));
const rms=(x,rate,start,end)=>{let sum=0,n=0;for(let i=Math.round(start*rate);i<Math.min(x.length,Math.round(end*rate));i++){sum+=x[i]**2;n++;}return Math.sqrt(sum/Math.max(1,n));};
const power=(x,rate,hz,start,end)=>{let re=0,im=0,n=0;for(let i=Math.round(start*rate);i<Math.round(end*rate);i++){re+=x[i]*Math.cos(2*Math.PI*hz*i/rate);im+=x[i]*Math.sin(2*Math.PI*hz*i/rate);n++;}return 2*Math.hypot(re,im)/n;};
function random(){let seed=31231;return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};}

test('all four are opt-in; disabled processing is an exact bypass and recipes retain parameters',()=>{
 const data=signal(16000,.2,t=>.1*Math.sin(2*Math.PI*440*t)),channels=[data];
 assert.equal(repairChannels(channels,16000,{}).channels,channels);
 assert.deepEqual(vocalEffects(),{version:1,eq:{low:0,mid:0,high:0},compression:'off',reverb:0,regions:[]});
 const source={cleanup:{noise:25,deess:40,deessHz:5500,breath:30},pitchCorrection:{amount:50,target:'reference',speedMs:170,preserveVibrato:false}},copy=structuredClone(source),recipe=vocalEffects(source);
 assert.deepEqual(repairSettings(JSON.parse(JSON.stringify(recipe))),source);assert.deepEqual(source,copy);
 assert.match(recordingEffectsSuffix({vocalEffects:recipe}),/降噪25%.*齒音40%.*呼吸降低30%.*音準修正50%_原唱基準/);
 assert.equal(settingDifferences({effects:vocalEffects()},{effects:recipe}).filter(r=>/降噪|齒音|呼吸|音準|顫音/.test(r.label)).length,8);
 for(const value of [{cleanup:{noise:NaN}},{cleanup:{breath:101}},{cleanup:{deess:-1}},{cleanup:{deessHz:2000}},{pitchCorrection:{amount:Infinity}},{pitchCorrection:{speedMs:0}},{pitchCorrection:{target:'wrong'}},{pitchCorrection:{preserveVibrato:'on'}}])assert.throws(()=>vocalEffects(value));
});

test('spectral denoising reduces stationary noise while preserving the singing tone, samples and stereo length',()=>{
 const rate=48000,rnd=random(),data=signal(rate,1.5,(t)=>.012*rnd()+((t>.4&&t<1.2)?.12*Math.sin(2*Math.PI*440*t):0)),copy=data.slice();
 const {channels:[out],noiseLearned}=repairChannels([data],rate,{cleanup:{noise:70}});
 assert.ok(noiseLearned);assert.equal(out.length,data.length);assert.deepEqual(data,copy);assert.ok(out.every(Number.isFinite));
 const noise=rms(out,rate,.1,.3)/rms(data,rate,.1,.3),tone=power(out,rate,440,.6,1)/power(data,rate,440,.6,1);
 console.log('Repair noise', {noise,tone});assert.ok(noise<.65);assert.ok(tone>.8&&tone<1.05);
 const a=signal(rate,.6,t=>.1*Math.sin(2*Math.PI*440*t)),result=repairChannels([a],rate,{cleanup:{noise:100}});assert.equal(result.noiseLearned,false);assert.equal(result.channels[0],a,'no silent material must not be learned as noise');
});

test('de-esser attenuates a sibilant burst while keeping low singing and surrounding phrases',()=>{
 const rate=48000,data=signal(rate,1,t=>.08*Math.sin(2*Math.PI*440*t)+(t>.3&&t<.65?.15*Math.sin(2*Math.PI*6500*t):0));
 const [out]=repairChannels([data],rate,{cleanup:{deess:80}}).channels;
 const high=power(out,rate,6500,.4,.55)/power(data,rate,6500,.4,.55),low=power(out,rate,440,.4,.55)/power(data,rate,440,.4,.55),outside=rms(out,rate,.1,.2)/rms(data,rate,.1,.2);
 console.log('Repair deess',{high,low,outside});assert.ok(high<.5);assert.ok(Math.abs(low-1)<.03);assert.ok(Math.abs(outside-1)<.01);
});

test('breath attenuation finds an unvoiced burst near a phrase and preserves voiced amplitude',()=>{
 const rate=16000,rnd=random();let low=0,high=0;
 const data=signal(rate,1.6,t=>{const noise=rnd();low+=(noise-low)*.65;high+=(noise-high)*.15;return t>.28&&t<.5?(low-high)*.07:t>.65&&t<1.45?.14*Math.sin(2*Math.PI*220*t):0;});
 const [out]=repairChannels([data],rate,{cleanup:{breath:70}}).channels;
 const breath=rms(out,rate,.35,.45)/rms(data,rate,.35,.45),voice=rms(out,rate,.9,1.2)/rms(data,rate,.9,1.2);
 console.log('Repair breath',{breath,voice});assert.ok(breath<.65);assert.ok(Math.abs(voice-1)<.01);assert.equal(out.length,data.length);
 const loud=data.map((x,i)=>i/rate>.28&&i/rate<.5?x*5:x),[softened]=repairChannels([loud],rate,{cleanup:{breath:70}}).channels;
 assert.ok(rms(softened,rate,.35,.45)<rms(loud,rate,.35,.45)*.65,'a breath louder than the singing still gets reduced');
});

test('PSOLA corrects a slightly sharp note without stretching audio or changing quiet transients',()=>{
 for(const rate of [16000,44100,48000]){
  const data=signal(rate,1.5,(t,i)=>t>.25&&t<1.25?.1*Math.sin(2*Math.PI*450*t):i===Math.round(.08*rate)?.2:0),copy=data.slice();
  const [out]=repairChannels([data],rate,{pitchCorrection:{amount:100,speedMs:20,preserveVibrato:false}}).channels;
  const frames=analyzeRepairVoice([out],rate).frames.filter(f=>f.time>.6&&f.time<1.1&&f.hz),hz=frames.reduce((sum,f)=>sum+f.hz,0)/frames.length;
  console.log('Repair pitch',{rate,hz});assert.ok(Math.abs(hz-440)<2);assert.equal(out.length,data.length);assert.equal(out[Math.round(.08*rate)],data[Math.round(.08*rate)]);assert.deepEqual(data,copy);assert.ok(out.every(Number.isFinite));
 }
});

test('reference corrections respect capture compensation, seeks, masks and the singer octave',()=>{
 const analysis={hop:.1,frames:Array.from({length:25},(_,i)=>({time:i*.1,hz:225,confidence:1}))};
 const ref={step:.1,frames:[...Array(10).fill(440),...Array(10).fill(523.251)],masks:[{start:.6,end:.8}]};
 const meta={post:{reference:ref,segments:[{offset:0,songTime:0,duration:1},{offset:1,songTime:1,duration:1}]}};
 const settings=repairSettings({pitchCorrection:{amount:100,target:'reference',speedMs:20,preserveVibrato:false}}).pitchCorrection,curve=correctionCurve(analysis,settings,meta,.2);
 assert.ok(curve[4]<-30&&curve[4]>-45,'440 Hz reference chooses 220 Hz in the singer octave');assert.equal(curve[8],0,'mask is evaluated after compensation');assert.equal(curve[12],0,'a large different note is not forced into the reference');assert.equal(curve[24],0,'no segment never invents a target');
 assert.throws(()=>correctionCurve(analysis,settings,{},0),/沒有原唱音高基準/);
});

test('vibrato preservation corrects the average drift while retaining faster expressive modulation',()=>{
 const frames=Array.from({length:150},(_,i)=>({time:i*.02,hz:440*2**((20+25*Math.sin(2*Math.PI*5*i*.02))/1200),confidence:1})),analysis={frames,hop:.02};
 const base={amount:100,target:'chromatic',speedMs:20},kept=correctionCurve(analysis,{...base,preserveVibrato:true}),flat=correctionCurve(analysis,{...base,preserveVibrato:false});
 const deviation=curve=>{const values=frames.slice(50).map((f,i)=>1200*Math.log2(f.hz/440)+curve[i+50]),mean=values.reduce((a,b)=>a+b,0)/values.length;return {mean,variation:Math.sqrt(values.reduce((sum,x)=>sum+(x-mean)**2,0)/values.length)};};
 const preserved=deviation(kept),corrected=deviation(flat);assert.ok(Math.abs(preserved.mean)<2);assert.ok(preserved.variation>14);assert.ok(corrected.variation<preserved.variation*.5);
});
