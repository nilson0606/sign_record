"""Opt-in physical microphone check; discard all PCM without saving audio.

Run with the project's Python environment, --device containing a device ID or
part of its label. Unlike unit tests, this opens the selected microphone.
"""
import argparse
import json
import math
from pathlib import Path
import subprocess
import sys
import threading
import time

parser = argparse.ArgumentParser()
parser.add_argument('--device', default='')
parser.add_argument('--seconds', type=float, default=120)
args = parser.parse_args()
if not math.isfinite(args.seconds) or not 1 <= args.seconds <= 600:
    parser.error('--seconds must be between 1 and 600')
root = Path(__file__).resolve().parents[1]
worker = root / 'tools' / 'native_microphone.py'
flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
devices = json.loads(subprocess.check_output(
    [sys.executable, '-X', 'utf8', str(worker), '--list'], creationflags=flags))['devices']
device = next((d for d in devices if args.device in (d['deviceId'], d['label'])
               or args.device and args.device in d['label']), None) if args.device else None
if args.device and not device:
    parser.error('Selected device was not found')
events = []
process = subprocess.Popen([sys.executable, '-X', 'utf8', str(worker), '--device',
                            device['deviceId'] if device else ''],
                           stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, creationflags=flags)
def diagnostics():
    for line in process.stderr:
        try:
            events.append(json.loads(line))
        except ValueError:
            pass
reader = threading.Thread(target=diagnostics, daemon=True)
reader.start()
watchdog = threading.Timer(args.seconds + 30, process.kill)
watchdog.start()
try:
    header = process.stdout.readline()
    meta = json.loads(header)
    assert meta['sampleRate'] == 48000 and meta['channels'] == 1, meta
    start = time.monotonic()
    total = 0
    first_ms = None
    target = math.ceil(args.seconds * 48000) * 4
    while total < target:
        data = process.stdout.read(min(3840, target - total))
        if not data:
            raise AssertionError(f'Capture ended at {total / 192000:.3f} seconds: {events}')
        total += len(data)
        if first_ms is None:
            first_ms = round((time.monotonic() - start) * 1000, 2)
    elapsed = time.monotonic() - start
finally:
    watchdog.cancel()
    if process.poll() is None:
        process.terminate()
    process.wait(timeout=10)
    reader.join(timeout=2)
assert not any(e.get('event') == 'error' for e in events), events
configuration = next(e for e in events if e.get('event') == 'configured')
assert configuration['bufferFrames'] >= 24000, configuration
assert configuration['deliveryFrames'] == 960, configuration
assert abs(total / 192000 - elapsed) < 1, (total, elapsed)
print(json.dumps({'device': meta['label'], 'seconds': total / 192000,
                  'elapsed': round(elapsed, 3), 'firstPCMms': first_ms,
                  'configuration': configuration, 'events': events}, ensure_ascii=True))
