import test from 'node:test';
import assert from 'node:assert/strict';
import {balanceGains,mixSettings} from '../recording-mix.mjs';
test('automatic balance ignores disabled manual levels, increases quiet singing and reduces loud singing within bounds',()=>{
 const quiet=balanceGains({voiceRms:.01,backingRms:.02,voiced:true}),loud=balanceGains({voiceRms:.9,backingRms:.8,voiced:true});
 assert.equal(quiet.voiceDb,6);assert.equal(quiet.backingDb,6);assert.equal(loud.voiceDb,-6);assert.equal(loud.backingDb,-6);
 assert.deepEqual(balanceGains({voiceRms:.01,backingRms:.02,voiced:true,settings:{manual:false,voice:0,backing:100}}),quiet);
});
test('manual plus automatic stays within three dB, preserves zero gain and supports voice-only mode',()=>{
 const value=balanceGains({voiceRms:.01,backingRms:.8,voiced:true,settings:{manual:true,voice:60,backing:80}});
 assert.equal(value.voiceDb,3);assert.equal(value.backingDb,-3);
 assert.ok(Math.abs(value.voice-.6*10**(3/20))<1e-10);assert.ok(Math.abs(value.backing-.8*10**(-3/20))<1e-10);
 assert.equal(balanceGains({voiceRms:.01,voiced:true,settings:{manual:true,voice:0}}).voice,0);
 assert.equal(balanceGains({backingRms:.01,settings:{manual:true,backing:0}}).backing,0);
 assert.equal(balanceGains({backingRms:.01,mode:'voice'}).backing,0);
});
test('silence, low-level noise and unvoiced input never get automatic microphone boost',()=>{
 for(const voiceRms of [0,.001,.008,NaN,Infinity]) assert.equal(balanceGains({voiceRms,voiced:true}).voiceDb,0);
 assert.equal(balanceGains({voiceRms:.02,voiced:false}).voiceDb,0);
 assert.equal(balanceGains({backingRms:.001}).backingDb,0);
 assert.deepEqual(mixSettings({manual:'true',voice:-10,backing:Infinity}),{manual:false,voice:0,backing:30});
});
test('manual balance supports 200 percent on both buses with bounded automatic correction',()=>{
 const settings={manual:true,voice:200,backing:150};
 assert.deepEqual(mixSettings(settings),settings);
 assert.deepEqual(mixSettings({manual:true,voice:250,backing:201}),{manual:true,voice:200,backing:200});
 const base=balanceGains({settings});
 assert.equal(base.voice,2);assert.equal(base.backing,1.5);
 const adjusted=balanceGains({settings,voiceRms:.01,backingRms:.8,voiced:true});
 assert.equal(adjusted.voiceDb,3);assert.equal(adjusted.backingDb,-3);
 assert.ok(Math.abs(adjusted.voice-2*10**(3/20))<1e-10);
 assert.ok(Math.abs(adjusted.backing-1.5*10**(-3/20))<1e-10);
 assert.equal(balanceGains({settings,mode:'voice'}).backing,0);
});
