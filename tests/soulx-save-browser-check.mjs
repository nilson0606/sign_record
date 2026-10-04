import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const {chromium}=createRequire('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4288'},windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});const page=await browser.newPage();
  await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));await page.goto('http://localhost:4288');
  const result=await page.evaluate(async()=>{
    const {soulxSavedMetadata,soulxSettings}=await import('/soulx-settings.mjs'),{remixRecording}=await import('/recording-process.mjs');
    const raw=new AudioBuffer({length:48000,sampleRate:24000,numberOfChannels:1}),track=new AudioBuffer({length:720000,sampleRate:24000,numberOfChannels:1});
    raw.getChannelData(0)[7200]=.2;track.getChannelData(0)[367200]=.4;track.getChannelData(0)[492000]=.3;
    const row={id:'source',title:'Source',seconds:20,balance:{voice:70,backing:50},post:{reference:{duration:30},segments:[{offset:0,songTime:10,duration:6},{offset:6,songTime:20,duration:10}],samples:[]}};
    const saved=soulxSavedMetadata({row,interval:{start:5,end:7},delayMs:200,report:{settings:soulxSettings(),sourceSamples:48000,outputSamples:48000,sampleRate:24000},blend:100,match:false,useBacking:true,bytes:1,rawBytes:1});
    saved.fixedMixGains={version:1,voice:.7,backing:.5};
    const mixed=await remixRecording(raw,[track],saved,0,{effects:saved.vocalEffects});
    const backing=await remixRecording(raw,[track],saved,0,{effects:saved.vocalEffects,volume:{voice:0,backing:100}});
    const solo=await remixRecording(raw,[],{...saved,mode:'voice'},0,{effects:saved.vocalEffects});
    const read=b=>[b.length,b.getChannelData(0)[7200],b.getChannelData(0)[36000]];
    return {mixed:read(mixed),backing:read(backing),solo:read(solo)};
  });
  for(const [key,values] of Object.entries({mixed:[48000,.34,.15],backing:[48000,.2,.15],solo:[48000,.14,0]}))for(let i=0;i<3;i++)assert.ok(Math.abs(result[key][i]-values[i])<.00001,JSON.stringify(result));
  console.log('SoulX saved clip retains split backing timestamps, exact duration, fixed gain and independent volume: '+JSON.stringify(result));
}finally{await browser?.close();server.kill();}
