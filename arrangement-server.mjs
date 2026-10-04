// Authenticated, loopback-only accompaniment generation and durable local library.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,createReadStream} from 'node:fs';
import {mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {RecordingArchive,serializeArchive} from './recording-archive.mjs';
import {arrangementSettings,arrangementCaption,arrangementLabel,arrangementRange} from './arrangement-settings.mjs';
const root=fileURLToPath(new URL('./',import.meta.url)),runtime=path.join(root,'.runtime/acestep'),jobsRoot=path.join(runtime,'jobs'),python=path.join(runtime,'venv/Scripts/python.exe'),jobs=new Map();
const done=j=>['ready','failed','cancelled'].includes(j.stage),json=(res,code,v)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
const available=()=>[python,path.join(runtime,'manifest.json'),path.join(runtime,'checkpoints/acestep-v15-turbo/model.safetensors')].every(existsSync);
export const arrangementBusy=()=>[...jobs.values()].some(j=>j.running||!done(j));
const summary=j=>({id:j.id,stage:j.stage,message:j.message,progress:j.progress??null,result:j.result??null});
async function kill(j){if(!j.running)return;const closed=new Promise(resolve=>j.child.once('close',resolve));if(process.platform==='win32')await new Promise(resolve=>{const p=spawn('taskkill',['/PID',String(j.child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});p.once('error',()=>{j.child.kill();resolve();});p.once('close',resolve);});else j.child.kill();await closed;}
async function erase(j){j.deleted=true;clearTimeout(j.timer);clearTimeout(j.expiry);await kill(j);await j.saving?.catch(()=>{});const dir=path.resolve(jobsRoot,j.id);if(/^[a-f0-9-]{36}$/.test(j.id)&&path.dirname(dir)===path.resolve(jobsRoot))await rm(dir,{recursive:true,force:true,maxRetries:4});jobs.delete(j.id);}
export async function stopArrangements(){await Promise.allSettled([...jobs.values()].map(erase));}
export class ArrangementArchive extends RecordingArchive{
  constructor(library){super(library);this.library=library;this.root=path.resolve(library,'配樂');}
  async delete(id){
    this.dir(id);
    const used=(await new RecordingArchive(this.library).list()).records.filter(r=>r.arrangement?.id===id);
    if(used.length)throw Object.assign(Error(`這份配樂仍被 ${used.length} 筆錄音使用：${used.slice(0,3).map(r=>r.title).join('、')}。請先保留這份配樂，以便成品繼續後製。`),{status:409});
    await super.delete(id);
  }
  async save(job){
    const file=path.join(jobsRoot,job.id,'aligned.wav'),info=await stat(file),r=job.result;
    const meta={...r,id:job.id,title:`${r.title.slice(0,220)}_配樂_${arrangementLabel(r.settings)}_${r.start.toFixed(2)}-${r.end.toFixed(2)}秒`,created:Date.now(),kind:'accompaniment',mode:'voice',complete:true,mime:'audio/wav',rawBytes:0,bytes:info.size,seconds:r.sourceSeconds};
    const data=Buffer.from(JSON.stringify(meta)),prefix=Buffer.alloc(4);prefix.writeUInt32LE(data.length);
    return this.import(meta.id,Readable.from((async function*(){yield prefix;yield data;for await(const b of createReadStream(file))yield b;})()));
  }
}
export async function handleArrangements(req,res,{gpuBusy=()=>false,getSource,getLibrary}={}){
  try{
    if(req.url==='/arrangements'&&req.method==='GET'){json(res,200,{installed:available(),maxSeconds:600});return;}
    if(req.url.startsWith('/arrangements/library')){
      const library=await getLibrary();if(!library)throw Error('請先設定本機歌曲庫。');const archive=new ArrangementArchive(library);
      if(req.url==='/arrangements/library'&&req.method==='GET'){json(res,200,await archive.list());return;}
      const url=new URL(req.url,'http://localhost'),m=/^\/arrangements\/library\/([a-f0-9-]{36})(?:\/(audio))?$/.exec(url.pathname);
      if(url.searchParams.has('root')&&url.searchParams.get('root')!==archive.root)throw Error('歌曲庫位置已變更，請重新整理配樂清單。');
      if(m&&req.method==='DELETE'&&!m[2]){await serializeArchive(()=>archive.delete(m[1]));json(res,200,{deleted:true,id:m[1]});return;}
      if(!m||req.method!=='GET'||m[2]!=='audio'){json(res,404,{error:'配樂不存在。'});return;}
      const meta=await archive.get(m[1]),file=path.join(archive.dir(meta.id),'mix.wav');res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':meta.bytes});await pipeline(createReadStream(file),res);return;
    }
    if(req.url==='/arrangements/jobs'&&req.method==='POST'){
      if(!available())throw Error('配樂模型尚未安裝完成。');
      if(gpuBusy()||arrangementBusy())throw Error('目前有音訊工作進行中，請完成或取消後再產生配樂。');
      let text='';for await(const b of req){text+=b;if(text.length>16384)throw Error('設定太大。');}
      const v=JSON.parse(text),settings=arrangementSettings(v.settings),source=await getSource(v.cacheId);
      if(!source?.reference?.hasPreview)throw Error('請載入保有原伴奏音軌的歌曲。');
      const ref=source.reference,range=arrangementRange(v.start,v.end,ref.duration);
      if(gpuBusy()||arrangementBusy())throw Error('另一個音訊工作已開始，請稍後再試。');
      const id=randomUUID(),dir=path.join(jobsRoot,id),job={id,stage:'starting',message:'準備原伴奏…',running:false,library:source.library};jobs.set(id,job);
      try{
        for(const old of [...jobs.values()].filter(j=>j!==job&&done(j)&&!j.running).slice(0,-3))await erase(old);
        await mkdir(dir,{recursive:true});
        const config={...range,settings,caption:arrangementCaption(settings),cacheId:ref.cacheId,title:ref.title,videoId:ref.videoId,sourceSeconds:ref.duration,bpm:ref.bpm,source:path.join(source.directory,'accompaniment.mp3')};
        await writeFile(path.join(dir,'request.json'),JSON.stringify(config));
        const child=spawn(python,['-u',path.join(root,'tools/arrangement_worker.py'),'--request',path.join(dir,'request.json')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
        job.child=child;job.running=true;let pending='',diagnostic='',ready=false;
        const event=line=>{let d;try{d=JSON.parse(line);}catch{return;}if(done(job))return;if(d.stage==='ready'){ready=true;return;}if(['starting','loading','generating','finalizing','failed'].includes(d.stage)){job.stage=d.stage;job.message=String(d.message??'處理中').slice(0,600);job.progress=d.stage==='generating'&&Number.isFinite(d.progress)?Math.min(100,Math.max(0,d.progress)):null;}};
        child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',x=>{pending+=x;const lines=pending.split(/\r?\n/);pending=lines.pop();lines.forEach(event);if(pending.length>100000)pending='';});child.stderr.on('data',x=>{diagnostic=(diagnostic+x).slice(-16000);});
        child.on('error',()=>{job.stage='failed';job.message='無法啟動配樂模型。';});
        child.on('close',async code=>{job.running=false;clearTimeout(job.timer);if(pending)event(pending);if(job.deleted)return;if(!done(job))try{if(code!==0||!ready)throw Error();job.result=JSON.parse(await readFile(path.join(dir,'result.json'),'utf8'));await stat(path.join(dir,'aligned.wav'));job.stage='ready';job.message='新配樂已生成。請試聽與原唱的拍點，再保存。';}catch{job.stage='failed';job.message='配樂生成未完成；原曲保留。';}if(diagnostic)await writeFile(path.join(dir,'diagnostic.log'),diagnostic).catch(()=>{});job.expiry=setTimeout(()=>void erase(job).catch(()=>{}),3600000);job.expiry.unref();});
        job.timer=setTimeout(()=>{job.stage='failed';job.message='生成超過 30 分鐘，已停止。';void kill(job);},1800000);job.timer.unref();json(res,202,summary(job));
      }catch(e){job.stage='failed';await erase(job).catch(()=>{});throw e;}return;
    }
    const m=/^\/arrangements\/jobs\/([a-f0-9-]{36})(?:\/(audio|save))?$/.exec(req.url),job=m&&jobs.get(m[1]);if(!job){json(res,404,{error:'配樂工作不存在或已過期。'});return;}
    if(req.method==='DELETE'&&!m[2]){job.stage='cancelled';job.message='已取消配樂生成。';await kill(job);json(res,200,summary(job));return;}
    if(req.method==='GET'&&!m[2]){json(res,200,summary(job));return;}
    if(job.stage!=='ready')throw Error('配樂尚未完成。');
    if(req.method==='POST'&&m[2]==='save'){
      // Capture the original library on job creation; changing UI libraries cannot redirect a save.
      const saved=await serializeArchive(async()=>{const archive=new ArrangementArchive(job.library);if((await archive.deleted()).includes(job.id))throw Error('這份配樂已刪除，請重新生成後保存。');job.saving??=archive.save(job).catch(e=>{job.saving=null;throw e;});return job.saving;});json(res,200,saved);return;
    }
    if(req.method==='GET'&&m[2]==='audio'){const file=path.join(jobsRoot,job.id,'clip.wav'),info=await stat(file);res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':info.size});await pipeline(createReadStream(file),res);return;}
    json(res,405,{error:'不支援此操作。'});
  }catch(error){if(!res.headersSent)json(res,error.status??400,{error:error.message});else res.destroy();}
}
