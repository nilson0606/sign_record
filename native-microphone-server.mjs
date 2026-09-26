import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
const root=fileURLToPath(new URL('./',import.meta.url));
const python=fileURLToPath(new URL('./.runtime/venv/Scripts/python.exe',import.meta.url));
const worker=fileURLToPath(new URL('./tools/native_microphone.py',import.meta.url));
const run=promisify(execFile);
let active=null;
const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
export function stopNativeMicrophone(){active?.stop();}

// Commands and acknowledgements never share the recording PCM pipe.
export function monitorControl(child){
 let sequence=-1,closed=false,state={state:'off',sequence:-1};
 const pending=new Map(),lines=createInterface({input:child.stderr});
 function rejectAll(error){for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();}
 function close(){if(closed)return;closed=true;rejectAll(Error('本機收音已停止。'));lines.close();}
 lines.on('line',line=>{
  if(line.length>4096)return;
  let message;try{message=JSON.parse(line);}catch{return;}
  if(message.monitor!==true||!Number.isSafeInteger(message.sequence)||message.sequence!==sequence)return;
  state={state:message.state,sequence,error:typeof message.error==='string'?message.error:''};
  if(state.state==='starting')return;
  const p=pending.get(sequence);
  if(p){pending.delete(sequence);clearTimeout(p.timer);if(state.state==='error')p.reject(Error(state.error));else p.resolve(state);}
 });
 child.stdin.on('error',close);child.once('close',close);child.once('error',close);
 function write(value){child.stdin.write(JSON.stringify(value)+'\n',error=>{if(error)close();});}
 return{
  close,
  command(value){
   if(closed)return Promise.reject(Error('本機收音已停止。'));
   if(value.action==='keepalive'){
    if(value.sequence!==sequence)return Promise.reject(Error('監聽設定已更新。'));
    write(value);return Promise.resolve(state);
   }
   if(value.sequence<=sequence)return Promise.reject(Error('監聽設定已更新。'));
   sequence=value.sequence;rejectAll(Error('監聽設定已更新。'));
   return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
     pending.delete(sequence);
     // A delayed device open must never produce sound after an apparent failed start.
     write({action:'set',sequence:++sequence,enabled:false,deviceId:'',volume:0});
     reject(Error('喇叭輸出啟動逾時，請停止收音後重試。'));
    },5000);
    pending.set(sequence,{resolve,reject,timer});write(value);
   });
  }
 };
}
// Called only after loopback host/origin and session-token validation.
export async function handleNativeMicrophone(req,res,readBody){
 if(['/microphone/devices','/microphone/outputs'].includes(req.url)&&req.method==='GET'){
  try{const {stdout}=await run(python,['-X','utf8',worker,req.url.endsWith('/outputs')?'--outputs':'--list'],{cwd:root,windowsHide:true,timeout:20000,maxBuffer:65536});json(res,200,JSON.parse(stdout));}
  catch{json(res,503,{error:'本機音訊元件尚未就緒，請更新本機工具並安裝 tools/requirements-audio.txt。'});}
  return;
 }
 if(req.url==='/microphone/monitor'&&req.method==='POST'){
  const value=await readBody(req);
  if(!Number.isSafeInteger(value.sequence)||value.sequence<0||!['set','keepalive'].includes(value.action)||
    (value.action==='set'&&(typeof value.enabled!=='boolean'||typeof value.deviceId!=='string'||value.deviceId.length>512||!Number.isFinite(value.volume)||value.volume<0||value.volume>1))){
   json(res,400,{error:'Invalid monitor control'});return;
  }
  const operation=active;
  if(!operation||value.captureId!==operation.id){json(res,409,{error:'這次收音已停止，請重新開啟麥克風。'});return;}
  try{json(res,200,await operation.monitor.command(value));}
  catch(error){json(res,409,{error:error.message});}
  return;
 }
 if(req.url!=='/microphone/stream'||req.method!=='POST'){json(res,405,{error:'Unsupported microphone request'});return;}
 const input=await readBody(req);
 if(typeof input.deviceId!=='string'||input.deviceId.length>512){json(res,400,{error:'Invalid microphone'});return;}
 if(active){json(res,409,{error:'本機麥克風已被另一個分頁使用，請先停止該頁收音。'});return;}
 const child=spawn(python,['-X','utf8',worker,'--device',input.deviceId],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let header=Buffer.alloc(0),ended=false;
 const operation={id:randomUUID(),monitor:monitorControl(child),stop:()=>{if(ended)return;ended=true;clearTimeout(timer);operation.monitor.close();child.kill();if(!res.writableEnded)res.destroy();}};
 active=operation;
 const fail=message=>{if(ended)return;if(!res.headersSent)json(res,503,{error:message});operation.stop();};
 let timer=setTimeout(()=>fail('本機麥克風啟動逾時，請確認 Python 收音權限。'),25000);
 res.once('close',()=>operation.stop());
 child.once('error',()=>fail('本機收音程式無法啟動。'));
 child.once('close',()=>{if(active===operation)active=null;fail('本機收音已中斷，請重新開啟。');clearTimeout(timer);});
 child.stdout.on('data',function first(chunk){
  if(ended)return;
  header=Buffer.concat([header,chunk]);const newline=header.indexOf(10);
  if(newline<0){if(header.length>4096)fail('本機收音回應不正確。');return;}
  let meta;
  try{meta=JSON.parse(header.subarray(0,newline));if(meta.sampleRate!==48000||meta.channels!==1||typeof meta.label!=='string')throw Error();}
  catch{fail('本機收音格式不正確。');return;}
  clearTimeout(timer);child.stdout.removeListener('data',first);
  res.writeHead(200,{'Content-Type':'application/octet-stream','X-Content-Type-Options':'nosniff'});
  res.write(JSON.stringify({...meta,captureId:operation.id})+'\n');
  res.write(header.subarray(newline+1));header=null;child.stdout.pipe(res);
  const heartbeat=()=>{clearTimeout(timer);timer=setTimeout(()=>fail('本機收音串流逾時。'),5000);};
  child.stdout.on('data',heartbeat);heartbeat();
 });
}
