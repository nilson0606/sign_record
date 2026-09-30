import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeId, detectPitch, noteOf, playerResponse, alignedTime } from '../audio.mjs';
import { ScoringTake } from '../scoring.mjs';

function randomNoise(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 - .5; };
}
function breathyVoice(hz, rate, seed = 42) {
  const noise = randomNoise(seed);
  return Float32Array.from({ length: 4096 }, (_, i) => {
    const phase = 2 * Math.PI * hz * i / rate;
    const envelope = .65 + .35 * Math.sin(Math.PI * i / 4096);
    return envelope * (.12 * Math.sin(phase) + .045 * Math.sin(2 * phase)) + .24 * noise();
  });
}
test('YouTube formats and hostile host rejection', () => {
  for (const url of ['https://youtu.be/M7lc1UVf-VE?t=12', 'https://www.youtube.com/watch?v=M7lc1UVf-VE&list=123', 'https://m.youtube.com/shorts/M7lc1UVf-VE']) assert.equal(youtubeId(url), 'M7lc1UVf-VE');
  for (const url of ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'javascript:alert(1)', 'https://example.com/M7lc1UVf-VE', 'https://youtu.be/nope']) assert.equal(youtubeId(url), null);
});
test('pitch accuracy across sample rates, range and harmonics', () => {
  for (const rate of [44100, 48000]) for (const hz of [82.41, 110, 196, 261.63, 440, 783.99]) {
    const signal = Float32Array.from({ length: 4096 }, (_, i) => .18 * Math.sin(2 * Math.PI * hz * i / rate) + .08 * Math.sin(4 * Math.PI * hz * i / rate) + .03);
    const result = detectPitch(signal, rate);
    assert.ok(result.hz, `no pitch: ${hz}`);
    assert.ok(Math.abs(1200 * Math.log2(result.hz / hz)) < 12, `${hz}: got ${result.hz}`);
  }
});
test('silence, DC, quiet input and noise are not notes', () => {
  let seed = 42;
  const noise = Float32Array.from({ length: 4096 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 2 ** 32 - .5) * .4; });
  for (const signal of [new Float32Array(4096), new Float32Array(4096).fill(.2), Float32Array.from({ length: 4096 }, (_, i) => .001 * Math.sin(i)), noise]) assert.equal(detectPitch(signal, 48000).hz, null);
});

test('breathy low and normal voices retain their fundamental without changing PCM', () => {
  for (const rate of [16000, 44100, 48000]) for (const hz of [82.41, 110, 146.83, 196, 261.63, 440]) {
    const signal = breathyVoice(hz, rate), saved = signal.slice(), result = detectPitch(signal, rate);
    assert.ok(result.hz && Math.abs(1200 * Math.log2(result.hz / hz)) < 30, `${rate} Hz / ${hz}: ${JSON.stringify(result)}`);
    assert.deepEqual(signal, saved, 'pitch analysis must not change recorded samples');
  }
});

test('unvoiced air, rumble, clicks and quiet notes do not become fallback pitches', () => {
  for (const rate of [16000, 44100, 48000]) for (let seed = 1; seed <= 20; seed++) {
    const noise = randomNoise(seed); let low = 0, previous = 0;
    const white = new Float32Array(4096), rumble = white.slice(), air = white.slice(), burst = white.slice();
    for (let i = 0; i < white.length; i++) {
      const value = noise() * .4; low += (1 - Math.exp(-2 * Math.PI * 500 / rate)) * (value - low);
      white[i] = value; rumble[i] = low; air[i] = value - previous; previous = value;
      burst[i] = value * Math.exp(-(((i - 2048) / 300) ** 2));
    }
    const click = white.slice().fill(0); click[2048] = .8;
    for (const [name, signal] of Object.entries({ white, rumble, air, burst, click })) {
      assert.equal(detectPitch(signal, rate).hz, null, `${name}: rate ${rate}, seed ${seed}`);
    }
  }
});

test('waveform-to-score accepts a low octave but still deducts wrong notes and silence', () => {
  const rate = 48000, notes = [220, 261.6256, 329.6276, 392];
  const reference = { version: 1, videoId: 'M7lc1UVf-VE', title: 'Octave regression', step: .1, frames: notes.flatMap(hz => Array(10).fill(hz)) };
  function score(factor, allowOctave = true) {
    const take = new ScoringTake(reference, { allowOctave, difficulty: 'relaxed' });
    reference.frames.forEach((hz, i) => take.sample(i * .1, factor ? detectPitch(breathyVoice(hz * factor, rate, i + 1), rate).hz : null));
    return take.result();
  }
  const normal = score(1), low = score(.5), wrong = score(.5 * 2 ** (4 / 12));
  assert.equal(normal.score, 100); assert.equal(low.score, 100);
  assert.equal(score(.5, false).pitch, 0);
  assert.ok(wrong.pitch < 10); assert.equal(score(0).score, 0);
});
test('note naming and compensation sign', () => {
  assert.equal(noteOf(440).name, 'A4'); assert.equal(noteOf(440).cents, 0); assert.equal(noteOf(null), null);
  assert.equal(alignedTime(35.2, 200), 35); assert.equal(alignedTime(.1, 200), 0); assert.equal(alignedTime(1, -200), 1.2);
});
test('external metadata is parsed as JSON, not code', () => {
  assert.deepEqual(playerResponse('var ytInitialPlayerResponse = {"title":"brace }", "nested":{"ok":true}}; throw Error();'), { title: 'brace }', nested: { ok: true } });
  assert.equal(playerResponse('ytInitialPlayerResponse = {invalid}'), null); assert.equal(playerResponse('consent page'), null);
});
