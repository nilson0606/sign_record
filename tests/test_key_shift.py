import array
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from key_shift_worker import render


@unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg required')
class KeyAudioTests(unittest.TestCase):
    def test_pitch_changes_but_timing_source_and_both_stems_are_preserved(self):
        with tempfile.TemporaryDirectory(prefix='karaoke-key-audio-') as folder:
            root=Path(folder)
            rate=48000
            pcm=array.array('h',(int(9000*math.sin(2*math.pi*440*i/rate)) if .5<=i/rate<3.5 else 0 for i in range(rate*4)))
            with wave.open(str(root/'input.wav'),'wb') as wav:
                wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(rate);wav.writeframes(pcm.tobytes())
            subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(root/'input.wav'),str(root/'vocals.mp3')],check=True,capture_output=True)
            shutil.copyfile(root/'vocals.mp3',root/'accompaniment.mp3')
            (root/'reference.json').write_text(json.dumps({'duration':4,'vocalMode':'all'}),encoding='utf-8')
            original=hashlib.sha256((root/'vocals.mp3').read_bytes()).hexdigest()
            for shift in [-12,3,12]:
                target=root/str(shift);render(root,target,shift)
                for stem in ['vocals','accompaniment']:
                    result=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(target/(stem+'.mp3')),'-f','f32le','-ac','1','-ar',str(rate),'-'],check=True,capture_output=True)
                    values=array.array('f');values.frombytes(result.stdout)
                    self.assertEqual(len(values),rate*4)
                    # Measure a stable region and the leading/trailing silence:
                    # changing pitch must neither change tempo nor shift lyrics.
                    tone=values[rate:rate*3]
                    crossings=sum(tone[i-1]<=0<tone[i] for i in range(1,len(tone)))
                    self.assertLess(abs(crossings/2/(440*2**(shift/12))-1),.02)
                    active=[i for i,v in enumerate(values) if abs(v)>.04]
                    self.assertLess(abs(active[0]/rate-.5),.06)
                    self.assertLess(abs(active[-1]/rate-3.5),.06)
            self.assertEqual(hashlib.sha256((root/'vocals.mp3').read_bytes()).hexdigest(),original)


if __name__ == '__main__':
    unittest.main()
