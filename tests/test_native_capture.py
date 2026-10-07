import struct
import sys
import unittest
import types
from unittest.mock import patch
from collections import deque
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from native_capture import ContinuousCapture, WasapiPackets, CaptureInterrupted, SILENT, DISCONTINUITY, TIMESTAMP_ERROR


def pcm(count, value=.25):
    return struct.pack("<" + "f" * count * 2, *[value] * count * 2)


class Clock:
    def __init__(self, wake_delay=.001):
        self.now = 0
        self.wake_delay = wake_delay

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += self.wake_delay


class Packets:
    channels = 2
    sample_rate = 48000

    def __init__(self, clock, packets):
        self.clock, self.packets = clock, deque(packets)

    def available(self):
        return bool(self.packets and self.clock() >= self.packets[0][0])

    def take(self):
        return self.packets.popleft()[1]


class CaptureTests(unittest.TestCase):
    def capture(self, packets, wake_delay=.001):
        clock = Clock(wake_delay)
        self.events = []
        stream = ContinuousCapture(Packets(clock, packets), self.events.append,
                                   clock=clock, sleep=clock.sleep, startup_timeout=.1)
        return stream, clock

    def test_delayed_wakeup_reads_ready_audio_without_inventing_zeros(self):
        for delay in [.045, .068291667, .080]:
            with self.subTest(delay=delay):
                first, second = pcm(960), pcm(960, -.125)
                stream, _ = self.capture([(0, (960, DISCONTINUITY, 100, first)),
                                          (.02, (960, 0, 1060, second))], delay)
                self.assertEqual(stream.read(960), first)
                self.assertEqual(stream.read(960), second)
                self.assertEqual(stream.frames, 1920)
                self.assertTrue(any(e['event'] == 'delayed-packet' for e in self.events))

    def test_fragmented_and_empty_packets_preserve_exact_samples(self):
        first, second = pcm(137), pcm(1200, -.25)
        stream, _ = self.capture([(0, (137, 0, 0, first)), (0, (0, 0, 137, b'')),
                                  (.02, (1200, 0, 137, second))])
        self.assertEqual(stream.read(960) + stream.read(377), first + second)

    def test_timeout_is_terminal_and_never_returns_fabricated_pcm(self):
        stream, clock = self.capture([(0, (960, 0, 0, pcm(960)))])
        stream.read(960)
        with self.assertRaisesRegex(CaptureInterrupted, '未以靜音補入'):
            stream.read(960)
        self.assertGreaterEqual(clock(), .1)
        stream.packets.packets.append((clock(), (960, 0, 960, pcm(960))))
        with self.assertRaises(CaptureInterrupted):
            stream.read(960)
        self.assertEqual(len([e for e in self.events if e['event'] == 'error']), 1)

    def test_discontinuity_position_gap_and_bad_timestamp_stop_before_bad_packet(self):
        for flags, position, code in [(DISCONTINUITY, 960, 'device-discontinuity'),
                                       (0, 1000, 'device-position-gap'),
                                       (TIMESTAMP_ERROR, 960, 'device-timestamp-error')]:
            with self.subTest(code=code):
                stream, _ = self.capture([(0, (960, DISCONTINUITY, 0, pcm(960))),
                                          (.02, (960, flags, position, pcm(960)))])
                stream.read(960)
                with self.assertRaises(CaptureInterrupted):
                    stream.read(960)
                self.assertEqual(self.events[-1]['code'], code)
                self.assertEqual(stream.frames, 960)

    def test_explicit_device_silence_is_preserved_and_logged_without_gating(self):
        quiet = pcm(960, .00001)
        stream, _ = self.capture([(0, (960, SILENT, 0, b'')),
                                  (0, (960, SILENT, 960, b'')),
                                  (0, (960, 0, 1920, quiet))])
        self.assertEqual(stream.read(1920), bytes(1920 * 8))
        self.assertEqual(stream.read(960), quiet)
        self.assertEqual([e['event'] for e in self.events], ['started', 'device-silence', 'device-audio'])

    def test_bad_packet_length_is_not_padded(self):
        stream, _ = self.capture([(0, (960, 0, 0, b'bad'))])
        with self.assertRaises(CaptureInterrupted):
            stream.read(960)
        self.assertEqual(self.events[-1]['code'], 'invalid-packet')

    def test_valid_partial_packet_is_available_for_rescue_after_failure(self):
        data = pcm(137)
        stream, _ = self.capture([(0, (137, 0, 0, data)),
                                  (.02, (960, DISCONTINUITY, 137, pcm(960)))])
        with self.assertRaises(CaptureInterrupted):
            stream.read(960)
        self.assertEqual(stream.drain(), data)
        self.assertEqual(stream.drain(), b'')


class PacketAdapterTests(unittest.TestCase):
    def packet(self, count, flags, payload):
        released = []
        class FFI:
            NULL = None
            def new(self, kind):return [None if kind == 'BYTE**' else 0]
            def buffer(self, data, size):return memoryview(data)[:size]
        def get_buffer(client, data, frames, status, position, qpc):
            data[0], frames[0], status[0], position[0] = payload, count, flags, 12345
            return 0
        backend = types.SimpleNamespace(_ffi=FFI(), _com=types.SimpleNamespace(check_error=lambda hr: None))
        source = types.SimpleNamespace(channelmap=[0, 1], samplerate=48000,
            _ppCaptureClient=[[types.SimpleNamespace(lpVtbl=types.SimpleNamespace(GetBuffer=get_buffer))]],
            _capture_release=released.append)
        with patch.dict(sys.modules, {'soundcard.mediafoundation': backend}):
            packet = WasapiPackets(source)
        return packet, released

    def test_real_packet_is_copied_with_device_position_then_released(self):
        data = pcm(23)
        packet, released = self.packet(23, 0, data)
        self.assertEqual(packet.take(), (23, 0, 12345, data))
        self.assertEqual(released, [23])

    def test_explicit_silent_packet_allows_null_pointer_and_is_released(self):
        packet, released = self.packet(23, SILENT, None)
        self.assertEqual(packet.take(), (23, SILENT, 12345, b''))
        self.assertEqual(released, [23])

    def test_invalid_pointer_is_released_but_empty_packet_needs_no_release(self):
        packet, released = self.packet(23, 0, None)
        with self.assertRaises(CaptureInterrupted):packet.take()
        self.assertEqual(released, [23])
        packet, released = self.packet(0, 0, None)
        self.assertEqual(packet.take()[0], 0)
        self.assertEqual(released, [])


if __name__ == '__main__':
    unittest.main()
