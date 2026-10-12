import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createReadStream,existsSync} from 'node:fs';
import {mkdir,writeFile,copyFile,rename,stat,rm} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mediaStorageList,deleteMediaStorage,readStorageSelection} from './media-storage.mjs';
const runtime=fileURLToPath(new URL('./.runtime/mv/',import.meta.url));
const jobs=new Map(),MAX_BYTES=120*1024*1024;
const json=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
const summary=j=>({id:j.id,stage:j.stage,progress:j.progress,message:j.message,path:j.savedPath??null,filename:j.filename});
export const mvBusy=()=>[...jobs.values()].some(j=>j.running);
export function mvLabels(title,artist){
  for(const [name,value,max] of [['歌名',title,60],['翻唱者',artist,50]])if(typeof value!=='string'||!value.trim()||[...value.trim()].length>max||/[\x00-\x1f\x7f]/.test(value))throw Error(`請填寫${name}（最多 ${max} 字，不含換行）。`);
  return {title:title.trim(),artist:artist.trim()};
}
const textSize=(text,max,width)=>Math.min(max,Math.floor(width/[...text].reduce((n,c)=>n+(c.charCodeAt(0)>255?1:.6),0)));
export function mvFilter(title,artist){
  // User text is read literally from files, never interpolated into filter syntax.
  const text=(file,size,y,color)=>`drawtext=fontfile=font.ttc:textfile=${file}:expansion=none:fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${y}`;
  return `[0:a]showfreqs=s=1600x300:mode=bar:ascale=sqrt:fscale=log:colors=0x7fe0d6:rate=30:win_size=2048:averaging=3,format=rgba[bars];`+
    `color=c=0x101d2c:s=1920x1080:r=30[base];[base]drawbox=x=160:y=150:w=90:h=6:color=0x7fe0d6:t=fill,`+
    `${text('heading.txt',28,180,'0x7fe0d6')},${text('title.txt',textSize(title,84,1580),305,'white')},${text('artist.txt',textSize('翻唱｜'+artist,42,1500),435,'0xb6c6d8')},`+
    `drawbox=x=160:y=945:w=1600:h=2:color=0x30475d:t=fill,${text('footer.txt',22,995,'0x8196ac')}[card];[card][bars]overlay=160:610:shortest=1,format=yuv420p[v]`;
}
function command(job,exe,args,onData){
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{cwd:job.dir,windowsHide:true,stdio:['ignore','pipe','pipe']});job.child=child;let output='',error='';
    const timer=setTimeout(()=>{child.kill();},30*60*1000);timer.unref();
    child.stdout.on('data',b=>{if(onData)onData(b.toString());else output=(output+b).slice(-100000);});
    child.stderr.on('data',b=>{error=(error+b).slice(-4000);});
    child.on('error',reject);child.on('close',code=>{clearTimeout(timer);job.child=null;if(code===0&&job.stage!=='cancelled')resolve(output);else reject(Error(error||'影片處理已停止。'));});
  });
}
async function cleanup(job){
  // Only this job's UUID directory can be removed; published MP4s stay in the song library.
  const dir=path.resolve(runtime,job.id);
  if(/^[a-f0-9-]{36}$/.test(job.id)&&path.dirname(dir)===path.resolve(runtime))await rm(dir,{recursive:true,force:true,maxRetries:3});
}
async function render(job,labels,library){
  try{
    // Browser WebM recordings may have no duration header. Decode with a hard cap
    // before probing so those recordings work and oversized inputs stay bounded.
    await command(job,'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i','input.audio','-map','0:a:0','-vn','-t','601','-ar','48000','-c:a','pcm_s16le','source.wav']);
    if(job.stage==='cancelled')return;
    const probe=JSON.parse(await command(job,'ffprobe',['-v','error','-show_streams','-show_format','-of','json','source.wav']));
    const seconds=Number(probe.format?.duration),audio=probe.streams?.find(s=>s.codec_type==='audio');
    if(!audio||!Number.isFinite(seconds)||seconds<1||seconds>600)throw Error('MV 音訊需為 1 秒至 10 分鐘。');
    if(job.stage==='cancelled')return;
    const font=process.env.KARAOKE_MV_FONT||'C:/Windows/Fonts/msyh.ttc';if(!existsSync(font))throw Error('找不到中文字型，請設定 KARAOKE_MV_FONT。');
    await copyFile(font,path.join(job.dir,'font.ttc'));
    await Promise.all(Object.entries({'title.txt':labels.title,'artist.txt':'翻唱｜'+labels.artist,'heading.txt':'C O V E R   S E S S I O N','footer.txt':'AUDIO REACTIVE  /  1080p  /  30 fps'}).map(([name,value])=>writeFile(path.join(job.dir,name),value,'utf8')));
    if(job.stage==='cancelled')return;
    job.stage='rendering';job.message='正在製作隨音樂跳動的 MV…';let pending='';
    await command(job,'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i','source.wav','-filter_complex',mvFilter(labels.title,labels.artist),'-map','[v]','-map','0:a:0','-t',String(seconds),'-c:v','libx264','-preset','veryfast','-crf','22','-threads','4','-c:a','aac','-b:a','192k','-movflags','+faststart','-progress','pipe:1','result.mp4'],chunk=>{
      pending+=chunk;const lines=pending.split(/\r?\n/);pending=lines.pop();for(const line of lines)if(line.startsWith('out_time_us='))job.progress=Math.min(99,Math.max(job.progress,Math.floor(Number(line.split('=')[1])/1000000/seconds*100)||0));
    });
    if(job.stage==='cancelled')return;
    job.stage='saving';job.message='正在保存完成的 MV…';
    const output=path.join(library,'vedio');await mkdir(output,{recursive:true});
    const safe=value=>value.replace(/[\\/:*?"<>|.]/g,'_').slice(0,65);
    job.filename=`MV_${safe(labels.title)}_${safe(labels.artist)}_${job.id.slice(0,8)}.mp4`;
    const savedPath=path.join(output,job.filename);
    job.publishTemp=savedPath+'.tmp';await copyFile(path.join(job.dir,'result.mp4'),job.publishTemp);await rename(job.publishTemp,savedPath);job.publishTemp=null;
    job.savedPath=savedPath;job.progress=100;job.stage='ready';job.message='MV 已完成並保存到歌曲庫的 vedio 資料夾。';
  }catch(e){if(job.stage!=='cancelled'){job.stage='failed';job.message=e.message.includes('MV ')||e.message.includes('字型')?e.message:'MV 製作失敗，請確認 FFmpeg 可用；原音檔保留。';await writeFile(path.join(runtime,job.id+'.log'),e.message).catch(()=>{});}}
  finally{if(job.publishTemp)await rm(job.publishTemp,{force:true}).catch(()=>{});await cleanup(job).catch(()=>{});job.running=false;job.expiry=setTimeout(()=>jobs.delete(job.id),3600000);job.expiry.unref();}
}
export async function stopMV(){for(const job of jobs.values()){if(job.running){if(job.stage!=='saving')job.stage='cancelled';job.child?.kill();await job.task;}clearTimeout(job.expiry);await cleanup(job).catch(()=>{});}jobs.clear();}
export async function handleMV(req,res,{getLibrary}={}){
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/mv/library'||/^\/mv\/library\/[a-f0-9]{64}$/.test(url.pathname)){
      const library=await getLibrary();if(!library||!path.isAbsolute(library))throw Error('請先設定歌曲庫資料夾。');
      const root=path.join(library,'vedio');
      if(url.pathname==='/mv/library'&&req.method==='GET'){json(res,200,mediaStorageList(root,'mv'));return;}
      if(url.pathname==='/mv/library'&&req.method==='DELETE'){
        const value=await readStorageSelection(req);
        if(await getLibrary()!==library)throw Error('歌曲庫已變更，請重新整理。');
        json(res,200,deleteMediaStorage(root,'mv',value));return;
      }
      if(req.method==='GET'){
        if(url.searchParams.get('root')!==root)throw Error('歌曲庫已變更，請重新整理。');
        const entry=mediaStorageList(root,'mv').entries.find(e=>e.id===url.pathname.split('/').at(-1));if(!entry)throw Error('影片已移除，請重新整理。');
        res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':entry.bytes});await pipeline(createReadStream(path.join(root,entry.name)),res);return;
      }
      json(res,405,{error:'不支援此操作。'});return;
    }
    if(url.pathname==='/mv/jobs'&&req.method==='POST'){
      if(mvBusy()){json(res,409,{error:'已有 MV 製作中，請等待完成或取消。'});return;}
      const labels=mvLabels(url.searchParams.get('title'),url.searchParams.get('artist'));
      const id=randomUUID(),job={id,dir:path.join(runtime,id),stage:'preparing',running:true,progress:0,message:'正在讀取音檔…'};jobs.set(id,job);
      try{
        const library=await getLibrary();if(!library||!path.isAbsolute(library))throw Error('請先設定歌曲庫資料夾。');
        let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>MAX_BYTES)throw Error('音檔超過 120 MB，請縮短至 10 分鐘內。');chunks.push(chunk);}
        if(size<44)throw Error('沒有可用音訊，請重新選取錄音。');
        if(job.stage==='cancelled')throw Error('MV 製作已取消。');
        await mkdir(job.dir,{recursive:true});await writeFile(path.join(job.dir,'input.audio'),Buffer.concat(chunks));
        if(job.stage==='cancelled')throw Error('MV 製作已取消。');
        job.task=render(job,labels,library);json(res,202,summary(job));
      }catch(e){job.running=false;jobs.delete(id);await cleanup(job).catch(()=>{});throw e;}return;
    }
    const match=/^\/mv\/jobs\/([a-f0-9-]{36})(?:\/(result))?$/.exec(url.pathname),job=match&&jobs.get(match[1]);
    if(!job){json(res,404,{error:'找不到 MV 工作，請重新製作；已保存影片仍在歌曲庫 vedio 資料夾。'});return;}
    if(req.method==='DELETE'&&!match[2]){if(job.running){if(job.stage!=='saving'){job.stage='cancelled';job.message='已取消 MV 製作。';job.child?.kill();}await job.task;}json(res,200,summary(job));return;}
    if(req.method!=='GET'){json(res,405,{error:'不支援此操作。'});return;}
    if(!match[2]){json(res,200,summary(job));return;}
    if(job.stage!=='ready'){json(res,409,{error:'MV 尚未完成。'});return;}
    const info=await stat(job.savedPath);res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':info.size});await pipeline(createReadStream(job.savedPath),res);
  }catch(e){if(!res.headersSent)json(res,400,{error:e.message});else res.destroy();}
}
