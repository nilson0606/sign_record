"""Local RVC conversion using existing personal models; no capture dependencies changed."""
import argparse,json,os,sys,time
from pathlib import Path

def emit(stage,message,**extra):
    print(json.dumps(dict(stage=stage,message=message,**extra),ensure_ascii=False),flush=True)

def convert(request):
    settings=json.loads(request.read_text(encoding='utf-8'));job=request.parent
    pitch=settings['pitchShift'];index_rate=settings['indexRate'];protect=settings['protect']
    if type(pitch) is not int or pitch not in (-12,0,12):raise ValueError('歌聲只可選低八度、原八度或高八度。')
    if not 0<=index_rate<=1 or not 0<=protect<=.5:raise ValueError('檢索／保護設定無效。')
    home=Path(settings['applioHome']);model=Path(settings['modelPath']);index=Path(settings['indexPath'])
    for file in [model,index,home/'rvc/models/embedders/contentvec/pytorch_model.bin',home/'rvc/models/embedders/contentvec/config.json',home/'rvc/models/predictors/rmvpe.pt']:
        if not file.is_file():raise ValueError(f'本機模型檔案不存在：{file.name}')
    os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
    os.chdir(home);sys.path.insert(0,str(home))
    emit('loading','載入 RVC 與個人音色模型…')
    import numpy as np
    import soundfile as sf
    import soxr
    import torch
    from rvc.infer.infer import VoiceConverter
    a,rate=sf.read(job/'input.wav',dtype='float32',always_2d=True)
    if rate!=48000 or a.shape[1]!=1 or not 1<=len(a)/rate<=600 or not np.isfinite(a).all():raise ValueError('需要 1 秒～10 分鐘的 48 kHz 單聲道人聲。')
    a=a[:,0]
    if np.max(np.abs(a))<.001:raise ValueError('來源人聲接近靜音，請選擇有演唱的區段。')
    if not torch.cuda.is_available():raise RuntimeError('Voice Lab 需要可用的 NVIDIA GPU。')
    started=time.monotonic();converter=VoiceConverter()
    emit('converting','正在轉換歌聲，維持來源節奏；長段落需要較多時間…')
    converter.convert_audio(audio_input_path=str(job/'input.wav'),audio_output_path=str(job/'converted.wav'),
        model_path=str(model),index_path=str(index),pitch=pitch,f0_method='rmvpe',index_rate=index_rate,
        volume_envelope=1.0,protect=protect,split_audio=False,f0_autotune=False,proposed_pitch=False,
        clean_audio=False,post_process=False,resample_sr=0,export_format='WAV')
    emit('finalizing','檢查音訊長度並整理試聽成品…')
    result,native_rate=sf.read(job/'converted.wav',dtype='float32',always_2d=True)
    if result.shape[1]!=1 or not np.isfinite(result).all():raise ValueError('輸出音訊數值或聲道異常。')
    result=soxr.resample(result[:,0],native_rate,rate,quality='HQ')
    difference=len(result)-len(a)
    if abs(difference)>rate*.1:raise ValueError(f'輸出長度差異 {difference/rate:.3f} 秒，未接受結果。')
    # RVC rounds to feature frames. Only reconcile a small tail; never stretch timing.
    result=result[:len(a)] if difference>=0 else np.pad(result,(0,-difference))
    peak=float(np.max(np.abs(result)))
    if peak<.0001:raise ValueError('轉換結果接近靜音，請調整來源或模型。')
    scale=min(1,.98/peak)
    sf.write(job/'source.wav',a,rate,subtype='PCM_16');sf.write(job/'result.wav',result*scale,rate,subtype='PCM_16')
    public={k:settings[k] for k in ['model','pitchShift','indexRate','protect']}
    report=dict(model='RVC-v2',settings=public,sampleRate=rate,nativeSampleRate=native_rate,
        sourceSamples=len(a),outputSamples=len(result),tailAdjustmentSamples=-difference,
        seconds=len(a)/rate,elapsedSeconds=round(time.monotonic()-started,2),pitchShift=pitch,
        autoShift=False,peakScale=scale,alignmentVerified=False)
    (job/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    emit('ready','Voice Lab 轉換完成。')

if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8');sys.stderr.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser();parser.add_argument('--request',type=Path,required=True);args=parser.parse_args()
    try:convert(args.request.resolve())
    except Exception as error:
        import traceback
        traceback.print_exc();emit('failed',str(error)[-600:]);sys.exit(1)
