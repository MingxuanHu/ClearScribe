import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { CallFiles } from '../server/storage.js';
import { Mp3Queue, convertMp3, publishMp3 } from '../server/mp3.js';

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'clearscribe-mp3-')));
  const project = path.join(root, 'project'), folder = path.join(root, 'recordings'), jobs = path.join(root, 'jobs');
  await mkdir(project); await mkdir(folder);
  const files = new CallFiles(folder, project); await files.create('audio/webm');
  return { root, project, folder, jobs, files };
}
test('new intents survive restart, retry silently, skip historical files, and preserve existing MP3 files', async () => {
  const f = await fixture();
  let time = 1000000, calls = 0;
  const convert = async (_source: string, output: string) => {
    calls++;
    if (calls === 1) { await writeFile(output, 'partial'); throw new Error('Synthetic encoder failure'); }
    await writeFile(output, 'synthetic MP3');
  };
  let queue = new Mp3Queue(f.jobs, f.project, () => false, convert, () => time);
  try {
    await writeFile(path.join(f.folder, 'historical.webm'), 'untouched');
    await queue.track(f.files);
    await f.files.appendAudio(Buffer.from('synthetic WebM'), 0); await f.files.saveText('Synthetic transcript'); await f.files.finish(true);
    await queue.drain();
    assert.equal(calls, 1); assert.equal((await readdir(f.jobs)).length, 1);
    assert.equal((await readdir(f.folder)).some(name => name.endsWith('.tmp')), false);
    await queue.close();
    queue = new Mp3Queue(f.jobs, f.project, () => false, convert, () => time);
    await queue.drain(); assert.equal(calls, 1);
    time += 60001; await queue.drain();
    assert.equal(await readFile(f.files.file('mp3'), 'utf8'), 'synthetic MP3');
    assert.equal(await readFile(f.files.file('webm'), 'utf8'), 'synthetic WebM');
    assert.equal(await readFile(f.files.file('txt'), 'utf8'), 'Synthetic transcript');
    assert.deepEqual(await readdir(f.jobs), []); assert.equal(calls, 2);
    await queue.track(f.files); await queue.drain();
    assert.equal(calls, 2); assert.equal(await readFile(f.files.file('mp3'), 'utf8'), 'synthetic MP3');
    assert.equal((await readdir(f.folder)).includes('historical.mp3'), false);
  } finally { await queue.close(); await rm(f.root, { recursive: true, force: true }); }
});
test('capture takes priority; incomplete sources are never converted or removed', async () => {
  const f = await fixture(); let busy = true, calls = 0;
  const queue = new Mp3Queue(f.jobs, f.project, () => busy, async () => { calls++; });
  try {
    await queue.track(f.files); await f.files.appendAudio(Buffer.from('partial'), 0);
    await queue.drain(); assert.equal(calls, 0);
    await f.files.finish(false); busy = false; await queue.drain();
    assert.equal(calls, 0); assert.equal(await readFile(f.files.file('webm.part'), 'utf8'), 'partial');
    assert.deepEqual(await readdir(f.jobs), []);
  } finally { await queue.close(); await rm(f.root, { recursive: true, force: true }); }
});
test('output collisions during conversion cannot overwrite another file', async () => {
  const f = await fixture();
  const queue = new Mp3Queue(f.jobs, f.project, () => false, async (_source, output) => {
    await writeFile(output, 'generated'); await writeFile(f.files.file('mp3'), 'keep existing');
  });
  try {
    await queue.track(f.files); await f.files.appendAudio(Buffer.from('source'), 0); await f.files.finish(true);
    await queue.drain();
    assert.equal(await readFile(f.files.file('mp3'), 'utf8'), 'keep existing');
    assert.equal(await readFile(f.files.file('webm'), 'utf8'), 'source');
  } finally { await queue.close(); await rm(f.root, { recursive: true, force: true }); }
});
test('shutdown aborts conversion, retains its intent, and removes temporary output', async () => {
  const f = await fixture(); let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const queue = new Mp3Queue(f.jobs, f.project, () => false, async (_source, output, signal) => {
    await writeFile(output, 'partial'); started();
    await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
  });
  try {
    await queue.track(f.files); await f.files.appendAudio(Buffer.from('source'), 0); await f.files.finish(true);
    const work = queue.drain(); await began; await queue.close(); await work;
    assert.equal((await readdir(f.jobs)).length, 1);
    assert.equal((await readdir(f.folder)).some(name => name.endsWith('.tmp') || name.endsWith('.mp3')), false);
  } finally { await queue.close(); await rm(f.root, { recursive: true, force: true }); }
});
test('a replaced source symlink cannot redirect conversion into a project', async () => {
  const f = await fixture(); let calls = 0;
  const queue = new Mp3Queue(f.jobs, f.project, () => false, async () => { calls++; });
  try {
    await queue.track(f.files); await f.files.appendAudio(Buffer.from('source'), 0); await f.files.finish(true);
    await writeFile(path.join(f.project, 'private.webm'), 'private');
    await rm(f.files.file('webm')); await symlink(path.join(f.project, 'private.webm'), f.files.file('webm'));
    await queue.drain(); assert.equal(calls, 0);
  } finally { await queue.close(); await rm(f.root, { recursive: true, force: true }); }
});
test('bundled FFmpeg converts synthetic WebM to playable mono 24 kHz MP3', async () => {
  assert.ok(ffmpeg);
  const f = await fixture();
  try {
    await f.files.finish(false);
    const exec = promisify(execFile);
    await exec(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-y', f.files.file('webm')]);
    await convertMp3(f.files.file('webm'), f.files.file('mp3'), new AbortController().signal);
    const { stderr } = await exec(ffmpeg, ['-hide_banner', '-i', f.files.file('mp3'), '-f', 'null', '-']);
    assert.match(stderr, /24000 Hz, mono/); assert.match(stderr, /Audio: mp3/);
    assert.ok((await readFile(f.files.file('mp3'))).length > 1000);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('filesystems without hard links publish by reservation and never replace existing output', async () => {
  const f = await fixture();
  const unsupported = async () => { throw Object.assign(new Error('Synthetic exFAT'), { code: 'ENOTSUP' }); };
  try {
    await f.files.finish(false);
    const temp = path.join(f.folder, 'encoded.tmp'), output = f.files.file('mp3');
    await writeFile(temp, 'complete MP3');
    await publishMp3(temp, output, f.files.id, unsupported);
    assert.equal(await readFile(output, 'utf8'), 'complete MP3');
    await writeFile(temp, 'replacement');
    await assert.rejects(publishMp3(temp, output, f.files.id, unsupported), { code: 'EEXIST' });
    assert.equal(await readFile(output, 'utf8'), 'complete MP3');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
