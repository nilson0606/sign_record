// Editing starting points, never effects applied during capture or archive migration.
export const recordingSceneDefaultsVersion='hall-echo-v1';
const sceneFilenameLabels={intimate:'貼近耳邊',acoustic:'木吉他',hall:'大廳一般流行',pop:'明亮流行',ballad:'大廳慢板抒情',sacred:'教堂',concert:'演唱會',dream:'夢幻',custom:'自訂'};
export function recordingSceneSuffix(meta){
  // Only explicitly saved new metadata opts in; old names are never inferred retroactively.
  const saved=meta.postScene;
  return saved?.version===1&&Object.hasOwn(sceneFilenameLabels,saved.id)?`情境_${sceneFilenameLabels[saved.id]}`:'';
}
const echo=(amount=0,timeMs=300,repeats=3,feedback=40,pingPong=false)=>({amount,timeMs,repeats,feedback,pingPong});
const scene=(label,space,reverb,decay,preDelayMs,brightness,width,delay=echo())=>({label,effects:{reverb,reverbOptions:{space,decay,preDelayMs},reverbTone:{brightness,width},echo:delay}});
export const recordingScenes={
  intimate:scene('貼近耳邊 · 清楚自然','studio',10,.4,10,-10,50),
  acoustic:scene('木吉他 · 輕聲演唱','room',15,.6,15,-5,70),
  hall:scene('大廳 · 一般流行（預設）','hall',20,1.8,25,0,100,echo(10)),
  pop:scene('明亮流行 · 人聲突出','plate',18,1.2,35,10,90),
  ballad:scene('大廳 · 慢板抒情','hall',25,2.6,50,-10,100,echo(10)),
  sacred:scene('教堂 · 莊嚴長尾','church',25,4.2,60,-20,100),
  concert:scene('演唱會 · 寬大舞台','arena',25,3.2,65,-10,100),
  dream:scene('夢幻 · 空靈回聲','dream',30,3.6,80,5,100,echo(12,600,3,30,true)),
};
export function initialRecordingEffects(row){
  if(row?.vocalEffects)return structuredClone(row.vocalEffects);
  if(row?.postDefaults===recordingSceneDefaultsVersion)return structuredClone(recordingScenes.hall.effects);
  // Keep the previous editor defaults for existing recordings, regardless of date.
  return {reverb:20,reverbOptions:{space:'hall',decay:1.8,preDelayMs:25}};
}
export function matchingRecordingScene(value){
  return Object.entries(recordingScenes).find(([,s])=>{
    const p=s.effects;
    return value.reverb===p.reverb
      &&['space','decay','preDelayMs'].every(k=>value.reverbOptions?.[k]===p.reverbOptions[k])
      &&(value.reverbTone?.brightness??0)===p.reverbTone.brightness
      &&(value.reverbTone?.width??100)===p.reverbTone.width
      &&Object.entries(p.echo).every(([k,v])=>(value.echo?.[k]??echo()[k])===v);
  })?.[0]??'';
}
