// All routes run only after helper origin and session-token verification.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,createReadStream} from 'node:fs';
import {mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {soulxSettings,SOULX_REFERENCES} from './soulx-settings.mjs';
const root=fileURLToPath(new URL('./',import.meta.url)),runtime=path.join(root,'.runtime','soulx'),jobsRoot=path.join(runtime,'jobs');
const python=path.join(runtime,'venv','Scripts','python.exe'),jobs=new Map();
const json=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
const finished=j=>['ready','failed','cancelled'].includes(j.stage);
export const soulxBusy=()=>[...jobs.values()].some(j=>j.running||!finished(j));
const available=()=>[python,path.join(runtime,'manifest.json'),path.join(runtime,'weights/Soul-AILab/SoulX-Singer/model-svc.pt'),path.join(runtime,'weights/Soul-AILab/SoulX-Singer-Preprocess/rmvpe/rmvpe.pt'),path.join(runtime,'weights/openai/whisper-base/model.safetensors'),path.join(runtime,'SoulX-Singer/soulxsinger/models/soulxsinger_svc.py')].every(existsSync);
export function validateSoulxWav(value,maxSeconds=600){
  if(typeof value!=='string'||value.length>(maxSeconds*48000+44)*4/3+8||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('人聲 WAV 格式或大小無效。');
  const b=Buffer.from(value,'base64');
  if(b.length<44||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,16)!=='WAVEfmt '||b.readUInt32LE(16)!==16||b.readUInt16LE(20)!==1||b.readUInt16LE(22)!==1||b.readUInt32LE(24)!==24000||b.readUInt16LE(34)!==16||b.readUInt16LE(32)!==2||b.toString('ascii',36,40)!=='data'||b.readUInt32LE(40)!==b.length-44||(b.length-44)%2||b.readUInt32LE(4)!==b.length-8)throw Error('需要完整的 24 kHz 單聲道 PCM WAV。');
  if(b.length<48000+44||b.length>maxSeconds*48000+44)throw Error('音訊長度超出範圍。');
  return b;
}
export function validateSoulxRequest(v){
  if(!v||typeof v!=='object')throw Error('缺少轉換設定。');
  const settings=soulxSettings(v.settings),audio=validateSoulxWav(v.audio);
  const referenceAudio=['self','custom','original'].includes(settings.reference)?validateSoulxWav(v.referenceAudio,30):null;
  if(referenceAudio&&referenceAudio.length<3*48000+44)throw Error('參考歌聲至少需要 3 秒。');
  return {settings,audio,referenceAudio};
}
const summary=j=>({id:j.id,stage:j.stage,message:j.message,result:j.result??null});
async function kill(job){
  if(!job.child||!job.running)return;
  const closed=new Promise(resolve=>job.child.once('close',resolve));job.child.kill();await closed;
}
async function erase(job){
  job.deleted=true;
  clearTimeout(job.timer);clearTimeout(job.expiry);await kill(job);
  const dir=path.resolve(jobsRoot,job.id);
  if(/^[a-f0-9-]{36}$/.test(job.id)&&path.dirname(dir)===path.resolve(jobsRoot))await rm(dir,{recursive:true,force:true,maxRetries:4});
  jobs.delete(job.id);
}
export async function stopSoulx(){await Promise.allSettled([...jobs.values()].map(erase));}
export async function handleSoulx(req,res,{gpuBusy=()=>false}={}){
  try{
    if(req.url==='/soulx'&&req.method==='GET'){json(res,200,{installed:available(),references:SOULX_REFERENCES,maxSeconds:600});return;}
    if(req.url==='/soulx/jobs'&&req.method==='POST'){
      if(!available()){json(res,409,{error:'SoulX 尚未安裝完成，請先執行獨立模型安裝。'});return;}
      if(gpuBusy()||soulxBusy()){json(res,409,{error:'目前有音訊工作進行中，完成後再產生 SoulX。'});return;}
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>41*1024*1024)throw Error('音訊太大，每次最多 10 分鐘。');chunks.push(chunk);}
      const value=validateSoulxRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if(gpuBusy()||soulxBusy()){json(res,409,{error:'另一個音訊工作已開始，請稍後再試。'});return;}
      const id=randomUUID(),dir=path.join(jobsRoot,id),job={id,stage:'starting',message:'準備 SoulX…',running:false};jobs.set(id,job);
      try{
        // Keep at most five finished results in addition to the new job.
        for(const old of [...jobs.values()].filter(j=>j!==job&&finished(j)&&!j.running).slice(0,-5))await erase(old);
        await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'input.wav'),value.audio);
        if(value.referenceAudio)await writeFile(path.join(dir,'reference.wav'),value.referenceAudio);
        await writeFile(path.join(dir,'request.json'),JSON.stringify(value.settings));
        const child=spawn(python,['-u',path.join(root,'tools','soulx_worker.py'),'--request',path.join(dir,'request.json')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
        job.child=child;job.running=true;let pending='',diagnostic='',ready=false;
        const event=line=>{let d;try{d=JSON.parse(line);}catch{return;}if(finished(job))return;
          if(d.stage==='ready'){ready=true;return;}
          if(['loading','pitch','converting','failed'].includes(d.stage)){job.stage=d.stage;job.message=String(d.message??d.stage).slice(0,600);}
        };
        child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
        child.stdout.on('data',x=>{pending+=x;const lines=pending.split(/\r?\n/);pending=lines.pop();lines.forEach(event);if(pending.length>100000)pending='';});
        child.stderr.on('data',x=>{diagnostic=(diagnostic+x).slice(-12000);});
        child.on('error',()=>{job.stage='failed';job.message='無法啟動 SoulX 獨立環境。';});
        child.on('close',async code=>{
          job.running=false;clearTimeout(job.timer);if(pending)event(pending);
          if(job.deleted)return;
          if(!finished(job))try{
            if(code!==0||!ready)throw Error();
            job.result=JSON.parse(await readFile(path.join(dir,'result.json'),'utf8'));await stat(path.join(dir,'result.wav'));
            job.stage='ready';job.message='SoulX 已完成；可比較原聲與 AI，或下載試聽副本。';
          }catch{job.stage='failed';job.message='SoulX 轉換未完成；原始錄音保留。診斷已存於本機測試目錄。';}
          if(diagnostic)await writeFile(path.join(dir,'diagnostic.log'),diagnostic).catch(()=>{});
          job.expiry=setTimeout(()=>void erase(job).catch(()=>{}),3600000);job.expiry.unref();
        });
        job.timer=setTimeout(()=>{job.stage='failed';job.message='SoulX 超過 15 分鐘，已停止。';void kill(job);},900000);job.timer.unref();
        json(res,202,summary(job));
      }catch(error){job.stage='failed';job.message='無法建立 SoulX 工作。';await erase(job).catch(()=>{});throw error;}return;
    }
    const match=/^\/soulx\/jobs\/([a-f0-9-]{36})(?:\/(source|result))?$/.exec(req.url),job=match&&jobs.get(match[1]);
    if(!job){json(res,404,{error:'SoulX 工作不存在或已過期，請重新產生。'});return;}
    if(req.method==='DELETE'&&!match[2]){job.stage='cancelled';job.message='已取消 SoulX。';await kill(job);json(res,200,summary(job));return;}
    if(req.method!=='GET'){json(res,405,{error:'不支援此操作。'});return;}
    if(!match[2]){json(res,200,summary(job));return;}
    if(job.stage!=='ready'){json(res,409,{error:'SoulX 尚未完成。'});return;}
    const file=path.join(jobsRoot,job.id,match[2]+'.wav'),info=await stat(file);
    res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':info.size});await pipeline(createReadStream(file),res);
  }catch(error){if(!res.headersSent)json(res,400,{error:error.message});else res.destroy();}
}
