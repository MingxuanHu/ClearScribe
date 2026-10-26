import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptionDelay, delaySeverity } from '../src/caption-delay.js';
import type { Segment } from '../shared/transcript.js';

const segment = (startSample: number, text = 'Hello', final = false): Segment => ({ seq: startSample + 1, startSample, text, final });

test('first nonempty render measures once, regardless of partial or final result', () => {
  const timing = new CaptionDelay();
  timing.begin(0, 100);
  assert.equal(timing.rendered([segment(0, ' ')], 200), undefined);
  assert.equal(timing.rendered([segment(0)], 820.4), 720);
  assert.equal(timing.rendered([segment(0, 'Hello world', true)], 2000), undefined);
  timing.begin(24000, 3000);
  assert.equal(timing.rendered([segment(24000, 'Final only', true)], 6500), 3500);
});

test('late older results and restored transcripts do not overwrite current delay', () => {
  const timing = new CaptionDelay();
  assert.equal(timing.rendered([segment(0)], 100), undefined);
  timing.begin(24000, 100); timing.begin(48000, 300);
  assert.equal(timing.rendered([segment(48000)], 800), 500);
  assert.equal(timing.rendered([segment(24000), segment(48000)], 1000), undefined);
});

test('new session resets timing and thresholds include their upper boundary', () => {
  const first = new CaptionDelay(); first.begin(0, 10);
  const next = new CaptionDelay();
  assert.equal(next.rendered([segment(0)], 100), undefined);
  assert.equal(delaySeverity(1000), 'acceptable');
  assert.equal(delaySeverity(1001), 'medium');
  assert.equal(delaySeverity(2000), 'medium');
  assert.equal(delaySeverity(2001), 'large');
});
