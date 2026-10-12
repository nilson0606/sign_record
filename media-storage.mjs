import {lstatSync,readdirSync,readFileSync,unlinkSync,rmdirSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const tempFiles=new Set(['input.wav','request.json','converted.wav','source.wav','result.wav','result.json','diagnostic.log']);
function regular(file,directory=false){const s=lstatSync(file);if(s.isSymbolicLink()||!(directory?s.isDirectory():s.isFile()))throw Error('檔案位置無效，已停止清理。');return s;}
export function mediaStorageList(root,kind,locked=[]){
  root=path.resolve(root);let entries=[];
  try{regular(root,true);}catch(e){if(e.code==='ENOENT')return {root,entries,bytes:0};throw e;}
  for(const name of readdirSync(root)){
    const full=path.resolve(root,name);if(path.dirname(full)!==root)continue;
    try{
      if(kind==='temp'){
        if(!uuid.test(name))continue;const info=regular(full,true),files=readdirSync(full);
        if(!files.length||files.some(f=>!tempFiles.has(f)))continue;
        const bytes=files.reduce((sum,f)=>sum+regular(path.join(full,f)).size,0);
        let report={},request={};try{report=JSON.parse(readFileSync(path.join(full,'result.json'),'utf8'));}catch{}try{request=JSON.parse(readFileSync(path.join(full,'request.json'),'utf8'));}catch{}
        const modelName=typeof request.modelPath==='string'?path.basename(path.dirname(request.modelPath)):null;
        entries.push({id:name,name:report.modelLabel||modelName||report.settings?.model||'未完成的轉換',bytes,modified:info.mtimeMs,seconds:report.seconds??null,locked:locked.includes(name)});
      }else if(kind==='mv'){
        if(!/^MV_.+_[a-f0-9]{8}\.mp4$/i.test(name))continue;const info=regular(full);
        entries.push({id:createHash('sha256').update(name).digest('hex'),name,bytes:info.size,modified:info.mtimeMs,locked:locked.includes(name)});
      }else throw Error('不支援的清理類型。');
    }catch{/* Foreign, linked or incomplete entries are never offered for deletion. */}
  }
  entries.sort((a,b)=>b.modified-a.modified);return {root,entries,bytes:entries.reduce((sum,e)=>sum+e.bytes,0)};
}
export function deleteMediaStorage(root,kind,value,locked=[]){
  const catalog=mediaStorageList(root,kind,locked);
  if(value?.root!==catalog.root)throw Error('儲存位置已變更，請重新整理後再清理。');
  if(!Array.isArray(value.ids)||!value.ids.length||value.ids.length>500||new Set(value.ids).size!==value.ids.length)throw Error('請選擇 1～500 個項目。');
  const selected=value.ids.map(id=>{const e=catalog.entries.find(e=>e.id===id);if(!e||e.locked)throw Error('選取項目已變更或仍在使用，請重新整理。');return e;});
  let bytes=0;const deleted=[];
  for(const e of selected){
    const full=path.resolve(catalog.root,kind==='temp'?e.id:e.name);
    if(path.dirname(full)!==catalog.root)throw Error('清理位置無效。');
    if(kind==='temp'){
      regular(full,true);const files=readdirSync(full);
      if(files.some(f=>!tempFiles.has(f)))throw Error('資料夾內容已變更，請重新整理。');
      for(const f of files)regular(path.join(full,f));
      for(const f of files)unlinkSync(path.join(full,f));rmdirSync(full);
    }else{regular(full);unlinkSync(full);}
    bytes+=e.bytes;deleted.push(e.id);
  }
  return {deleted,bytes};
}
export async function readStorageSelection(req){
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)throw Error('選取項目過多。');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
