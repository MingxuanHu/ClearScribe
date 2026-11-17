import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Capture, type CaptureOptions } from '../src/capture.js';
import { within } from '../shared/deadline.js';
const options = (onWarning = (_: string) => {}): CaptureOptions => ({ deviceId: '', noiseSuppression: false, autoGainControl: true, echoCancellation: false, threshold: .008, token: 'obviously-fake-csrf', onAudio() {}, onLevel() {}, onFatal() {}, onWarning });

test('repeated Capture.stop shares finalization and releases tracks/AudioContext once', async () => {
  const capture = new Capture(options()); let closed = 0; let trackStopped = false;
  const internals = capture as any;
  internals.stream = { getTracks: () => [{ stop: () => { trackStopped = true; } }] };
  internals.context = { state: 'running', close: async () => { closed++; internals.context.state = 'closed'; } };
  const first = capture.stop(), second = capture.stop();
  assert.equal(first, second); assert.equal(await first, true);
  await capture.stop(); assert.equal(closed, 1); assert.equal(trackStopped, true);
});
test('oversized encoded chunk fails recording independently without queuing a full call or starting upload', async () => {
  const warnings: string[] = []; const capture = new Capture(options(message => warnings.push(message)));
  const internals = capture as any;
  internals.enqueue(new Blob([new Uint8Array(1024 * 1024 + 1)]));
  assert.equal(internals.uploadQueue.length, 0); assert.equal(internals.uploading, undefined);
  assert.match(warnings[0], /Recording queue limit/); assert.equal(await capture.stop(), false);
});
test('bounded finalization wait resolves success, times out or propagates a real error', async () => {
  assert.equal(await within(Promise.resolve(), 50), true);
  assert.equal(await within(new Promise(() => {}), 5), false);
  await assert.rejects(within(Promise.reject(new Error('synthetic failure')), 50), /synthetic/);
});

test('blocked audio startup times out and releases microphone before a session can start', async () => {
  const names = ['navigator', 'window', 'MediaRecorder', 'AudioContext', 'AudioWorkletNode'] as const;
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let stopped = 0; let closed = 0;
  const track = { stop: () => { stopped++; }, addEventListener() {} };
  class Context {
    state = 'suspended'; sampleRate = 48000;
    audioWorklet = { addModule: async () => {} };
    resume() { return new Promise<void>(() => {}); }
    async close() { closed++; }
  }
  class Worklet { port = { onmessage: undefined, close() {} }; disconnect() {} }
  try {
    const mocks = {
      navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } },
      window: { AudioWorkletNode: Worklet, MediaRecorder: {} },
      AudioContext: Context, AudioWorkletNode: Worklet,
      MediaRecorder: { isTypeSupported: () => true },
    };
    for (const name of names) Object.defineProperty(globalThis, name, { value: mocks[name], configurable: true });
    const capture = new Capture(options());
    await assert.rejects(capture.prepare(), /Click Start session/);
    assert.equal(stopped, 1); assert.equal(closed, 1);
  } finally {
    for (const name of names) {
      const descriptor = originals.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test('digital silence warns once per interval and normal input resets detection', () => {
  const warnings: string[] = [];
  const capture = new Capture({ ...options(), onInterruption: message => warnings.push(message) });
  const internals = capture as any;
  capture.sampleRate = 10;
  internals.checkSilence(new Float32Array(99));
  assert.equal(warnings.length, 0);
  internals.checkSilence(new Float32Array(1));
  internals.checkSilence(new Float32Array(100));
  assert.equal(warnings.length, 1);
  internals.checkSilence(new Float32Array([0.001]));
  internals.checkSilence(new Float32Array(100));
  assert.equal(warnings.length, 2);
});

test('interrupted context resumes once and shutdown never restarts audio', async () => {
  const warnings: string[] = []; let resumed = 0;
  const internals = new Capture({ ...options(), onInterruption: message => warnings.push(message) }) as any;
  internals.enabled = true;
  internals.context = { state: 'suspended', async resume() { resumed++; this.state = 'running'; } };
  await internals.recoverContext();
  assert.equal(resumed, 1); assert.equal(warnings.length, 1);
  internals.stopped = true; internals.context.state = 'suspended';
  await internals.recoverContext(); assert.equal(resumed, 1);
});

test('wake lock acquired after shutdown is immediately released', async () => {
  const names = ['navigator', 'document'] as const;
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let released = 0; let resolveLock!: (lock: unknown) => void;
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible' } });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { wakeLock: { request: () => new Promise(resolve => { resolveLock = resolve; }) } } });
    const internals = new Capture(options()) as any; internals.enabled = true;
    const pending = internals.keepAwake(); internals.stopped = true;
    resolveLock({ release: async () => { released++; } });
    await pending; assert.equal(released, 1); assert.equal(internals.wakeLock, undefined);
  } finally {
    for (const name of names) {
      const descriptor = originals.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
