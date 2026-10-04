"""Isolated MIDI-SAG worker; no source trimming, vocal resynthesis or time stretching."""
import argparse
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1] / '.runtime/midi-sag'
REPO = ROOT / 'repo'
REVISION = 'b79839ed0cdd0b5e5f39d4cc4a80fcc90002d32f'


def emit(stage, message, **extra):
    print(json.dumps(dict(stage=stage, message=message, **extra), ensure_ascii=False), flush=True)


def command(args, cwd=REPO):
    # Keep dependency output in the job diagnostic stream; JSON stdout is the UI protocol.
    subprocess.run([str(a) for a in args], cwd=cwd, check=True, stdout=sys.stderr,
                   stderr=sys.stderr, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))


def patched_source(source, replacements):
    for old, new in replacements:
        if source.count(old) != 1:
            raise RuntimeError('MIDI-SAG upstream changed; adaptation needs review: ' + old[:70])
        source = source.replace(old, new)
    return source


def run(request):
    import numpy as np
    import soundfile as sf
    import torch
    cfg = json.loads(request.read_text(encoding='utf8'))
    job, settings = request.parent, cfg['settings']
    duration = cfg['end'] - cfg['start']
    plan = cfg['plan']
    if not 1 <= duration <= 600 or not plan or plan[0]['start'] != 0:
        raise ValueError('Invalid generation range or section plan')
    ends = [p['start'] for p in plan[1:]] + [duration]
    if any(not 0 < end - row['start'] <= 22.001 for row, end in zip(plan, ends)):
        raise ValueError('Invalid continuation window')
    if subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], text=True).strip() != REVISION:
        raise RuntimeError('MIDI-SAG code revision mismatch')
    if not torch.cuda.is_available():
        raise RuntimeError('MIDI-SAG 需要可用的 NVIDIA GPU。')
    torch.set_num_threads(4)
    torch.manual_seed(settings['seed'])
    torch.cuda.reset_peak_memory_stats()
    began = time.monotonic()
    voice = job / 'vocal.wav'
    emit('starting', '準備原唱音軌，保留選取範圍的時間位置…')
    command(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-i', cfg['source'], '-ss', cfg['start'],
             '-t', duration, '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', voice])
    if abs(sf.info(voice).duration - duration) > .05:
        raise RuntimeError('原唱音軌長度不完整。')
    # Run each preprocessing stage in its own process so GPU memory is released.
    emit('loading', '分析原唱拍點與停頓…')
    weights = REPO / 'MIDI-SAG_checkpoints'
    command([sys.executable, '-u', Path(__file__).with_name('midi_sag_beat.py'),
             '--audio_path', voice, '--model_path', weights/'vocal_beat_detector.pt',
             '--use_vad', '--fill_silence', '--vad_merge_gap', '3.0', '--first_bpm_margin', '10',
             '--output_dir', job/'beats'])
    emit('loading', '將原唱旋律轉成音符…')
    command([sys.executable, '-u', REPO/'GAME/infer.py', 'extract', voice,
             '-m', REPO/'GAME/GAME-1.0-medium/model.pt', '--output-dir', job/'midi'])
    beatdir = job / 'beats/vocal'
    beatfile = beatdir / 'vocal_beat_times.txt'
    downbeatfile = beatdir / 'vocal_downbeat_times.txt'
    emit('loading', '依旋律與指定調性安排和弦…')
    command([sys.executable, '-u', REPO/'AccoMontage2/demo_SOME.py',
             '--midi_path', job/'midi/vocal.mid', '--beat_file', beatfile,
             '--beat_file_detected', beatdir/'vocal_beat_times_detected_only.txt',
             '--output_dir', job/'harmony', '--beat_subdivision', '1', '--downbeat_phase', 'None',
             '--chord_style', settings['chordStyle'], '--chords_per_bar', settings['chordsPerBar'],
             '--key', settings['key']])
    emit('loading', '載入 MIDI-SAG 編曲模型…')
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', TOKENIZERS_PARALLELISM='false')
    modulepath = REPO / 'MuseControlLite'
    sys.path.insert(0, str(modulepath))
    script = modulepath / 'MuseControlLite_inference_continuation.py'
    source = script.read_text(encoding='utf8')
    # Preserve the pinned checkout; adapt integration and release completed GPU waveforms.
    source = patched_source(source, [
        ('generator = torch.Generator().manual_seed(42)', 'generator = torch.Generator().manual_seed(config["seed"])'),
        ('\n    random.seed(42)', '\n    random.seed(config["seed"])'),
        ('np.random.seed(42)', 'np.random.seed(config["seed"])'),
        ('torch.cuda.manual_seed_all(42)', 'torch.cuda.manual_seed_all(config["seed"])'),
        ('pipe = pipe.to("cuda")', 'pipe.enable_model_cpu_offload()'),
        ('audio_mid_s = structure_starts_seconds[segments+1]', 'audio_mid_s = config["structure_ends_seconds"][segments]'),
        ('                print(f"backing audio length {backing_audio.shape[1]/44100} seconds")',
         '                del tensors[str(segments)], waveform\n                print(f"backing audio length {backing_audio.shape[1]/44100} seconds")'),
        ('print(f"Generating segment {segments + 1}/{len(config[\'structure_tag\'])}")',
         'report_segment(segments, len(config["structure_tag"]))'),
        ('generator=generator,', 'generator=generator,\n                    callback=lambda step, timestep, latents: report_step(segments, len(config["structure_tag"]), step + 1, config["denoise_step"]),'),
        ('mix = mix_audio(waveform_vocal, backing_audio, target_dbfs=-18.0, out_peak_dbfs=-1.0)',
         'sf.write(config["stem_output"], backing_audio.T.float().cpu().numpy(), pipe.vae.sampling_rate)\n        mix = mix_audio(waveform_vocal, backing_audio, target_dbfs=-18.0, out_peak_dbfs=-1.0)'),
    ])
    source = source.replace('from_pretrained("stabilityai/stable-audio-open-1.0",',
                            'from_pretrained(' + repr(str(ROOT/'base-model')) + ', local_files_only=True,')
    namespace = {'__name__': 'midi_sag_adapted', '__file__': str(script),
                 'report_segment': lambda i,n: emit('generating', f'生成第 {i+1}／{n} 段配樂…', progress=round(100*i/n, 1))}
    # Third-party diagnostic prints must not corrupt the JSON event channel.
    from contextlib import redirect_stdout
    with redirect_stdout(sys.stderr):
        exec(compile(source, str(script), 'exec'), namespace)
        namespace['RMVPE_CKPT'] = str(weights/'rmvpe_model.pt')
        namespace['F0_MELODY_CKPT'] = str(weights/'melody_encoder.pt')
        original_stdout = sys.__stdout__
        def report(i,n):
            print(json.dumps({'stage':'generating','message':f'生成第 {i+1}／{n} 段配樂…',
                              'progress':round(100*i/n,1)},ensure_ascii=False), file=original_stdout, flush=True)
        namespace['report_segment'] = report
        def report_step(i,n,step,steps):
            print(json.dumps({'stage':'generating','message':f'第 {i+1}／{n} 段 · {step}／{steps} 步',
                              'progress':round(100*(i+min(step/steps,1))/n,1)},ensure_ascii=False), file=original_stdout, flush=True)
        namespace['report_step'] = report_step
        config = namespace['get_config']()
        config.update(vocal_audio_file=str(voice), vocal_beat_file=str(beatfile), vocal_downbeat_file=str(downbeatfile),
                      vocal_midi_file=None, chord_info=str(job/'harmony/btc_txt/vocal_chord_gen.txt'),
                      checkpoint_path=str(weights/'MuseControlLite_checkpoint'), output_dir=str(job/'generated')+'/',
                      structure_starts=[r['start'] for r in plan], structure_tags=[r['tag'] for r in plan],
                      structure_prompts=[cfg['caption']]*len(plan), text_prompt=cfg['caption'],
                      seed=settings['seed'], stem_output=str(job/'stem.wav'), weight_dtype='fp16')
        namespace['main'](config)
    emit('finalizing', '檢查獨立配樂與時間長度…')
    command(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-i', job/'stem.wav', '-ar', '48000', '-ac', '2', job/'resampled.wav'])
    audio, sr = sf.read(job/'resampled.wav', dtype='float32', always_2d=True)
    expected, generated = round(duration*48000), len(audio)
    if sr != 48000 or not np.isfinite(audio).all() or abs(expected-generated) > 4800:
        raise RuntimeError('配樂長度偏離原唱超過 100 ms，未接受此次結果。')
    audio = np.pad(audio[:expected], ((0,max(0,expected-generated)),(0,0)))
    peak = float(np.max(np.abs(audio)))
    if peak < .0001:
        raise RuntimeError('配樂接近靜音。')
    audio *= min(1, .98/peak)
    sf.write(job/'clip.wav', audio, sr, subtype='PCM_16')
    full = np.zeros((round(cfg['sourceSeconds']*sr),2), dtype='float32')
    offset = round(cfg['start']*sr)
    full[offset:offset+min(len(audio),len(full)-offset)] = audio[:min(len(audio),len(full)-offset)]
    sf.write(job/'aligned.wav', full, sr, subtype='PCM_16')
    report = {k:cfg[k] for k in ['cacheId','title','videoId','start','end','sourceSeconds','settings','caption','plan']}
    report.update(model='MIDI-SAG', codeRevision=REVISION, sampleRate=sr, outputSamples=expected,
                  generatedSamples=generated, elapsedSeconds=round(time.monotonic()-began,2), alignmentVerified=False,
                  gpu=torch.cuda.get_device_name(), peakAllocatedMiB=round(torch.cuda.max_memory_allocated()/1048576),
                  peakReservedMiB=round(torch.cuda.max_memory_reserved()/1048576))
    (job/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    emit('ready', '配樂生成完成，請試聽和聲與段落銜接。')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf8')
    sys.stderr.reconfigure(encoding='utf8')
    parser=argparse.ArgumentParser()
    parser.add_argument('--request',type=Path,required=True)
    args=parser.parse_args()
    try:
        run(args.request.resolve())
    except Exception as e:
        import traceback
        traceback.print_exc()
        emit('failed',str(e)[-600:])
        sys.exit(1)
