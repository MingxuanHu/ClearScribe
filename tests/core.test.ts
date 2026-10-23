import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Transcript, transcriptText, timestamp, RATE } from '../shared/transcript.js';
import { Resampler, Segmenter } from '../shared/audio.js';
import { compatible, intersectModels, ModelCatalog, parseSettings, sessionUpdate } from '../server/models.js';
import { localRequest, safeError, upstreamError } from '../server/security.js';
import type { IncomingMessage } from 'node:http';

test('partials merge, final replaces, out-of-order completion sorts by sample sequence', () => {
  const t = new Transcript('call'); t.begin(1, 24000); t.begin(2, 96000);
  t.event('call', { item_id: 'a', delta: 'synthetic ', event_id: 'e1' }, 1);
  t.event('call', { item_id: 'a', delta: 'synthetic ', event_id: 'e1' }, 1);
  t.event('call', { item_id: 'b', transcript: 'Second synthetic sentence.' }, 2);
  t.event('call', { item_id: 'a', delta: 'draft' }, 1);
  t.event('call', { item_id: 'a', transcript: 'First synthetic sentence.' }, 1);
  t.event('call', { item_id: 'a', delta: 'late partial' }, 1);
  assert.deepEqual(t.segments.map(s => [s.text, s.final]), [['First synthetic sentence.', true], ['Second synthetic sentence.', true]]);
  const output = transcriptText(t.segments, 'Synthetic test date +1100');
  assert.ok(output.indexOf('First') < output.indexOf('Second')); assert.ok(output.includes('[00:00:04] Second'));
});
test('old sessions and duplicate ownership are rejected; empty final clears provisional', () => {
  const t = new Transcript('new'); t.begin(1, 0); t.begin(2, 24000);
  assert.equal(t.event('old', { item_id: 'a', transcript: 'Must not leak' }, 1), false);
  t.event('new', { item_id: 'a', delta: 'draft' }, 1);
  assert.throws(() => t.bind('a', 2));
  t.event('new', { item_id: 'a', transcript: '' }, 1); assert.equal(t.segments[0].text, '');
});
test('TXT explicitly labels provisional text and preserves exact English and punctuation', () => {
  assert.match(transcriptText([{ seq: 1, startSample: 3601 * RATE, text: 'Synthetic: café; Java—yes.', final: false }], 'test'), /\[01:00:01\] \[PROVISIONAL\] Synthetic: café; Java—yes\./);
  assert.equal(timestamp(-1), '00:00:00'); assert.equal(timestamp(RATE * 3661), '01:01:01');
});
test('streaming resampling is block-invariant at 44.1kHz and conserves DC level', () => {
  const source = Float32Array.from({ length: 44100 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / 44100) * .5);
  const full = new Resampler(44100).push(source);
  const r = new Resampler(44100); const pieces: number[] = [];
  for (let i = 0; i < source.length; i += 137) pieces.push(...r.push(source.slice(i, i + 137)));
  assert.equal(full.length, 24000); assert.deepEqual(pieces, [...full]);
  const dc = new Resampler(48000).push(new Float32Array(48000).fill(.5));
  assert.equal(dc.length, 24000); assert.ok([...dc].every(n => n === 16384));
});
test('resampler rejects unsupported input, clamps, and carries an unfinished sample', () => {
  assert.throws(() => new Resampler(16000));
  const r = new Resampler(48000); assert.equal(r.push(Float32Array.of(2)).length, 0);
  assert.deepEqual([...r.push(Float32Array.of(2, -2, -2))], [32767, -32768]);
});
test('VAD ignores silence, preserves prefix, and commits a bounded long utterance', () => {
  const v = new Segmenter();
  for (let i = 0; i < 100; i++) assert.equal(v.push(new Int16Array(480)), undefined);
  const first = v.push(new Int16Array(480).fill(1000))!;
  assert.equal(first.begin, true); assert.equal(first.startSample, 40800); assert.equal(first.pcm.length, 7680);
  let ends = 0; for (let i = 0; i < 44; i++) if (v.push(new Int16Array(480))?.end) ends++;
  assert.equal(ends, 1); assert.equal(v.finish(), false);
  const long = new Segmenter(); let turns = 0;
  for (let i = 0; i < 1300; i++) if (long.push(new Int16Array(480).fill(4000))?.end) turns++;
  assert.equal(turns, 1); assert.equal(long.finish(), true);
});
test('whitelist uses exact IDs, excludes snapshots, deprecated rows and assistant models', () => {
  assert.equal(compatible('gpt-live-transcribe-2099-01-01'), false);
  assert.deepEqual(intersectModels([{ id: 'gpt-live-transcribe' }, { id: 'gpt-realtime' }, { id: 'gpt-transcribe', shutdown_date: '2099-01-01' }]).map(m => m.id), ['gpt-live-transcribe']);
  const config = sessionUpdate('gpt-live-transcribe', { prompt: '', keywords: ['Java'], delay: 'low' });
  assert.equal(config.session.type, 'transcription'); assert.equal(config.session.audio.input.turn_detection, null);
  assert.deepEqual(config.session.audio.input.transcription.languages, ['en']); assert.equal('language' in config.session.audio.input.transcription, false);
  assert.equal('delay' in sessionUpdate('gpt-transcribe', { prompt: '', keywords: [], delay: 'medium' }).session.audio.input.transcription, false);
  assert.throws(() => parseSettings({ prompt: '', keywords: ['<bad>'], delay: 'low' }));
});
test('model list permission failure offers unconfirmed candidates, refreshes are throttled', async () => {
  let count = 0;
  const catalog = new ModelCatalog('obviously-fake', (async () => { count++; return new Response('', { status: 403 }); }) as typeof fetch);
  const rows = await catalog.list(); await catalog.list(true);
  assert.equal(count, 1); assert.equal(rows.models.length, 2); assert.ok(rows.models.every(m => m.availability === 'unconfirmed'));
});
test('network failure is stale, missing key does not contact API, and disappeared selection is absent', async () => {
  let count = 0;
  const request = (async () => { count++; throw new Error('fake-network'); }) as typeof fetch;
  const missing = await new ModelCatalog('', request).list(); assert.equal(count, 0); assert.equal(missing.stale, true);
  const stale = await new ModelCatalog('fake', request).list(); assert.equal(stale.checkedAt, null); assert.equal(stale.stale, true);
  const empty = await new ModelCatalog('fake', (async () => Response.json({ data: [] })) as typeof fetch).list(); assert.equal(empty.models.length, 0);
});
test('Host, Origin and Fetch Metadata guards reject external callers; errors never echo secrets', () => {
  const request = (headers: object) => ({ headers }) as IncomingMessage;
  assert.equal(localRequest(request({ host: '127.0.0.1:4317', origin: 'https://evil.example' }), 4317), false);
  assert.equal(localRequest(request({ host: 'evil.example:4317' }), 4317), false);
  assert.equal(localRequest(request({ host: '127.0.0.1:4317', 'sec-fetch-site': 'cross-site' }), 4317), false);
  assert.equal(localRequest(request({ host: '127.0.0.1:4317', origin: 'http://127.0.0.1:5173' }), 4317, 5173), true);
  assert.doesNotMatch(safeError(new Error('secret must never echo')), /secret/);
  assert.doesNotMatch(upstreamError('secret must never echo'), /secret/);
  assert.match(safeError({ code: 'ENOSPC' }), /disk is full/);
});

test('cached successful model list stays stale on failed refresh without fabricating a new success time', async () => {
  const originalNow = Date.now; let now = originalNow(); let requests = 0;
  Date.now = () => now;
  try {
    const catalog = new ModelCatalog('fake', (async () => {
      requests++; if (requests > 1) throw new Error('synthetic outage');
      return Response.json({ data: [{ id: 'gpt-live-transcribe' }] });
    }) as typeof fetch);
    const good = await catalog.list(); now += 31000;
    const failed = await catalog.list(true);
    assert.equal(requests, 2); assert.equal(failed.stale, true);
    assert.equal(failed.checkedAt, good.checkedAt); assert.deepEqual(failed.models, good.models);
    await catalog.list(true); assert.equal(requests, 2);
  } finally { Date.now = originalNow; }
});
