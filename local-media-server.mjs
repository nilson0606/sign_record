import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile,rename,rm,lstat,readdir} from 'node:fs/promises';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {isLocalMediaId} from './media-source.mjs';
const jobs=new Map(),tickets=new Map(),MAX_BYTES=2*1024**3;let accepting=false;
const json=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
export const localMediaBusy=()=>accepting||[...jobs.values()].some(j=>!['ready','failed','cancelled'].includes(j.stage));
async function safeDirectory(library,id){
  if(!isLocalMediaId(id))throw Error('本機媒體 ID 無效。');
  const root=path.join(library,'.local-mv'),dir=path.join(root,id);
  for(const item of [root,dir]){const s=await lstat(item).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(s?.isSymbolicLink()||(s&&!s.isDirectory()))throw Error('本機媒體目錄無效。');}
  return dir;
}
export async function localMediaInfo(library,id){
  const dir=await safeDirectory(library,id);
  try{
    const info=JSON.parse(await readFile(path.join(dir,'metadata.json'),'utf8')),kind=info.kind==='audio'?'audio':'video',file=path.join(dir,kind==='audio'?'audio.wav':'video.mp4'),s=await lstat(file);
    if(s.isSymbolicLink()||!s.isFile()||!s.size||info.id!==id)throw Error();
    return {id,kind,title:String(info.title).slice(0,250),duration:info.duration,bytes:s.size,file};
  }catch{throw Error('找不到已匯入的本機媒體，請重新選擇原檔匯入。');}
}
function publicInfo(info){const {file,...value}=info;return value;}
function command(job,exe,args,timeout=15*60000){
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args.map(String),{windowsHide:true,stdio:['ignore','pipe','pipe']});job.child=child;
    let output='',error='';const timer=setTimeout(()=>{child.kill();reject(Error('本機媒體處理逾時。'));},timeout);
    child.stdout.on('data',b=>{output=(output+b).slice(-1000000);});child.stderr.on('data',b=>{error=(error+b).slice(-3000);});
    child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);job.child=null;if(job.cancelled)reject(Error('已取消匯入。'));else if(code)reject(Error('媒體格式無法處理，請確認檔案可正常播放。'+error.slice(-300)));else resolve(output);});
  });
}
async function convert(job){
  try{
    job.stage='processing';job.message='正在檢查本機媒體並準備播放格式…';
    const audioOnly=job.kind==='audio',formats=audioOnly?'mp3,wav':'mov,matroska,webm';
    const probe=JSON.parse(await command(job,'ffprobe',['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',formats,'-show_streams','-show_format','-of','json',job.input],30000));
    const video=probe.streams?.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic),audio=probe.streams?.find(s=>s.codec_type==='audio'),duration=Number(probe.format?.duration);
    if((!audioOnly&&!video)||!audio||!Number.isFinite(duration)||duration<1||duration>900)throw Error(audioOnly?'請選擇有效的 MP3／WAV 音檔，長度需為 1 秒至 15 分鐘。':'請選擇含聲音的 MV，長度需為 1 秒至 15 分鐘。');
    const dir=await safeDirectory(job.library,job.mediaId);
    const existing=await localMediaInfo(job.library,job.mediaId).catch(()=>null);
    if(existing){job.media=publicInfo(existing);job.stage='ready';job.message='已載入之前匯入的本機媒體。';return;}
    if(audioOnly){
      job.message='正在保存本機音檔…';
      await command(job,'ffmpeg',['-nostdin','-v','error','-protocol_whitelist','file,pipe','-format_whitelist',formats,'-i',job.input,'-map',`0:${audio.index}`,'-vn','-c:a','pcm_s24le','-ar','48000','-ac','2','-map_metadata','-1',path.join(job.dir,'audio.wav')]);
    }else{
    const compatible=video.codec_name==='h264'&&['yuv420p','yuvj420p'].includes(video.pix_fmt);
    job.message=compatible?'正在保存本機 MV…':'正在轉換成可播放的 MP4，原影片保留…';
    const output=path.join(job.dir,'video.mp4');
    await command(job,'ffmpeg',['-nostdin','-v','error','-protocol_whitelist','file,pipe','-format_whitelist',formats,'-i',job.input,'-map',`0:${video.index}`,'-map',`0:${audio.index}`,
      ...(compatible?['-c:v','copy']:['-c:v','libx264','-preset','veryfast','-crf','20','-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2','-pix_fmt','yuv420p']),
      ...(audio.codec_name==='aac'?['-c:a','copy']:['-c:a','aac','-b:a','192k']),'-map_metadata','-1','-movflags','+faststart',output]);
    }
    if(job.cancelled)throw Error('已取消匯入。');
    await writeFile(path.join(job.dir,'metadata.json'),JSON.stringify({id:job.mediaId,kind:job.kind,title:job.title,duration,created:new Date().toISOString()}));
    await rm(job.input,{force:true});
    // Publish a complete directory only; never overwrite the caller's source file.
    const broken=await lstat(dir).catch(error=>{if(error.code==='ENOENT')return null;throw error;}),backup=path.join(job.library,'.local-mv','.replaced-'+job.id);
    if(broken)await rename(dir,backup);
    try{await rename(job.dir,dir);}catch(error){if(broken)await rename(backup,dir);throw error;}
    if(broken)await rm(backup,{recursive:true,force:true,maxRetries:3});
    job.media=publicInfo(await localMediaInfo(job.library,job.mediaId));job.stage='ready';job.message=audioOnly?'本機音檔已保存，可以播放或準備歌曲基準。':'本機 MV 已保存，可以播放或準備歌曲基準。';
  }catch(error){job.stage=job.cancelled?'cancelled':'failed';job.message=error.message;}
  finally{if(path.dirname(job.dir)===path.join(job.library,'.local-mv')&&path.basename(job.dir).startsWith('.import-'))await rm(job.dir,{recursive:true,force:true,maxRetries:3}).catch(()=>{});const expiry=setTimeout(()=>jobs.delete(job.id),3600000);expiry.unref();}
}
export function parseMediaRange(value,size){
  if(!value)return {start:0,end:size-1,partial:false};
  const match=/^bytes=(\d*)-(\d*)$/.exec(value);if(!match||(!match[1]&&!match[2]))return null;
  let start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2])),end=match[1]?(match[2]?Number(match[2]):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return null;
  return {start,end:Math.min(end,size-1),partial:true};
}
export async function handleLocalMedia(req,res,{library,authorized}){
  const url=new URL(req.url,'http://localhost'),match=/^\/local-media\/(local_[a-f0-9]{64})(?:\/(video))?$/.exec(url.pathname);
  try{
    if(match?.[2]&&['GET','HEAD'].includes(req.method)){
      const ticket=tickets.get(url.searchParams.get('ticket'));
      if(!ticket||ticket.id!==match[1]||ticket.library!==library||ticket.expires<Date.now()){json(res,403,{error:'請重新載入本機影音。'});return;}
      const info=await localMediaInfo(library,match[1]),range=parseMediaRange(req.headers.range,info.bytes);
      if(!range){res.writeHead(416,{'Content-Range':`bytes */${info.bytes}`});res.end();return;}
      res.writeHead(range.partial?206:200,{'Content-Type':info.kind==='audio'?'audio/wav':'video/mp4','Accept-Ranges':'bytes','Content-Length':range.end-range.start+1,'Cross-Origin-Resource-Policy':'cross-origin','Cache-Control':'private, no-store',...(range.partial?{'Content-Range':`bytes ${range.start}-${range.end}/${info.bytes}`}:{})});
      if(req.method==='HEAD')res.end();else await pipeline(createReadStream(info.file,{start:range.start,end:range.end}),res);return;
    }
    if(!authorized){json(res,403,{error:'Session token required'});return;}
    if(!library)throw Error('請先設定本機歌曲庫位置。');
    if(req.method==='GET'&&url.pathname==='/local-media'){
      const rows=[];for(const id of await readdir(path.join(library,'.local-mv')).catch(()=>[])){if(isLocalMediaId(id)){const row=await localMediaInfo(library,id).catch(()=>null);if(row)rows.push(publicInfo(row));}}
      json(res,200,{media:rows});return;
    }
    if(req.method==='GET'&&match&&!match[2]){
      const info=await localMediaInfo(library,match[1]),ticket=randomBytes(24).toString('hex');
      for(const [key,item]of tickets)if(item.expires<Date.now())tickets.delete(key);
      tickets.set(ticket,{id:info.id,library,expires:Date.now()+24*3600000});json(res,200,{...publicInfo(info),playbackPath:`/local-media/${info.id}/video?ticket=${ticket}`});return;
    }
    const jobMatch=/^\/local-media\/imports\/([a-f0-9-]{36})$/.exec(url.pathname),job=jobMatch&&jobs.get(jobMatch[1]);
    if(job&&job.library===library){
      if(req.method==='DELETE'){job.cancelled=true;job.child?.kill();}
      if(['GET','DELETE'].includes(req.method)){json(res,200,{id:job.id,stage:job.stage,message:job.message,media:job.media});return;}
    }
    if(req.method==='POST'&&url.pathname==='/local-media/imports'){
      if(localMediaBusy()){json(res,409,{error:'已有本機媒體正在匯入，請稍候。'});return;}
      const name=url.searchParams.get('name')||'',length=Number(req.headers['content-length']),kind=url.searchParams.get('kind')||(/\.(mp3|wav)$/i.test(name)?'audio':'video');
      if(!['audio','video'].includes(kind)||!(kind==='audio'?/\.(mp3|wav)$/i:/\.(mp4|m4v|mov|webm|mkv)$/i).test(name)||!Number.isFinite(length)||length<1||length>MAX_BYTES)throw Error('請選擇 MP3／WAV 音檔，或 MP4／MOV／MKV／WebM 影片，檔案上限 2 GB。');
      const id=randomUUID(),title=path.basename(name.replaceAll('\\','/'),path.extname(name)).slice(0,250);
      accepting=true;try{
      const root=path.join(library,'.local-mv');await safeDirectory(library,'local_'+'0'.repeat(64));await mkdir(root,{recursive:true});
      const dir=path.join(root,'.import-'+id);await mkdir(dir);
      const item={id,kind,library,dir,input:path.join(dir,'input'+path.extname(name).toLowerCase()),title,stage:'receiving',message:'接收本機媒體…'};jobs.set(id,item);
      try{
        let received=0;const hash=createHash('sha256');
        await pipeline(req,new Transform({transform(chunk,encoding,done){received+=chunk.length;if(received>MAX_BYTES||received>length){done(Error('檔案大小超出上限。'));return;}hash.update(chunk);done(null,chunk);}}),createWriteStream(item.input,{flags:'wx'}));
        if(received!==length)throw Error('檔案傳送不完整，請重新匯入。');
        item.mediaId='local_'+hash.digest('hex');item.task=convert(item);json(res,202,{id,stage:'processing'});
      }catch(error){item.stage='failed';await rm(dir,{recursive:true,force:true,maxRetries:3});jobs.delete(id);throw error;}
      }finally{accepting=false;}
      return;
    }
    json(res,404,{error:'找不到本機影音或匯入工作。'});
  }catch(error){if(!res.headersSent)json(res,400,{error:error.message});else res.destroy();}
}
export async function stopLocalMedia(){for(const job of jobs.values()){if(!['ready','failed'].includes(job.stage)){job.cancelled=true;job.child?.kill();}}await Promise.allSettled([...jobs.values()].map(j=>j.task));tickets.clear();}
