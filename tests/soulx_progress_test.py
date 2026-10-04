import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from soulx_progress import segment_progress


class Model:
    def build_vocal_segments(self, segments):
        return segments, segments

    def infer_segment(self, value):
        if value is None:
            raise ValueError('inference failed')
        return value


class ProgressTest(unittest.TestCase):
    def test_preserves_results_and_reports_only_successful_segments(self):
        model = Model(); events = []; syncs = []
        original = model.infer_segment
        with segment_progress(model, lambda *args, **kw: events.append(kw['progress']), lambda: syncs.append(True)) as state:
            segments = [(0, 20), (20, 40), (40, 60)]
            self.assertEqual(model.build_vocal_segments(segments), (segments, segments))
            for s in segments:
                self.assertIs(model.infer_segment(s), s)
            self.assertEqual(state['completed'], 3)
        self.assertEqual([e['completed'] for e in events], [0, 1, 1, 2, 2, 3])
        self.assertTrue(all(e['total'] == 3 for e in events))
        self.assertEqual(len(syncs), 3)
        self.assertEqual(model.infer_segment, original)

    def test_short_clip_fallback_and_failure_restore_methods(self):
        for build in [False, True]:
            model = Model(); events = []; original = model.infer_segment
            with self.assertRaises(ValueError):
                with segment_progress(model, lambda *args, **kw: events.append(kw['progress'])):
                    if build:
                        model.build_vocal_segments([])
                    model.infer_segment(None)
            self.assertEqual(events, [{'completed': 0, 'total': 1, 'unit': 'segments'}])
            self.assertEqual(model.infer_segment, original)


if __name__ == '__main__':
    unittest.main()
