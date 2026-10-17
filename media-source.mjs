import {youtubeId} from './audio.mjs';
export const isLocalMediaId=id=>typeof id==='string'&&/^local_[a-f0-9]{64}$/.test(id);
export const isMediaId=id=>typeof id==='string'&&(/^[\w-]{11}$/.test(id)||isLocalMediaId(id));
export function selectedMediaId(doc=document){return doc.getElementById('source-kind')?.value==='local'?doc.getElementById('local-media-id').value:youtubeId(doc.getElementById('url').value.trim());}
export function selectMediaSource(id,doc=document){
  const local=isLocalMediaId(id),kind=doc.getElementById('source-kind');
  if(kind)kind.value=local?'local':'youtube';
  if(local)doc.getElementById('local-media-id').value=id;else doc.getElementById('url').value=`https://www.youtube.com/watch?v=${id}`;
  showMediaSource(doc);
}
export function showMediaSource(doc=document){
  const local=doc.getElementById('source-kind')?.value==='local';
  if(!doc.getElementById('local-media-controls'))return;
  doc.getElementById('local-media-controls').hidden=!local;doc.getElementById('song-form').hidden=local;
  doc.getElementById('source-description').textContent=local?'本機 MV · 影片留在本機':'YouTube 原生播放';
}
