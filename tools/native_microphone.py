"""Local-only PCM capture. No audio files are written."""
import argparse,json,sys,warnings,threading
import numpy as np
import soundcard as sc
from native_monitor import NativeMonitor
warnings.simplefilter('ignore', sc.SoundcardRuntimeWarning)
p=argparse.ArgumentParser()
p.add_argument('--list',action='store_true')
p.add_argument('--outputs',action='store_true')
p.add_argument('--device',default='')
a=p.parse_args()
if a.list:
    print(json.dumps({'devices':[{'deviceId':m.id,'label':m.name,'kind':'audioinput'} for m in sc.all_microphones()]}))
elif a.outputs:
    print(json.dumps({'devices':[{'deviceId':s.id,'label':s.name,'kind':'audiooutput'} for s in sc.all_speakers()]}))
else:
    devices=sc.all_microphones()
    mic=next((m for m in devices if m.id==a.device),None) if a.device else sc.default_microphone()
    if mic is None: raise RuntimeError('Selected microphone is no longer available')
    def report(value):
        sys.stderr.write(json.dumps(value,ensure_ascii=True)+'\n')
        sys.stderr.flush()
    monitor=NativeMonitor(report)
    def controls():
        try:
            for line in sys.stdin:
                try:
                    command=json.loads(line)
                    if isinstance(command,dict): monitor.command(command)
                except (ValueError,TypeError): pass
        finally:
            monitor.close()
    threading.Thread(target=controls,daemon=True,name='monitor-controls').start()
    try:
        # Original recording capture settings and wire format are preserved.
        with mic.recorder(samplerate=48000,channels=2,blocksize=960) as source:
            out=sys.stdout.buffer
            out.write((json.dumps({'label':mic.name,'sampleRate':48000,'channels':1})+'\n').encode())
            out.flush()
            while True:
                frames=source.record(numframes=960)
                mono=np.mean(frames,axis=1).astype('<f4')
                out.write(mono.tobytes());out.flush()
                monitor.feed(mono)
    finally:
        monitor.close()
