const base='http://127.0.0.1:4274';
const size=n=>n>=1024**3?(n/1024**3).toFixed(2)+' GB':(n/1024**2).toFixed(1)+' MB';
async function request(route,options={}){
  let session;try{const r=await fetch(base+'/session',{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error();session=await r.json();}catch{throw Error('請先啟動本機唱錄工具。');}
  const r=await fetch(base+route,{...options,headers:{'X-Karaoke-Token':session.token,...(options.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(120000)});
  if(!r.ok){const value=await r.json().catch(()=>({}));throw Error(value.error||(r.status===404?'請更新並重新啟動本機工具，才能管理暫存與 MV。':'檔案管理失敗。'));}return r;
}
export function createVoiceLabStorage({getProtectedIds=()=>[],beforePlay=()=>{}}={}){
  const panel=document.getElementById('voicelab-storage');panel.open=false;
  for(const kind of ['temp','mv']){
    const $=id=>document.getElementById(`voicelab-storage-${kind}-${id}`),route=kind==='temp'?'/voicelab/storage':'/mv/library';
    let catalog=null,busy=false,url=null,previewId=null,previewRevision=0;
    const clearAll=kind==='mv'?document.getElementById('mv-clear-all'):null;
    const clearResult=kind==='mv'?document.getElementById('mv-clear-result'):null;
    const selected=()=>[...$('list').querySelectorAll('input:checked:not(:disabled)')].map(e=>e.value);
    function controls(){ if(clearAll)clearAll.disabled=busy;$('refresh').disabled=busy;$('all').disabled=busy||!catalog?.entries.some(e=>!e.locked&&!getProtectedIds().includes(e.id));$('delete').disabled=busy||!selected().length;for(const e of $('list').querySelectorAll('input,button'))e.disabled=busy||e.dataset.locked==='true';}
    function stopPreview(){if(kind!=='mv')return;previewRevision++;$('video').pause();$('video').removeAttribute('src');$('video').load();$('video').hidden=true;if(url)URL.revokeObjectURL(url);url=null;previewId=null;}
    async function preview(entry){
      stopPreview();const rev=previewRevision;busy=true;controls();$('status').textContent='載入影片：'+entry.name;
      try{const blob=await(await request(route+'/'+entry.id+'?'+new URLSearchParams({root:catalog.root}))).blob();if(rev!==previewRevision)return;url=URL.createObjectURL(blob);previewId=entry.id;$('video').src=url;$('video').hidden=false;beforePlay();await $('video').play();$('status').textContent='預覽：'+entry.name;}catch(e){$('status').textContent=e.message;}finally{busy=false;controls();}
    }
    async function refresh(message=''){
      if(busy)return;busy=true;controls();$('status').textContent=message||'正在讀取檔案清單…';
      try{
        catalog=await(await request(route)).json();$('path').textContent=catalog.root;$('list').replaceChildren();
        for(const entry of catalog.entries){
          const protectedItem=entry.locked||(kind==='temp'&&getProtectedIds().includes(entry.id)),row=document.createElement('div');row.className='storage-entry';
          const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=entry.id;box.dataset.locked=String(protectedItem);box.disabled=protectedItem;box.addEventListener('change',controls);
          const text=document.createElement('span');text.textContent=`${entry.name}${entry.seconds?' · '+Number(entry.seconds).toFixed(1)+' 秒':''} · ${size(entry.bytes)} · ${new Date(entry.modified).toLocaleString()}${protectedItem?' · 使用中，保留':''}`;
          label.append(box,text);row.append(label);
          if(kind==='mv'){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='播放';button.addEventListener('click',()=>void preview(entry));row.append(button);}
          $('list').append(row);
        }
        $('status').textContent=`${message?message+' ':''}共 ${catalog.entries.length} 項，${size(catalog.bytes)}。${catalog.entries.length?'勾選後可刪除。':'目前沒有可清理的檔案。'}`;
      }catch(e){catalog=null;$('list').replaceChildren();$('status').textContent=e.message;}
      finally{busy=false;controls();}
    }
    $('refresh').addEventListener('click',()=>void refresh());
    clearAll?.addEventListener('click',async()=>{
      if(busy)return;
      const say=text=>{clearResult.hidden=false;clearResult.textContent=text;};
      busy=true;controls();say('正在確認目前歌曲庫的 MV 數量與容量…');
      let count=0,bytes=0,message='';
      try{
        // Freeze the exact catalog before confirmation; newer renders are not included.
        const snapshot=await(await request(route)).json(),entries=snapshot.entries.filter(e=>!e.locked);
        if(!entries.length){message='清理完成：目前沒有可清理的 MV。';return;}
        const total=entries.reduce((sum,e)=>sum+e.bytes,0);
        if(!window.confirm(`清除全部 ${entries.length} 部 MV（${size(total)}）？\n位置：${snapshot.root}\n\n包含目前歌曲庫內所有歌曲由本工具產生的 MV 成品，永久刪除後無法復原。原始影片、歌曲、錄音、音色模型與製作中的暫存都保留。`)){message='已取消清理，MV 保留。';return;}
        stopPreview();
        for(let offset=0;offset<entries.length;offset+=500){
          say(`正在清理 MV：${count}／${entries.length} 部…`);
          const batch=entries.slice(offset,offset+500);
          const removed=await(await request(route,{method:'DELETE',body:JSON.stringify({root:snapshot.root,ids:batch.map(e=>e.id)})})).json();
          count+=removed.deleted.length;bytes+=removed.bytes;
          window.dispatchEvent(new CustomEvent('mv-library-deleted',{detail:{names:batch.filter(e=>removed.deleted.includes(e.id)).map(e=>e.name)}}));
        }
        message=`清理完成：已刪除 ${count} 部 MV，釋出 ${size(bytes)}。原始影片、歌曲與錄音保留。`;
      }catch(e){message=`清理未全部完成${count?`（已確認刪除 ${count} 部，釋出 ${size(bytes)}）`:''}：${e.message} 請查看重新整理後的清單。`;}
      finally{busy=false;await refresh();say(message);}
    });
    $('all').addEventListener('click',()=>{for(const box of $('list').querySelectorAll('input:not(:disabled)'))box.checked=true;controls();});
    $('delete').addEventListener('click',async()=>{
      const ids=selected();if(busy||!ids.length)return;
      const entries=catalog.entries.filter(e=>ids.includes(e.id)),bytes=entries.reduce((sum,e)=>sum+e.bytes,0);
      const warning=kind==='temp'?'會永久刪除選取的轉換暫存，未保存的舊試聽將無法再取回。已保存錄音、音色模型及 MV 保留。':'會永久刪除選取的本機 MP4，無法復原。原始音檔與已保存錄音保留。';
      if(!window.confirm(`刪除 ${ids.length} 項（${size(bytes)}）？\n位置：${catalog.root}\n${entries.slice(0,5).map(e=>e.name).join('\n')}${entries.length>5?'\n…':''}\n\n${warning}`))return;
      busy=true;controls();if(ids.includes(previewId))stopPreview();
      let message;
      try{const removed=await(await request(route,{method:'DELETE',body:JSON.stringify({root:catalog.root,ids})})).json();message=`已刪除 ${removed.deleted.length} 項，釋出 ${size(removed.bytes)}。`;if(kind==='mv')window.dispatchEvent(new CustomEvent('mv-library-deleted',{detail:{names:entries.filter(e=>removed.deleted.includes(e.id)).map(e=>e.name)}}));}
      catch(e){message='清理未全部完成：'+e.message;}
      finally{busy=false;await refresh(message);}
    });
    panel.addEventListener('toggle',()=>{if(panel.open)void refresh();else stopPreview();});
    window.addEventListener(kind==='mv'?'mv-saved':'voicelab-result-ready',()=>{if(panel.open)void refresh();});
    if(kind==='mv')$('video').addEventListener('play',beforePlay);
    window.addEventListener('pagehide',stopPreview);controls();
  }
}
