import struct
import json
import sys
import unittest
import types
import threading
from unittest.mock import patch
from collections import deque
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from native_capture import ContinuousCapture, WasapiPackets, CaptureInterrupted, SILENT, DISCONTINUITY, TIMESTAMP_ERROR, PCMDelivery


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

    def test_bad_timestamp_stops_before_bad_packet(self):
        for flags, position, code in [(TIMESTAMP_ERROR, 960, 'device-timestamp-error')]:
            with self.subTest(code=code):
                stream, _ = self.capture([(0, (960, DISCONTINUITY, 0, pcm(960))),
                                          (.02, (960, flags, position, pcm(960)))])
                stream.read(960)
                with self.assertRaises(CaptureInterrupted):
                    stream.read(960)
                self.assertEqual(self.events[-1]['code'], code)
                self.assertEqual(stream.frames, 960)

    def test_discontinuity_with_real_pcm_warns_but_keeps_recording(self):
        chunks = [pcm(960, value) for value in [.25, -.25, .1, -.1]]
        stream, _ = self.capture([(0, (960, DISCONTINUITY, 0, chunks[0])),
                                  (.02, (960, DISCONTINUITY, 1920, chunks[1])),
                                  (.04, (960, 0, 2880, chunks[2])),
                                  (.06, (960, DISCONTINUITY, 4800, chunks[3]))])
        self.assertEqual(stream.read(3840), b''.join(chunks))
        self.assertEqual(stream.frames, 3840)  # No zeros inserted for device-position gaps.
        self.assertIsNone(stream.failed)
        warnings = [e for e in self.events if e['event'] == 'warning']
        self.assertEqual([e['count'] for e in warnings], [1, 2])
        self.assertEqual(warnings[-1]['recentPackets'][-1]['pos'], 4800)
        self.assertLess(len(json.dumps(warnings[-1], ensure_ascii=True)), 4096)

    def test_packet_diagnostics_are_bounded_and_contain_no_audio(self):
        chunk = pcm(960)
        stream, _ = self.capture([(0, (960, DISCONTINUITY if i == 25 else 0, i * 960, chunk))
                                  for i in range(30)])
        self.assertEqual(stream.read(30 * 960), chunk * 30)
        warning = next(e for e in self.events if e['event'] == 'warning')
        self.assertEqual(len(warning['recentPackets']), 12)
        self.assertLess(len(json.dumps(warning, ensure_ascii=True)), 4096)
        self.assertEqual(set(warning['recentPackets'][-1]), {'f', 'n', 'flags', 'pos', 'qpc100ns', 'readGapMs'})

    def test_discontinuity_does_not_allow_invalid_pcm(self):
        stream, _ = self.capture([(0, (960, 0, 0, pcm(960))),
                                  (.02, (960, DISCONTINUITY, 960, b'bad'))])
        stream.read(960)
        with self.assertRaises(CaptureInterrupted):stream.read(960)
        self.assertEqual(self.events[-1]['code'], 'invalid-packet')

    def test_usb_device_positions_do_not_reject_resampled_client_pcm(self):
        # Observed JAZZ-UB036 packets: device position advances 444 frames,
        # independently of the 48 kHz PCM count and initial resampler latency.
        counts = [449, 483, 483, 484, 483]
        chunks = [pcm(count, .125 + i * .01) for i, count in enumerate(counts)]
        stream, _ = self.capture([(0, (count, DISCONTINUITY if i == 0 else 0,
                                      444 * (i + 1), chunks[i]))
                                  for i, count in enumerate(counts)])
        self.assertEqual(stream.read(sum(counts)), b''.join(chunks))
        self.assertEqual(stream.frames, sum(counts))
        self.assertEqual(len([e for e in self.events if e['event'] == 'device-position-units']), 1)
        self.assertFalse(any(e['event'] == 'error' for e in self.events))

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
                                  (.02, (960, TIMESTAMP_ERROR, 137, pcm(960)))])
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
            qpc[0] = 987654321
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
        self.assertEqual(packet.last_qpc, 987654321)
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


class DeliveryTests(unittest.TestCase):
    def test_blocked_pipe_does_not_block_capture_and_preserves_order(self):
        entered, release = threading.Event(), threading.Event()
        sent = []
        def send(data):
            entered.set()
            if not release.wait(2):raise TimeoutError('test release missing')
            sent.append(data)
        delivery = PCMDelivery(send, capacity=20)
        try:
            delivery.submit(b'first')
            self.assertTrue(entered.wait(1))
            chunks = [pcm(960, i / 20) for i in range(15)]
            # Submit 300 ms of real samples while the sender remains blocked.
            for chunk in chunks:delivery.submit(chunk)
            self.assertEqual(sent, [])
        finally:
            release.set()
            delivery.close()
        self.assertEqual(sent, [b'first', *chunks])

    def test_full_queue_fails_instead_of_dropping_or_blocking(self):
        entered, release = threading.Event(), threading.Event()
        sent = []
        def send(data):
            entered.set();release.wait(2);sent.append(data)
        delivery = PCMDelivery(send, capacity=2)
        try:
            delivery.submit(b'first');self.assertTrue(entered.wait(1))
            delivery.submit(b'second');delivery.submit(b'third')
            with self.assertRaises(CaptureInterrupted) as failure:delivery.submit(b'overflow')
            self.assertEqual(failure.exception.code, 'transport-backlog')
        finally:
            release.set();delivery.close()
        self.assertEqual(sent, [b'first', b'second', b'third'])

    def test_broken_consumer_is_reported_on_flush(self):
        def send(data):raise BrokenPipeError('closed')
        delivery = PCMDelivery(send)
        delivery.submit(b'packet')
        with self.assertRaises(BrokenPipeError):delivery.close()


if __name__ == '__main__':
    unittest.main()
