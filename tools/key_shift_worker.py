"""Render a new pitch-only version from saved stems; never touch the source."""
import argparse
import json
from pathlib import Path
import subprocess


def render(source, target, semitones, report=lambda value: None):
    if type(semitones) is not int or not -12 <= semitones <= 12 or semitones == 0:
        raise ValueError('Key must be a nonzero integer between -12 and 12')
    if source.resolve() == target.resolve():
        raise ValueError('Source and output must differ')
    value = json.loads((source / 'reference.json').read_text(encoding='utf-8'))
    if value.get('pitchShift', 0):
        raise ValueError('Only original-key stems may be transposed')
    stems = ['vocals', 'accompaniment'] + (['lead', 'backing'] if value.get('vocalMode') == 'lead' else [])
    target.mkdir(parents=True, exist_ok=True)
    for i, stem in enumerate(stems):
        report({'stage':'transposing', 'progress':i * 100 / len(stems), 'message':'正在建立變調音軌：' + stem})
        # tempo=1 preserves song-time boundaries. Padding/trimming compensates
        # codec rounding only; Rubber Band accounts for its processing latency.
        filters = f'rubberband=tempo=1:pitch={2 ** (semitones / 12):.12f}:channels=together:pitchq=quality,apad,atrim=duration={value["duration"]:.9f}'
        result = subprocess.run(['ffmpeg','-nostdin','-y','-v','error','-i',str(source/(stem+'.mp3')),
            '-af',filters,'-ar','48000','-c:a','libmp3lame','-b:a','192k',str(target/(stem+'.mp3'))],
            capture_output=True, text=True, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if result.returncode:
            raise RuntimeError('變調失敗，請確認 FFmpeg 支援 rubberband：' + result.stderr[-500:])
        # Decode every result before the library publishes the version.
        subprocess.run(['ffmpeg','-nostdin','-v','error','-xerror','-i',str(target/(stem+'.mp3')),'-f','null','-'],
            check=True, capture_output=True, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    report({'stage':'transposing','progress':100,'message':'變調音軌已完成，正在保存歌曲庫…'})


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--target',type=Path,required=True)
    parser.add_argument('--semitones',type=int,required=True)
    args=parser.parse_args()
    try:
        render(args.source,args.target,args.semitones,lambda value:print(json.dumps(value),flush=True))
    except Exception as error:
        print(json.dumps({'stage':'failed','message':str(error)}),flush=True)
        raise SystemExit(1)
