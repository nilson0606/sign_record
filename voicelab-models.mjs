import {readdirSync,realpathSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {VOICELAB_MODELS} from './voicelab-settings.mjs';

// IDs are catalogue keys, never paths supplied by the browser. Keep legacy IDs
// so saved recordings and existing selections continue to refer to the same voice.
export function scanVoiceLabModels(modelsRoot){
  const models=[],issues=[];
  if(!modelsRoot)return {models,issues:[{folder:'',message:'尚未設定模型資料夾。'}]};
  let root,folders;
  try{root=realpathSync(modelsRoot);folders=readdirSync(root,{withFileTypes:true});}
  catch{return {models,issues:[{folder:'',message:'無法讀取模型資料夾，請確認路徑存在且可存取。'}]};}
  for(const entry of folders){
    if(!entry.isDirectory()||entry.isSymbolicLink())continue;
    const folder=entry.name,dir=path.join(root,folder);
    try{
      if(path.dirname(realpathSync(dir))!==root)throw Error('資料夾需位於模型目錄內。');
      const files=readdirSync(dir,{withFileTypes:true});
      const pth=files.filter(f=>/\.pth$/i.test(f.name)),index=files.filter(f=>/\.index$/i.test(f.name));
      if(pth.length!==1||index.length!==1)throw Error(`找到 ${pth.length} 個 .pth、${index.length} 個 .index；每個音色資料夾請只放一組模型與索引。`);
      const [modelPath,indexPath]=[pth[0],index[0]].map(f=>{
        const full=path.join(dir,f.name);
        if(!f.isFile()||f.isSymbolicLink()||path.dirname(realpathSync(full))!==realpathSync(dir)||statSync(full).size===0)throw Error('模型與索引需為完整的本機檔案。');
        return full;
      });
      const legacy=folder.toLowerCase();
      const id=Object.hasOwn(VOICELAB_MODELS,legacy)?legacy:'folder-'+createHash('sha256').update(folder).digest('hex');
      models.push({id,label:VOICELAB_MODELS[id]??folder,folder,modelPath,indexPath});
    }catch(error){issues.push({folder,message:error.code?'無法讀取模型檔案，請確認檔案完整且可存取。':error.message});}
  }
  models.sort((a,b)=>(a.id==='ver3'?-1:b.id==='ver3'?1:a.folder.localeCompare(b.folder,'zh-Hant',{numeric:true})));
  return {models,issues};
}

export function findVoiceLabModel(catalog,id){
  const model=catalog.models.find(m=>m.id===id);
  if(!model)throw Error('此音色模型已移除或檔案不完整，請重新掃描模型。');
  return model;
}
