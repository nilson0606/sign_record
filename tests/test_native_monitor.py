import io
import json
from pathlib import Path
import runpy
import sys
import threading
import time
import types
import unittest
from contextlib import contextmanager
from unittest.mock import patch
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from native_monitor import NativeMonitor, BoundedSpeakerPlayer
import native_capture


def until(predicate, timeout=2):
    end = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > end:
            raise AssertionError("Timed out")
        time.sleep(.005)


class BoundedPlayerTests(unittest.TestCase):
    def make_player(self, available):
        self.requests, self.releases, self.buffers = [], [], []
        def buffer(count):
            self.requests.append(count)
            data = bytearray(count * 2 * 4)
            self.buffers.append(data)
            return [data]
        player = types.SimpleNamespace(_render_available_frames=available,
            _render_buffer=buffer, _render_release=self.releases.append)
        self.now = 0
        def sleep(seconds): self.now += seconds
        def copy_bytes(dest, packet, size): dest[:size] = packet
        return BoundedSpeakerPlayer(player, copy_bytes, clock=lambda: self.now, sleep=sleep)

    def test_short_packet_never_submits_unused_device_buffer(self):
        player = self.make_player(lambda: 2238)
        mono = np.linspace(-.8, .8, 960, dtype=np.float32)
        original = mono.copy()
        player.play(mono)
        self.assertEqual(self.requests, [480, 480])
        self.assertEqual(sum(self.releases), 960)
        np.testing.assert_array_equal(np.frombuffer(b"".join(self.buffers), dtype=np.float32).reshape(-1, 2),
                                      np.repeat(original[:, None], 2, axis=1))
        np.testing.assert_array_equal(mono, original)

    def test_partial_capacity_preserves_every_sample(self):
        capacity = iter([0, 100, 200, 500, 500])
        player = self.make_player(lambda: next(capacity))
        player.play(np.arange(960, dtype=np.float32))
        self.assertEqual(self.requests, [100, 200, 480, 180])
        self.assertEqual(self.releases, self.requests)
        self.assertEqual(sum(self.releases), 960)

    def test_stalled_output_times_out_without_queueing_audio(self):
        player = self.make_player(lambda: 0)
        with self.assertRaises(TimeoutError):
            player.play(np.ones(960, dtype=np.float32))
        self.assertEqual(self.requests, [])


class MonitorTests(unittest.TestCase):
    def make(self, factory=None, **kwargs):
        self.events, self.played, self.opened = [], [], []
        @contextmanager
        def player(device):
            self.opened.append(device)
            yield types.SimpleNamespace(play=lambda pcm: self.played.append(pcm.copy()))
        self.monitor = NativeMonitor(self.events.append, factory or player, **kwargs)
        self.addCleanup(self.monitor.close)
        return self.monitor

    def command(self, sequence, enabled=True, device="speaker", volume=.3):
        self.monitor.command(dict(action="set", sequence=sequence, enabled=enabled, deviceId=device, volume=volume))

    def running(self):
        until(lambda: self.events and self.events[-1]["state"] == "running")

    def test_gain_and_mute_do_not_modify_capture_or_reopen_device(self):
        monitor = self.make()
        original = np.linspace(-1, 1, 960, dtype=np.float32)
        before = original.copy()
        monitor.feed(original)
        self.assertEqual(len(self.played), 0)
        self.command(0); self.running()
        monitor.feed(original); until(lambda: len(self.played) == 1)
        np.testing.assert_array_equal(self.played[0], before * .3)
        np.testing.assert_array_equal(original, before)
        self.command(1, volume=0)
        monitor.feed(original); until(lambda: len(self.played) == 2)
        np.testing.assert_array_equal(self.played[1], np.zeros(960))
        np.testing.assert_array_equal(original, before)
        self.assertEqual(self.opened, ["speaker"])
        self.command(2, enabled=False)
        self.command(1, enabled=True)  # Delayed enable cannot undo a newer stop.
        monitor.feed(original)
        self.assertFalse(monitor.enabled)
        self.assertEqual(len(monitor.queue), 0)

    def test_slow_output_keeps_only_recent_monitor_packets(self):
        entered, release = threading.Event(), threading.Event()
        @contextmanager
        def factory(device):
            def play(pcm):
                self.played.append(pcm.copy())
                if len(self.played) == 1:
                    entered.set(); release.wait(2)
            yield types.SimpleNamespace(play=play)
        monitor = self.make(factory, clock=lambda: 0)
        self.addCleanup(release.set)
        self.command(0, volume=1); self.running()
        original = np.ones(960, dtype=np.float32)
        monitor.feed(original); self.assertTrue(entered.wait(1))
        for i in range(2, 11):
            packet = original * i
            monitor.feed(packet)
            packet[:] = -100  # Monitor owns a separate copy.
        self.assertEqual(len(monitor.queue), 2)
        release.set(); until(lambda: len(self.played) == 3)
        self.assertEqual([float(x[0]) for x in self.played], [1, 9, 10])
        np.testing.assert_array_equal(original, np.ones(960))

    def test_lease_expiration_and_error_stop_only_monitor(self):
        now = [0]
        monitor = self.make(clock=lambda: now[0], lease=.1)
        self.command(0); self.running()
        now[0] = .09
        monitor.command(dict(action="keepalive", sequence=0))
        now[0] = .15
        time.sleep(.03); self.assertTrue(monitor.enabled)
        now[0] = .3
        until(lambda: self.events[-1]["state"] == "error")
        self.assertFalse(monitor.enabled)
        self.assertFalse(monitor.closed)
        self.command(1); self.running()
        self.assertTrue(monitor.enabled)

    def test_expired_monitor_audio_is_not_replayed(self):
        now = [0]; entered, release = threading.Event(), threading.Event()
        @contextmanager
        def factory(device):
            def play(pcm):
                self.played.append(pcm.copy()); entered.set(); release.wait(2)
            yield types.SimpleNamespace(play=play)
        monitor = self.make(factory, clock=lambda: now[0])
        self.addCleanup(release.set)
        self.command(0); self.running()
        monitor.feed(np.ones(960)); self.assertTrue(entered.wait(1))
        monitor.feed(np.ones(960)*2)
        now[0] = .1; release.set()
        until(lambda: len(monitor.queue) == 0)
        self.assertEqual(len(self.played), 1)

    def test_device_open_cancel_and_unplug_do_not_stop_capture(self):
        entered, release = threading.Event(), threading.Event()
        @contextmanager
        def factory(device):
            if device == "slow":
                entered.set(); release.wait(2)
            if device == "gone":
                raise RuntimeError("unplugged")
            self.opened.append(device)
            yield types.SimpleNamespace(play=lambda pcm: self.played.append(pcm.copy()))
        monitor = self.make(factory)
        self.addCleanup(release.set)
        self.command(0, device="slow"); self.assertTrue(entered.wait(1))
        monitor.feed(np.ones(960))
        self.command(1, enabled=False)
        release.set(); time.sleep(.03)
        self.assertEqual(self.played, [])
        self.assertEqual(self.events[-1]["state"], "off")
        self.command(2, device="gone")
        until(lambda: self.events[-1]["state"] == "error")
        self.assertFalse(monitor.closed)
        self.command(3); self.running()
        monitor.feed(np.ones(960)); until(lambda: len(self.played) == 1)

    def test_capture_settings_and_pcm_bytes_preserved(self):
        # Execute the real capture worker against fake hardware, without opening a mic.
        packets = [np.arange(1920, dtype=np.float32).reshape(960, 2) / 1920,
                   np.full((960, 2), -.25, dtype=np.float32)]
        calls, sent = [], []
        class Source:
            buffersize = 24000
            def __enter__(self): return self
            def __exit__(self, *args): pass
        class PacketSource:
            channels = 2
            sample_rate = 48000
            def __init__(self, source):self.position = 0
            def available(self):
                if not packets:raise EOFError("fixture complete")
                return True
            def take(self):
                packet = packets.pop(0)
                position = self.position
                self.position += len(packet)
                return len(packet), 0, position, packet.tobytes()
        def recorder(**kwargs):
            calls.append(kwargs); return Source()
        mic = types.SimpleNamespace(id="usb", name="USB fixture", recorder=recorder)
        backend = types.SimpleNamespace(SoundcardRuntimeWarning=Warning, all_microphones=lambda: [mic], default_microphone=lambda: mic)
        class Monitor:
            def __init__(self, report): pass
            def command(self, command): pass
            def close(self): pass
            def feed(self, pcm): sent.append(pcm.copy())
        binary = io.BytesIO()
        stdout = types.SimpleNamespace(buffer=binary)
        with patch.dict(sys.modules, {"soundcard": backend, "native_monitor": types.SimpleNamespace(NativeMonitor=Monitor)}), patch.object(native_capture, "WasapiPackets", PacketSource), patch.object(sys, "stderr", io.StringIO()), patch.object(sys, "argv", ["native_microphone.py"]), patch.object(sys, "stdin", io.StringIO("")), patch.object(sys, "stdout", stdout):
            with self.assertRaises(EOFError):
                runpy.run_path(str(Path(__file__).resolve().parents[1] / "tools" / "native_microphone.py"), run_name="__main__")
        header, raw = binary.getvalue().split(b"\n", 1)
        self.assertEqual(json.loads(header), dict(label="USB fixture", sampleRate=48000, channels=1, capturePolicy="wasapi-packets-v1"))
        self.assertEqual(calls[0], dict(samplerate=48000, channels=2, blocksize=24000))
        self.assertEqual([len(chunk) for chunk in sent], [960, 960])  # Capacity must not increase delivery latency.
        self.assertEqual(len(calls), 1)  # SoundCard record() must never be called.
        expected = np.concatenate([np.mean(np.arange(1920, dtype=np.float32).reshape(960, 2)/1920, axis=1), np.full(960, -.25, dtype=np.float32)]).astype("<f4")
        self.assertEqual(raw, expected.tobytes())
        np.testing.assert_array_equal(np.concatenate(sent), expected)


if __name__ == "__main__":
    unittest.main()
