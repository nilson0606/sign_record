import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {scanVoiceLabModels,findVoiceLabModel} from '../voicelab-models.mjs';
import {voicelabSettings,voicelabSavedMetadata} from '../voicelab-settings.mjs';

function fixture(t){const root=mkdtempSync(path.join(tmpdir(),'voicelab-models-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function model(root,name,files=['any_80e.pth','different.index']){const dir=path.join(root,name);mkdirSync(dir);for(const file of files)writeFileSync(path.join(dir,file),'fixture');return dir;}

test('folder discovery preserves legacy IDs, accepts arbitrary filenames and discovers added folders without restart',t=>{
 const root=fixture(t);model(root,'Wife_Ver2');model(root,'Ver3');
 let catalog=scanVoiceLabModels(root);assert.equal(catalog.models[0].id,'ver3');assert.equal(findVoiceLabModel(catalog,'wife_ver2').label,'Wife Ver2');assert.deepEqual(catalog.issues,[]);
 model(root,'新音色 N5',['voice_90e.PTH','voice.INDEX','readme.txt']);catalog=scanVoiceLabModels(root);
 const added=catalog.models.find(m=>m.label==='新音色 N5');assert.match(added.id,/^folder-[a-f0-9]{64}$/);assert.equal(voicelabSettings({model:added.id}).model,added.id);
 assert.equal(path.basename(added.modelPath),'voice_90e.PTH');assert.equal(path.basename(added.indexPath),'voice.INDEX');assert.equal(scanVoiceLabModels(root).models.find(m=>m.label===added.label).id,added.id);
 assert.throws(()=>findVoiceLabModel(catalog,'../../outside'));assert.throws(()=>findVoiceLabModel(catalog,'folder-'+'0'.repeat(64)));
 rmSync(path.join(root,'新音色 N5'),{recursive:true});assert.throws(()=>findVoiceLabModel(scanVoiceLabModels(root),added.id),/重新掃描/);
});

test('incomplete, empty and ambiguous models are reported instead of silently paired',t=>{
 const root=fixture(t);model(root,'missing',['model.pth']);model(root,'many',['one.pth','two.pth','voice.index']);model(root,'indexes',['one.pth','one.index','two.index']);
 const empty=model(root,'empty');writeFileSync(path.join(empty,'any_80e.pth'),'');model(root,'valid');
 const {models,issues}=scanVoiceLabModels(root);assert.deepEqual(models.map(m=>m.label),['valid']);assert.equal(issues.length,4);assert.match(issues.find(i=>i.folder==='many').message,/2 個 .pth/);assert.match(issues.find(i=>i.folder==='empty').message,/完整/);
 assert.equal(scanVoiceLabModels(path.join(root,'absent')).issues.length,1);
});

test('linked model folders cannot escape the configured models directory',t=>{
 const base=fixture(t),root=path.join(base,'models');mkdirSync(root);const outside=model(base,'outside');
 symlinkSync(outside,path.join(root,'linked'),process.platform==='win32'?'junction':'dir');assert.deepEqual(scanVoiceLabModels(root).models,[]);
});

test('saved recordings retain custom model names even after the folder is gone',()=>{
 const report={settings:voicelabSettings({model:'folder-'+'b'.repeat(64)}),modelLabel:'新音色 N5',sampleRate:48000,sourceSamples:96000,outputSamples:96000};
 const meta=voicelabSavedMetadata({row:{id:'source',title:'Song',seconds:2},interval:{start:0,end:2},report,delayMs:0,blend:100,match:false,useBacking:false,bytes:1,rawBytes:1});
 assert.match(meta.title,/新音色 N5/);assert.equal(meta.voicelab.report.modelLabel,'新音色 N5');assert.ok(!meta.title.includes('undefined'));
});
