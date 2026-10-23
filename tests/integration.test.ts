import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readdir, readFile, rm, realpath, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { createApp, type AppOptions } from '../server/app.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';

async function fixture(opts: { missingKey?: boolean; omitFinal?: boolean; switchFail?: boolean; backpressure?: boolean; mp3?: boolean } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'clearscribe-integration-')));
  const folder = path.join(root, 'output'), project = path.join(root, 'project');
  await mkdir(folder); await mkdir(project);
  const fake = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(fake, 'listening');
  const fakePort = (fake.address() as { port: number }).port;
  const events: any[] = []; let connections = 0; let cancelled = false;
  fake.on('connection', peer => {
    const connection = ++connections; let item = 1; let hasDelta = false;
    peer.on('message', raw => {
      const event = JSON.parse(raw.toString()); events.push(event);
      const id = `connection-${connection}-item-${item}`;
      if (event.type === 'session.update') {
        if (opts.switchFail && connection > 1) { peer.send(JSON.stringify({ type: 'error', error: { code: 'model_not_found', message: 'do not echo upstream text' } })); return; }
        peer.send(JSON.stringify({ type: 'session.updated', session: event.session }));
      } else if (event.type === 'input_audio_buffer.append' && !hasDelta) {
        hasDelta = true; peer.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', event_id: `delta-${id}`, item_id: id, delta: 'Synthetic partial' }));
      } else if (event.type === 'input_audio_buffer.commit') {
        peer.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: id }));
        if (!opts.omitFinal) peer.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: `Synthetic final ${connection}.${item}.` }));
        item++; hasDelta = false;
      }
    });
  });
  const options: AppOptions = { port: 0, project, key: opts.missingKey ? '' : 'obviously-fake-test-key',
    settingsFile: opts.mp3 ? path.join(root, 'config', 'settings.json') : undefined,
    picker: async () => cancelled ? null : folder,
    upstream: () => {
      const socket = new WebSocket(`ws://127.0.0.1:${fakePort}`);
      if (opts.backpressure) Object.defineProperty(socket, 'bufferedAmount', { get: () => 300000 });
      return socket;
    }, request: (async () => Response.json({ data: [{ id: 'gpt-live-transcribe' }, { id: 'gpt-transcribe' }] })) as typeof fetch,
  };
  const app = createApp(options); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  options.port = (app.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${options.port}`;
  const bootResponse = await fetch(base + '/api/bootstrap'); const boot = await bootResponse.json() as any;
  const cookie = bootResponse.headers.get('set-cookie')!.split(';')[0];
  const headers = { cookie, 'x-csrf-token': boot.token };
  const api = (url: string, init: RequestInit = {}) => fetch(base + url, { ...init, headers: { ...headers, ...init.headers } });
  const picked = await api('/api/folder', { method: 'POST' }).then(r => r.json()) as any;
  const client = new WebSocket(base.replace('http:', 'ws:') + '/api/live', ['clearscribe', boot.token], { headers: { cookie, origin: base } }); await once(client, 'open');
  const inbox: any[] = [];
  client.on('message', raw => inbox.push(JSON.parse(raw.toString())));
  async function wait(type: string, after = 0, timeout = 12000): Promise<any> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = inbox.slice(after).find(e => e.type === type);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for ${type}`);
  }
  function send(value: object) { client.send(JSON.stringify(value)); }
  function start() { send({ type: 'start', folderId: picked.folder.id, model: 'gpt-live-transcribe', mime: 'audio/webm', settings: { prompt: 'Synthetic test', keywords: [], delay: 'low' } }); }
  async function audio(sessionId: string, end = false, startSample = 0) {
    send({ type: 'audio', sessionId, begin: true, end, startSample, audio: Buffer.alloc(960, 10).toString('base64') });
    await wait('segment');
  }
  async function recording(sessionId: string) { return api(`/api/recording/${sessionId}`, { method: 'POST', headers: { 'x-chunk-sequence': '0' }, body: 'synthetic encoded bytes (not playable)' }); }
  async function cleanup() {
    client.terminate(); await app.close(); fake.clients.forEach(c => c.terminate()); await new Promise<void>(resolve => fake.close(() => resolve())); await chmod(folder, 0o700).catch(() => {}); await rm(root, { recursive: true, force: true });
  }
  return { root, folder, project, app, fake, base, api, boot, client, inbox, events, wait, send, start, audio, recording, cleanup, cancel: () => { cancelled = true; }, connections: () => connections };
}

test('Stop commits last speech, waits for final and makes exactly two output files; repeat call gets new ID', async () => {
  const f = await fixture();
  try {
    f.start(); const ready = await f.wait('ready');
    await f.audio(ready.sessionId); assert.equal((await f.recording(ready.sessionId)).status, 200);
    f.send({ type: 'stop', sessionId: ready.sessionId, audioComplete: true });
    const stopped = await f.wait('stopped'); assert.equal(stopped.segments[0].text, 'Synthetic final 1.1.');
    assert.equal(stopped.files.audioSaved, true); assert.equal(stopped.files.txtSaved, true);
    assert.equal(f.events.filter(e => e.type === 'input_audio_buffer.commit').length, 1);
    assert.equal((await readdir(f.folder)).length, 2);
    const index = f.inbox.length; f.start(); const second = await f.wait('ready', index);
    assert.notEqual(second.sessionId, ready.sessionId);
    f.send({ type: 'audio', sessionId: ready.sessionId, audio: 'AAAA' }); assert.match((await f.wait('error', index)).message, /No matching/);
    await f.recording(second.sessionId); f.send({ type: 'stop', sessionId: second.sessionId, audioComplete: true });
    await f.wait('stopped', index); assert.equal((await readdir(f.folder)).length, 4);
  } finally { await f.cleanup(); }
});
test('new sessions register durable jobs and generate an extra MP3 without conversion UI messages', async () => {
  const f = await fixture({ mp3: true });
  try {
    assert.ok(ffmpeg);
    const sample = path.join(f.root, 'synthetic.webm');
    await promisify(execFile)(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-y', sample]);
    f.start(); const ready = await f.wait('ready');
    const jobs = path.join(f.root, 'config', 'mp3-jobs');
    assert.equal((await readdir(jobs)).length, 1);
    const upload = await f.api(`/api/recording/${ready.sessionId}`, {
      method: 'POST', headers: { 'x-chunk-sequence': '0' }, body: new Uint8Array(await readFile(sample)),
    });
    assert.equal(upload.status, 200);
    f.send({ type: 'stop', sessionId: ready.sessionId, audioComplete: true });
    const stopped = await f.wait('stopped');
    assert.equal(stopped.files.audioSaved, true);
    const deadline = Date.now() + 5000;
    while (!(await readdir(f.folder)).includes(`${stopped.files.base}.mp3`) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.deepEqual((await readdir(f.folder)).sort(), ['txt', 'webm', 'mp3'].map(ext => `${stopped.files.base}.${ext}`).sort());
    assert.deepEqual(await readdir(jobs), []);
    assert.equal(f.inbox.some(message => ['warning', 'error', 'fatal'].includes(message.type)), false);
    assert.deepEqual(await readFile(path.join(f.folder, `${stopped.files.base}.webm`)), await readFile(sample));
  } finally { await f.cleanup(); }
});
test('model switching drains old segment, confirms new session, retains same files and sample timeline', async () => {
  const f = await fixture();
  try {
    f.start(); const ready = await f.wait('ready'); await f.audio(ready.sessionId, true);
    const index = f.inbox.length; f.send({ type: 'switch', sessionId: ready.sessionId, model: 'gpt-transcribe' });
    const switched = await f.wait('switched', index); assert.equal(switched.model, 'gpt-transcribe');
    await f.audio(ready.sessionId, true, 96000); await f.recording(ready.sessionId);
    f.send({ type: 'stop', sessionId: ready.sessionId, audioComplete: true }); const stopped = await f.wait('stopped');
    assert.equal(stopped.files.base, ready.files.base); assert.equal((await readdir(f.folder)).length, 2);
    assert.deepEqual(stopped.segments.map((s: any) => s.startSample), [0, 96000]);
    assert.deepEqual(stopped.segments.map((s: any) => s.text), ['Synthetic final 1.1.', 'Synthetic final 2.1.']);
  } finally { await f.cleanup(); }
});
test('final timeout preserves provisional text and releases upstream', async () => {
  const f = await fixture({ omitFinal: true });
  try {
    f.start(); const ready = await f.wait('ready'); await f.audio(ready.sessionId); await f.recording(ready.sessionId);
    f.send({ type: 'stop', sessionId: ready.sessionId, audioComplete: true }); const stopped = await f.wait('stopped');
    assert.equal(stopped.segments[0].final, false);
    const text = await readFile(path.join(f.folder, stopped.files.base + '.txt'), 'utf8');
    assert.match(text, /PROVISIONAL/); assert.match(text, /Final-result timeout/);
    await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(f.fake.clients.size, 0);
  } finally { await f.cleanup(); }
});
test('switch failure keeps text, stops explicitly, and never opens a fallback model', async () => {
  const f = await fixture({ switchFail: true });
  try {
    f.start(); const ready = await f.wait('ready'); await f.audio(ready.sessionId, true);
    f.send({ type: 'switch', sessionId: ready.sessionId, model: 'gpt-transcribe' });
    const fatal = await f.wait('fatal'); assert.match(fatal.message, /Model switch failed/);
    await f.recording(ready.sessionId); f.send({ type: 'stop', sessionId: ready.sessionId, audioComplete: true });
    const stopped = await f.wait('stopped'); assert.equal(f.connections(), 2); assert.equal(stopped.segments[0].text, 'Synthetic final 1.1.');
    assert.equal((await readdir(f.folder)).length, 2);
  } finally { await f.cleanup(); }
});
test('recording write failure does not block live or final captions', async () => {
  const f = await fixture();
  try {
    f.start(); const ready = await f.wait('ready');
    // Simulate a recording channel sequence failure independently from PCM.
    const failed = await f.api(`/api/recording/${ready.sessionId}`, { method: 'POST', headers: { 'x-chunk-sequence': '4' }, body: 'synthetic' }); assert.equal(failed.status, 507);
    await f.audio(ready.sessionId, true); f.send({ type: 'stop', sessionId: ready.sessionId, audioComplete: false });
    const stopped = await f.wait('stopped'); assert.equal(stopped.files.audioFailed, true); assert.equal(stopped.files.txtSaved, true); assert.equal(stopped.segments[0].final, true);
  } finally { await f.cleanup(); }
});
test('backpressure is bounded and stops explicitly', async () => {
  const f = await fixture({ backpressure: true });
  try {
    f.start(); const ready = await f.wait('ready');
    f.send({ type: 'audio', sessionId: ready.sessionId, begin: true, end: false, startSample: 0, audio: Buffer.alloc(960).toString('base64') });
    assert.match((await f.wait('fatal')).message, /queue exceeded/);
    assert.equal(f.events.filter(e => e.type === 'input_audio_buffer.append').length, 0);
    f.send({ type: 'stop', sessionId: ready.sessionId, audioComplete: false }); await f.wait('stopped');
  } finally { await f.cleanup(); }
});
test('missing key rejects Start before paid connection or file creation', async () => {
  const f = await fixture({ missingKey: true });
  try { f.start(); assert.match((await f.wait('error')).message, /OPENAI_API_KEY/); assert.equal(f.connections(), 0); assert.deepEqual(await readdir(f.folder), []); }
  finally { await f.cleanup(); }
});
test('folder dialog cancel preserves selection; invalid origin, untrusted WS and oversized upload are denied', async () => {
  const f = await fixture();
  try {
    f.cancel(); const cancelled = await f.api('/api/folder', { method: 'POST' }).then(r => r.json()) as any;
    assert.equal(cancelled.cancelled, true); assert.equal(cancelled.folder.path, f.folder);
    assert.equal((await f.api('/api/folder', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(f.base + '/api/models')).status, 403);
    assert.equal((await f.api('/.env')).status, 404);
    const bad = new WebSocket(f.base.replace('http:', 'ws:') + '/api/live', ['clearscribe', f.boot.token], { headers: { origin: 'https://evil.example' } });
    bad.on('error', () => {}); await new Promise(resolve => bad.once('close', resolve));
    f.start(); const ready = await f.wait('ready');
    assert.equal((await f.api('/api/folder', { method: 'POST' })).status, 409);
    const response = await f.api(`/api/recording/${ready.sessionId}`, { method: 'POST', headers: { 'x-chunk-sequence': '0' }, body: Buffer.alloc(1024 * 1024 + 1) }); assert.equal(response.status, 413);
    f.send({ type: 'stop', sessionId: ready.sessionId, audioComplete: false }); await f.wait('stopped');
  } finally { await f.cleanup(); }
});
test('websocket payload limit and disconnect release upstream and preserve the final TXT', async () => {
  const f = await fixture();
  try {
    f.start(); const ready = await f.wait('ready'); await f.audio(ready.sessionId);
    f.client.send(JSON.stringify({ type: 'audio', audio: 'A'.repeat(70000) }));
    await once(f.client, 'close'); await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(f.fake.clients.size, 0);
    const output = await readdir(f.folder); assert.ok(output.some(n => n.endsWith('.txt')));
    assert.match(await readFile(path.join(f.folder, output.find(n => n.endsWith('.txt'))!), 'utf8'), /Synthetic final/);
  } finally { await f.cleanup(); }
});

test('switch at an active boundary commits the old tail before opening the next adapter', async () => {
  const f = await fixture();
  try {
    f.start(); const ready = await f.wait('ready'); await f.audio(ready.sessionId, false);
    f.send({ type: 'switch', sessionId: ready.sessionId, model: 'gpt-transcribe' });
    await f.wait('switched');
    const firstCommit = f.events.findIndex(e => e.type === 'input_audio_buffer.commit');
    const updates = f.events.map((e, i) => e.type === 'session.update' ? i : -1).filter(i => i >= 0);
    assert.ok(firstCommit >= 0 && firstCommit < updates[1]);
    await f.recording(ready.sessionId); f.send({ type: 'stop', sessionId: ready.sessionId, audioComplete: true });
    const stopped = await f.wait('stopped'); assert.equal(stopped.segments[0].final, true);
  } finally { await f.cleanup(); }
});
