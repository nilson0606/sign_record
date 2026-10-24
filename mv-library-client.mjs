// 「已保存 MV」清單與「清除全部 MV」：列出歌曲庫 vedio 資料夾裡本工具產生的 MP4，可搜尋、播放、下載、勾選刪除。
// 只用本機小幫手既有的 /mv/library（GET 清單、GET 單一影片、DELETE 刪除），不改伺服器。
import {localizedConfirm} from './i18n.mjs';
const base='http://127.0.0.1:4274';
const size=n=>n>=1024**3?(n/1024**3).toFixed(2)+' GB':(n/1024**2).toFixed(1)+' MB';
async function request(route,options={}){
  let session;try{const r=await fetch(base+'/session',{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error();session=await r.json();}catch{throw Error('請先啟動本機唱錄工具。');}
  const r=await fetch(base+route,{...options,headers:{'X-Karaoke-Token':session.token,...(options.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(120000)});
  if(!r.ok){const value=await r.json().catch(()=>({}));throw Error(value.error||'MV 清單讀取失敗。');}return r;
}
// MV_<歌名>_<翻唱者>_<8 碼>.mp4 → 「歌名 · 翻唱者」（名稱不符合時照原檔名顯示）
export function mvDisplayName(name){
  const m=/^MV_(.+)_([a-f0-9]{8})\.mp4$/i.exec(name||'');if(!m)return name;
  const parts=m[1].split('_');if(parts.length<2)return parts[0];
  return parts.slice(0,-1).join(' ')+' · '+parts.at(-1);
}
export function mvMatches(entry,query){
  const q=String(query||'').trim().toLowerCase();if(!q)return true;
  const hay=(mvDisplayName(entry.name)+' '+entry.name).toLowerCase();
  return q.split(/\s+/).every(word=>hay.includes(word));
}
export function createMVLibrary({beforePlay=()=>{}}={}){
  const $=id=>document.getElementById('mv-library-'+id),panel=$('panel');
  const clearAll=document.getElementById('mv-clear-all'),clearResult=document.getElementById('mv-clear-result');
  let catalog=null,busy=false,url=null,previewId=null,previewRevision=0;
  const selected=()=>[...$('list').querySelectorAll('input:checked:not(:disabled)')].map(e=>e.value);
  const visible=()=>(catalog?.entries??[]).filter(e=>mvMatches(e,$('search').value));
  function controls(){
    clearAll.disabled=busy;$('refresh').disabled=busy;$('search').disabled=busy&&!catalog;
    $('all').disabled=busy||!visible().length;$('delete').disabled=busy||!selected().length;
    for(const e of $('list').querySelectorAll('input,button'))e.disabled=busy;
  }
  function stopPreview(){previewRevision++;$('video').pause();$('video').removeAttribute('src');$('video').load();$('video').hidden=true;if(url)URL.revokeObjectURL(url);url=null;previewId=null;}
  async function fetchVideo(entry){return (await request('/mv/library/'+entry.id+'?'+new URLSearchParams({root:catalog.root}))).blob();}
  async function preview(entry){
    stopPreview();const rev=previewRevision;busy=true;controls();$('status').textContent='正在載入影片：'+mvDisplayName(entry.name);
    try{const blob=await fetchVideo(entry);if(rev!==previewRevision)return;url=URL.createObjectURL(blob);previewId=entry.id;$('video').src=url;$('video').hidden=false;beforePlay();await $('video').play().catch(()=>{});$('status').textContent='正在播放：'+mvDisplayName(entry.name);}
    catch(e){$('status').textContent=e.message;}finally{busy=false;controls();}
  }
  async function download(entry){
    busy=true;controls();$('status').textContent='正在準備下載：'+mvDisplayName(entry.name);
    try{const blob=await fetchVideo(entry),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=entry.name;a.click();setTimeout(()=>URL.revokeObjectURL(href),60000);$('status').textContent='已開始下載：'+entry.name;}
    catch(e){$('status').textContent=e.message;}finally{busy=false;controls();}
  }
  function render(message=''){
    $('list').replaceChildren();
    const rows=visible();
    for(const entry of rows){
      const row=document.createElement('div');row.className='mv-entry';
      const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=entry.id;box.addEventListener('change',controls);
      const text=document.createElement('span');text.dataset.i18nSkip='';
      const title=document.createElement('strong');title.textContent=mvDisplayName(entry.name);
      const info=document.createElement('small');info.textContent=`${new Date(entry.modified).toLocaleString()} · ${size(entry.bytes)}`;
      text.append(title,info);label.append(box,text);row.append(label);
      const play=document.createElement('button');play.type='button';play.className='secondary';play.textContent='播放';play.addEventListener('click',()=>void preview(entry));
      const save=document.createElement('button');save.type='button';save.className='secondary';save.textContent='下載';save.addEventListener('click',()=>void download(entry));
      row.append(play,save);$('list').append(row);
    }
    const total=catalog?.entries.length??0,q=$('search').value.trim();
    if(!catalog)return;
    $('status').textContent=message||(!total?'目前沒有已保存的 MV。':q?`符合「${q}」的有 ${rows.length} 部（全部 ${total} 部，${size(catalog.bytes)}）。`:`共 ${total} 部，${size(catalog.bytes)}。`);
    controls();
  }
  async function refresh(message=''){
    if(busy)return;busy=true;controls();$('status').textContent=message||'正在讀取 MV 清單…';
    try{catalog=await(await request('/mv/library')).json();$('path').textContent='位置：'+catalog.root;busy=false;render(message);}
    catch(e){catalog=null;$('list').replaceChildren();$('path').textContent='';$('status').textContent=e.message;}
    finally{busy=false;controls();}
  }
  async function remove(ids,entries,root){
    let count=0,bytes=0;
    for(let offset=0;offset<ids.length;offset+=500){
      const batch=ids.slice(offset,offset+500);
      const removed=await(await request('/mv/library',{method:'DELETE',body:JSON.stringify({root,ids:batch})})).json();
      count+=removed.deleted.length;bytes+=removed.bytes;
      window.dispatchEvent(new CustomEvent('mv-library-deleted',{detail:{names:entries.filter(e=>removed.deleted.includes(e.id)).map(e=>e.name)}}));
    }
    return {count,bytes};
  }
  $('refresh').addEventListener('click',()=>void refresh());
  $('search').addEventListener('input',()=>{if(catalog)render();});
  $('all').addEventListener('click',()=>{for(const box of $('list').querySelectorAll('input'))box.checked=true;controls();});
  $('delete').addEventListener('click',async()=>{
    const ids=selected();if(busy||!ids.length)return;
    const entries=catalog.entries.filter(e=>ids.includes(e.id)),bytes=entries.reduce((sum,e)=>sum+e.bytes,0);
    const names=entries.slice(0,5).map(e=>mvDisplayName(e.name)).join('\n')+(entries.length>5?'\n…':'');
    if(!localizedConfirm(`刪除 ${ids.length} 部 MV（${size(bytes)}）？\n位置：${catalog.root}\n${names}\n\n會永久刪除選取的 MP4，無法復原。原始音檔與已保存錄音保留。`))return;
    busy=true;controls();if(ids.includes(previewId))stopPreview();
    let message;
    try{const r=await remove(ids,entries,catalog.root);message=`已刪除 ${r.count} 部，釋出 ${size(r.bytes)}。`;}
    catch(e){message='刪除未全部完成：'+e.message;}
    finally{busy=false;await refresh(message);}
  });
  clearAll.addEventListener('click',async()=>{
    if(busy)return;
    const say=text=>{clearResult.hidden=false;clearResult.textContent=text;};
    busy=true;controls();say('正在確認目前歌曲庫的 MV 數量與容量…');
    let message='',done={count:0,bytes:0};
    try{
      // 確認前先固定清單；確認之後才做好的 MV 不會被刪
      const snapshot=await(await request('/mv/library')).json(),entries=snapshot.entries.filter(e=>!e.locked);
      if(!entries.length){message='清理完成：目前沒有可清理的 MV。';return;}
      const total=entries.reduce((sum,e)=>sum+e.bytes,0);
      if(!localizedConfirm(`清除全部 ${entries.length} 部 MV（${size(total)}）？\n位置：${snapshot.root}\n\n包含目前歌曲庫內所有歌曲由本工具產生的 MV 成品，永久刪除後無法復原。原始影片、歌曲與錄音都保留。`)){message='已取消清理，MV 保留。';return;}
      stopPreview();say(`正在清理 MV：0／${entries.length} 部…`);
      done=await remove(entries.map(e=>e.id),entries,snapshot.root);
      message=`清理完成：已刪除 ${done.count} 部 MV，釋出 ${size(done.bytes)}。原始影片、歌曲與錄音保留。`;
    }catch(e){message=`清理未全部完成${done.count?`（已確認刪除 ${done.count} 部，釋出 ${size(done.bytes)}）`:''}：${e.message} 請查看重新整理後的清單。`;}
    finally{busy=false;if(panel.open)await refresh();else controls();say(message);}
  });
  panel.addEventListener('toggle',()=>{if(panel.open)void refresh();else stopPreview();});
  window.addEventListener('mv-saved',()=>{if(panel.open)void refresh();});
  $('video').addEventListener('play',beforePlay);
  window.addEventListener('pagehide',stopPreview);controls();
  return {refresh,stopPreview};
}
