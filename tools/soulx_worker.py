"""Isolated SoulX experiment: local audio only, immutable source timing."""
import argparse, gc, importlib.util, json, os, sys, time
from pathlib import Path
from soulx_progress import segment_progress
ROOT=Path(__file__).resolve().parents[1]
RUNTIME=ROOT/'.runtime/soulx';REPO=RUNTIME/'SoulX-Singer'
os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
sys.path.insert(0,str(REPO))
def emit(stage,message,**kw):print(json.dumps({'stage':stage,'message':message,**kw},ensure_ascii=False),flush=True)
def convert(request):
    emit('starting','啟動本機推論環境…')
    import numpy as np
    import soundfile as sf
    import librosa
    import torch
    from omegaconf import OmegaConf
    from transformers import WhisperModel,WhisperFeatureExtractor
    settings=json.loads(request.read_text(encoding='utf8'));job=request.parent
    steps=settings['steps'];guidance=settings['guidance'];seed=settings['seed']
    pitch_shift=settings.get('pitchShift',0)
    if type(pitch_shift) is not int or not -12<=pitch_shift<=12:raise ValueError('歌聲移調需為 -12～+12 的整數半音。')
    settings['pitchShift']=pitch_shift
    if not 8<=steps<=64 or not 0<=guidance<=5 or not 0<=seed<=2147483647:raise ValueError('生成參數超出範圍。')
    def read(p):
        x,rate=sf.read(p,dtype='float32',always_2d=True);x=x.mean(axis=1)
        return librosa.resample(x,orig_sr=rate,target_sr=24000) if rate!=24000 else x
    a=read(job/'input.wav')
    if not 1<=len(a)/24000<=600 or not np.isfinite(a).all():raise ValueError('人聲需要 1 秒～10 分鐘。')
    if np.max(np.abs(a))<.001:raise ValueError('這段人聲接近靜音，請選擇有演唱的區段。')
    key=settings['reference']
    if key in ['self','custom','original']:p=read(job/'reference.wav')
    elif key in ['zh','en']:
        ref=read(REPO/'example/audio'/f'{key}_prompt.mp3')
        start=settings.get('referenceStart') or 0;end=start+settings['referenceSeconds']
        if end>len(ref)/24000+.001:raise ValueError(f'官方參考只有 {len(ref)/24000:.2f} 秒，請縮短參考範圍。')
        p=ref[round(start*24000):round(end*24000)]
    else:raise ValueError('參考歌聲不存在。')
    if not 3<=len(p)/24000<=30 or not np.isfinite(p).all() or np.sqrt(np.mean(p*p))<.001:raise ValueError('參考需為 3～30 秒清楚的乾人聲，請改選有聲區段。')
    if not torch.cuda.is_available():raise RuntimeError('SoulX 需要可用的 NVIDIA GPU。')
    emit('pitch','分析原始旋律與時間位置…')
    spec=importlib.util.spec_from_file_location('soulx_f0',REPO/'preprocess/tools/f0_extraction.py')
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    ext=mod.F0Extractor(str(RUNTIME/'weights/Soul-AILab/SoulX-Singer-Preprocess/rmvpe/rmvpe.pt'),device='cuda',max_duration=1800,verbose=False)
    pitch_total=(len(a)+479)//480+(len(p)+479)//480;pitch_done=0
    def pitch(x):
        nonlocal pitch_done
        frames=(len(x)+479)//480;result=np.zeros(frames,dtype='float32')
        for start in range(0,frames,1000):
            end=min(frames,start+1000);left=max(0,start-50);right=min(frames,end+50)
            chunk=librosa.resample(x[left*480:min(len(x),right*480)],orig_sr=24000,target_sr=16000)
            f=ext.model.infer_from_audio(chunk,thred=.03);ids=np.arange(start-left,end-left)*2
            result[start:end]=f[np.minimum(ids,len(f)-1)]
            pitch_done+=end-start
            emit('pitch','分析原曲與參考歌聲的旋律…',progress={'completed':pitch_done,'total':pitch_total,'unit':'frames'})
        return result
    fa=pitch(a);fp=pitch(p)
    if np.mean(fp>0)<.1:raise ValueError('參考歌聲缺少可辨識音高，請換一段乾人聲。')
    del ext;gc.collect();torch.cuda.empty_cache()
    emit('loading','載入 SoulX-Singer-SVC…')
    from soulxsinger.models.modules import whisper_encoder
    def local_whisper(self,device=None):
        folder=RUNTIME/'weights/openai/whisper-base'
        self.fe=WhisperFeatureExtractor.from_pretrained(folder,local_files_only=True)
        self.model=WhisperModel.from_pretrained(folder,local_files_only=True).eval().to('cuda')
    whisper_encoder.WhisperEncoder.__init__=local_whisper
    from soulxsinger.models.soulxsinger_svc import SoulXSingerSVC
    model=SoulXSingerSVC(OmegaConf.load(REPO/'soulxsinger/config/soulxsinger.yaml'))
    checkpoint=torch.load(RUNTIME/'weights/Soul-AILab/SoulX-Singer/model-svc.pt',weights_only=True,map_location='cpu',mmap=True)
    model.load_state_dict(checkpoint['state_dict'],strict=True);del checkpoint
    model.eval().half().to('cuda');model.mel.float()
    torch.manual_seed(seed);start=time.monotonic();emit('converting','依原時間位置產生歌聲…')
    with torch.inference_mode(), segment_progress(model,emit,torch.cuda.synchronize) as progress:
        result,shift=model.infer(pt_wav=torch.from_numpy(p)[None].cuda(),gt_wav=torch.from_numpy(a)[None].cuda(),pt_f0=torch.from_numpy(fp)[None].cuda(),gt_f0=torch.from_numpy(fa)[None].cuda(),auto_shift=False,pitch_shift=pitch_shift,n_steps=steps,cfg=guidance,use_fp16=True)
    emit('finalizing','轉換完成，檢查長度並輸出音檔…')
    result=result.detach().float().cpu().numpy().reshape(-1)
    if len(result)!=len(a) or not np.isfinite(result).all():raise ValueError('輸出長度或數值異常，未接受這次結果。')
    peak=float(np.max(np.abs(result)));scale=min(1,.98/max(peak,1e-8))
    if peak<.0001:raise ValueError('生成歌聲接近靜音，請換參考或參數。')
    sf.write(job/'source.wav',a,24000,subtype='PCM_16');sf.write(job/'result.wav',result*scale,24000,subtype='PCM_16')
    report={'model':'SoulX-Singer-SVC','settings':settings,'sampleRate':24000,'sourceSamples':len(a),'outputSamples':len(result),'seconds':len(a)/24000,'elapsedSeconds':round(time.monotonic()-start,2),'pitchShift':shift,'autoShift':False,'peakScale':scale,'alignmentVerified':False,'codeRevision':'81aeb3ae772c70093c3de74dc23c92d983801ae4'}
    report['referenceSamples']=len(p);report['referenceSeconds']=len(p)/24000
    report['convertedSegments']=progress['completed']
    (job/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');emit('ready','SoulX 試聽完成。')
if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf8');sys.stderr.reconfigure(encoding='utf8')
    parser=argparse.ArgumentParser();parser.add_argument('--request',type=Path,required=True);args=parser.parse_args()
    try:convert(args.request.resolve())
    except Exception as error:
        import traceback
        traceback.print_exc();emit('failed',str(error)[-600:]);sys.exit(1)
