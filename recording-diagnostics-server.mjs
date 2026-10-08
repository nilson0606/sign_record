import {randomBytes} from 'node:crypto';
import {mkdir,readdir,readFile,writeFile,appendFile,unlink,rmdir,lstat} from 'node:fs/promises';
import path from 'node:path';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const origins=new Set(['http://localhost:4273','http://127.0.0.1:4273','https://nilson0606.github.io']);
const reply=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw Error('診斷單筆資料過大');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}

// Own directory only; never accesses the song library or RecordingStore.
export function createDiagnosticsHandler(directory,{maxBytes=2*1024**3}={}){
  const root=path.resolve(directory),token=randomBytes(32).toString('hex'),active=new Map();let queue=Promise.resolve(),total=null;
  const serial=fn=>{const job=queue.then(fn);queue=job.catch(()=>{});return job;};
  async function inventory(){
    await mkdir(root,{recursive:true});if((await lstat(root)).isSymbolicLink())throw Error('診斷目錄不可使用連結');
    const rows=[];let bytes=0;
    for(const entry of await readdir(root,{withFileTypes:true})){
      if(!uuid.test(entry.name)||!entry.isDirectory()||entry.isSymbolicLink())continue;
      const dir=path.join(root,entry.name),files=[];
      for(const f of await readdir(dir,{withFileTypes:true})){
        if(!/^(metadata\.json|events\.jsonl|\d{8}-\d\.bin)$/.test(f.name)||!f.isFile()||f.isSymbolicLink())throw Error('診斷目錄包含未知檔案，未清除');
        const file=path.join(dir,f.name);bytes+=(await lstat(file)).size;files.push(file);
      }
      rows.push({dir,files});
    }
    return {rows,bytes};
  }
  return async(req,res)=>{
    const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/diagnostics'))return false;
    const origin=req.headers.origin||(req.headers['sec-fetch-site']==='same-origin'?'http://'+req.headers.host:null);
    if(!/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host||'')||!origins.has(origin)){reply(res,403,{error:'Origin required'});return true;}
    res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Private-Network','true');
    if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Diagnostic-Token');res.writeHead(204);res.end();return true;}
    if(url.pathname==='/diagnostics/session'&&req.method==='GET'){reply(res,200,{token,version:1});return true;}
    if(req.headers['x-diagnostic-token']!==token){reply(res,403,{error:'Token required'});return true;}
    try{
      const input=req.method==='POST'?await body(req):null;
      const result=await serial(async()=>{
        if(url.pathname==='/diagnostics'&&req.method==='GET'){const inv=await inventory();total=inv.bytes;return {count:inv.rows.length,bytes:inv.bytes,path:root,active:[...active.values()].some(s=>Date.now()-s.touched<120000)};}
        if(url.pathname==='/diagnostics'&&req.method==='DELETE'){
          if([...active.values()].some(s=>Date.now()-s.touched<120000))throw Error('仍有錄音診斷進行中，請停止錄音後再清除');
          const inv=await inventory(); // Validate every owned file before removing any.
          for(const row of inv.rows){for(const file of row.files)await unlink(file);await rmdir(row.dir);}
          active.clear();total=0;return {cleared:inv.rows.length};
        }
        const match=/^\/diagnostics\/([a-f0-9-]+)(?:\/(events|finish))?$/.exec(url.pathname);
        if(!match||!uuid.test(match[1])||req.method!=='POST')throw Error('Invalid diagnostic request');
        const id=match[1],dir=path.join(root,id);
        if(total===null)total=(await inventory()).bytes;
        if(!match[2]){
          if(total>=maxBytes)throw Error('診斷已達 2 GB，請先清除舊診斷');
          await mkdir(dir);const metadata={id,title:String(input.title||'').slice(0,300),created:Date.now(),input:input.input,sampleRate:input.sampleRate,videoId:input.videoId,recordingId:input.recordingId,status:'recording',formatVersion:1};
          const text=JSON.stringify(metadata,null,2);await writeFile(path.join(dir,'metadata.json'),text);total+=Buffer.byteLength(text);active.set(id,{metadata,touched:Date.now(),sequence:0,bytes:0});return {id};
        }
        const session=active.get(id);if(!session)throw Error('診斷已結束或服務已重啟');session.touched=Date.now();
        if(match[2]==='finish'){
          session.metadata.status=input.error?'incomplete':'saved';session.metadata.error=String(input.error||'').slice(0,500);session.metadata.finished=Date.now();session.metadata.bytes=session.bytes;
          await writeFile(path.join(dir,'metadata.json'),JSON.stringify(session.metadata,null,2));active.delete(id);return {saved:true};
        }
        if(!['event','media','probe','pcm'].includes(input.kind))throw Error('Invalid event kind');
        const event={...input,sequence:++session.sequence};let bytes=0;const files=[];
        const buffers=(input.buffers||[]).map(value=>{if(typeof value!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('Invalid sample data');const b=Buffer.from(value,'base64');bytes+=b.length;return b;});
        for(let i=0;i<buffers.length;i++)files.push(`${String(event.sequence).padStart(8,'0')}-${i}.bin`);
        delete event.buffers;event.files=files;const line=JSON.stringify(event)+'\n',lineBytes=Buffer.byteLength(line);
        if(lineBytes>65536||buffers.length>8||session.sequence>50000||session.bytes+bytes+lineBytes>512*1024**2||total+bytes+lineBytes>maxBytes)throw Error('診斷容量已滿，錄音仍會繼續；請停止後清除舊診斷');
        for(let i=0;i<buffers.length;i++)await writeFile(path.join(dir,files[i]),buffers[i]);
        total+=bytes+lineBytes;session.bytes+=bytes+lineBytes;await appendFile(path.join(dir,'events.jsonl'),line);return {saved:true};
      });reply(res,200,result);
    }catch(error){reply(res,400,{error:error.message});}
    return true;
  };
}
