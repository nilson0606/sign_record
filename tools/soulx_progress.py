"""Observe model segment boundaries without changing inference or audio."""
from contextlib import contextmanager


@contextmanager
def segment_progress(model, emit, synchronize=lambda: None):
    build = model.build_vocal_segments
    infer = model.infer_segment
    state = {'completed': 0, 'total': 1, 'unit': 'segments'}

    def report(message):
        emit('converting', message, progress=dict(state))

    def tracked_build(*args, **kwargs):
        result = build(*args, **kwargs)
        # The model falls back to one whole segment when none are detected.
        state['total'] = max(1, len(result[1]))
        return result

    def tracked_infer(*args, **kwargs):
        report(f"轉換第 {state['completed'] + 1}／{state['total']} 段…")
        result = infer(*args, **kwargs)
        synchronize()
        state['completed'] += 1
        report(f"已完成 {state['completed']}／{state['total']} 段，整理音訊…")
        return result

    model.build_vocal_segments = tracked_build
    model.infer_segment = tracked_infer
    try:
        yield state
    finally:
        model.build_vocal_segments = build
        model.infer_segment = infer
