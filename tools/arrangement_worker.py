"""Local instrumental Cover generation; original singer is never sent to the model."""
import argparse,json,os,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'.runtime/acestep';REPO=ROOT/'ACE-Step-1.5'
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',ACESTEP_PROJECT_ROOT=str(ROOT),ACESTEP_CHECKPOINTS_DIR=str(ROOT/'checkpoints'),TOKENIZERS_PARALLELISM='false')
sys.path.insert(0,str(REPO))
def emit(stage,message,**kw):print(json.dumps({'stage':stage,'message':message,**kw},ensure_ascii=False),flush=True)
def run(request):
    emit('starting','準備指定範圍的原伴奏…')
    import numpy as np
    import soundfile as sf
    import torch
    cfg=json.loads(request.read_text(encoding='utf8'));job=request.parent;s=cfg['settings'];duration=cfg['end']-cfg['start']
    if not 1<=duration<=600 or not .3<=s['strength']<=1:raise ValueError('生成範圍或參考強度無效。')
    subprocess.run(['ffmpeg','-nostdin','-y','-v','error','-i',cfg['source'],'-ss',str(cfg['start']),'-t',str(duration),'-ar','48000','-ac','2','-c:a','pcm_s16le',str(job/'input.wav')],check=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    source,sr=sf.read(job/'input.wav',always_2d=True,dtype='float32');expected=round(duration*48000)
    if abs(len(source)-expected)>4800 or not np.isfinite(source).all():raise ValueError('原伴奏長度不完整。')
    if not torch.cuda.is_available():raise RuntimeError('配樂模型需要可用的 NVIDIA GPU。')
    torch.set_num_threads(4)
    emit('loading','載入 ACE-Step 配樂模型…')
    # Cover does not use the 5Hz language model. Verify only the three components actually loaded.
    import acestep.model_downloader as downloader
    downloader.MAIN_MODEL_COMPONENTS=['acestep-v15-turbo','vae','Qwen3-Embedding-0.6B']
    from acestep.handler import AceStepHandler
    from acestep.inference import GenerationParams,GenerationConfig,generate_music
    handler=AceStepHandler()
    message,ok=handler.initialize_service(project_root=str(ROOT),config_path='acestep-v15-turbo',device='cuda',use_flash_attention=False,compile_model=False,offload_to_cpu=True,offload_dit_to_cpu=True,quantization=None,use_mlx_dit=False)
    if not ok:raise RuntimeError('模型初始化失敗：'+str(message)[-350:])
    params=GenerationParams(task_type='cover',src_audio=str(job/'input.wav'),caption=cfg['caption'],lyrics='[Instrumental]',instrumental=True,duration=duration,seed=s['seed'],audio_cover_strength=s['strength'],inference_steps=8,guidance_scale=1.0,thinking=False,use_cot_metas=False,use_cot_caption=False,use_cot_language=False,use_cot_lyrics=False,enable_normalization=False,dcw_enabled=False)
    # BPM is an additional hint; the original accompaniment supplies the actual timing and harmony.
    if isinstance(cfg.get('bpm'),(int,float)) and 30<=cfg['bpm']<=300:params.bpm=round(cfg['bpm'])
    def progress(value,desc='',**kw):
        if isinstance(value,tuple):value=value[0]/max(1,value[1])
        if isinstance(value,(int,float)):emit('generating','正在依原伴奏重新編曲…',progress=round(float(value)*100,1))
    start=time.monotonic();emit('generating','正在依原伴奏重新編曲…',progress=0)
    with torch.inference_mode():result=generate_music(handler,None,params,GenerationConfig(batch_size=1,use_random_seed=False,seeds=[s['seed']],audio_format='wav'),save_dir=str(job/'generated'),progress=progress)
    if not result.success or not result.audios:raise RuntimeError(str(result.error or result.status_message)[-500:])
    emit('finalizing','檢查音檔長度，保存配樂時間位置…')
    audio,rate=sf.read(result.audios[0]['path'],dtype='float32',always_2d=True)
    if rate!=48000:raise RuntimeError('模型取樣率不符。')
    generated_samples=len(audio)
    if abs(len(audio)-expected)>48000 or not np.isfinite(audio).all():raise RuntimeError('生成長度偏離選取範圍，未接受這次結果。')
    audio=audio[:expected];audio=np.pad(audio,((0,max(0,expected-len(audio))),(0,0)))
    if audio.shape[1]==1:audio=np.repeat(audio,2,axis=1)
    peak=float(np.max(np.abs(audio)))
    if peak<.0001:raise RuntimeError('生成配樂接近靜音。')
    audio*=min(1,.98/max(peak,1e-8));sf.write(job/'clip.wav',audio,48000,subtype='PCM_16')
    # Aligned archive track allows existing non-destructive post-production to use song timestamps.
    full=np.zeros((round(cfg['sourceSeconds']*48000),2),dtype='float32');offset=round(cfg['start']*48000);n=min(len(audio),len(full)-offset);full[offset:offset+n]=audio[:n]
    sf.write(job/'aligned.wav',full,48000,subtype='PCM_16')
    report={k:cfg[k] for k in ['cacheId','title','videoId','start','end','sourceSeconds','settings','caption']}
    report.update(model='ACE-Step-1.5-turbo',sampleRate=48000,outputSamples=expected,generatedSamples=generated_samples,elapsedSeconds=round(time.monotonic()-start,2),alignmentVerified=False,codeRevision='ca1e85fe9430179831e6bc6be790c332190a3866')
    (job/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');emit('ready','配樂生成完成。')
if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf8');sys.stderr.reconfigure(encoding='utf8');p=argparse.ArgumentParser();p.add_argument('--request',type=Path,required=True);a=p.parse_args()
    try:run(a.request.resolve())
    except Exception as e:
        import traceback
        traceback.print_exc();emit('failed',str(e)[-600:]);sys.exit(1)
