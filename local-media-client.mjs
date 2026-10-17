import {selectMediaSource,showMediaSource} from './media-source.mjs';
export const LOCAL_BASE='http://127.0.0.1:4274';
export async function mediaRequest(path,init={}){
  const response=await fetch(LOCAL_BASE+'/session',{signal:AbortSignal.timeout(8000),cache:'no-store'});
  if(!response.ok)throw Error('本機工具未連線。');const session=await response.json();
  if(!session.features?.includes('local-media'))throw Error('請更新並重新啟動本機工具，才能匯入本機 MV。');
  const r=await fetch(LOCAL_BASE+path,{...init,headers:{...init.headers,'X-Karaoke-Token':session.token},cache:'no-store'});
  const value=await r.json();if(!r.ok)throw Error(value.error||'本機 MV 處理失敗。');return value;
}
export function initializeLocalMedia(load){
  const $=id=>document.getElementById(id);let importing=false,cancelled=false,job=null,controller=null;
  const message=text=>{$('local-media-status').textContent=text;};
  function controls(){for(const id of ['source-kind','local-media-file','local-media-saved','local-media-load','local-media-refresh'])$(id).disabled=importing;$('local-media-cancel').hidden=!importing;$('local-media-controls').dataset.importing=String(importing);window.dispatchEvent(new Event('karaoke-media-import-state'));}
  async function refresh(){const value=await mediaRequest('/local-media'),selected=$('local-media-id').value;$('local-media-saved').replaceChildren(new Option('選擇已匯入的 MV',''));for(const m of value.media)$('local-media-saved').add(new Option(m.title,m.id));if(value.media.some(m=>m.id===selected))$('local-media-saved').value=selected;}
  $('source-kind').addEventListener('change',()=>{showMediaSource();if($('source-kind').value==='local')void refresh().catch(e=>message(e.message));});
  $('local-media-refresh').addEventListener('click',()=>void refresh().catch(e=>message(e.message)));
  $('local-media-load').addEventListener('click',async()=>{const id=$('local-media-saved').value;if(!id)return message('請先選擇已匯入的 MV。');selectMediaSource(id);await load();});
  $('local-media-cancel').addEventListener('click',()=>{cancelled=true;controller?.abort();if(job)void mediaRequest('/local-media/imports/'+job,{method:'DELETE'}).catch(()=>{});message('正在取消匯入…');});
  $('local-media-file').addEventListener('change',async()=>{
    const file=$('local-media-file').files[0];if(!file||importing)return;
    if(file.size>2*1024**3){message('影片上限 2 GB。');$('local-media-file').value='';return;}
    importing=true;cancelled=false;job=null;controller=new AbortController();controls();
    try{
      message('正在將影片傳到這台電腦的歌曲庫，請稍候；不會上傳雲端…');
      const created=await mediaRequest('/local-media/imports?name='+encodeURIComponent(file.name),{method:'POST',body:file,signal:controller.signal});job=created.id;
      while(true){
        if(cancelled){await mediaRequest('/local-media/imports/'+job,{method:'DELETE'});throw Error('已取消匯入。');}
        const state=await mediaRequest('/local-media/imports/'+job);message(state.message);
        if(state.stage==='ready'){selectMediaSource(state.media.id);await refresh();if(await load())message(`已匯入「${state.media.title}」。可直接播放，或按「準備歌曲基準」使用錄音、評分、分段與 Voice Lab。`);break;}
        if(['failed','cancelled'].includes(state.stage))throw Error(state.message);
        await new Promise(r=>setTimeout(r,1000));
      }
    }catch(error){message(cancelled?'已取消匯入；原影片保留。':error.message);}
    finally{importing=false;job=null;controller=null;$('local-media-file').value='';controls();}
  });
  showMediaSource();controls();
}
