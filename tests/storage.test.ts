import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { basename, CallFiles, validateFolder } from '../server/storage.js';
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'clearscribe-test-')));
  const project = path.join(root, 'project'), folder = path.join(root, 'output');
  await mkdir(project); await mkdir(folder);
  return { root, project, folder, cleanup: () => rm(root, { recursive: true, force: true }) };
}
test('save directories reject project descendants, nested Git worktrees and symlinks into projects', async () => {
  const f = await fixture();
  try {
    await assert.rejects(validateFolder(f.project, f.project));
    await mkdir(path.join(f.project, 'nested')); await assert.rejects(validateFolder(path.join(f.project, 'nested'), f.project));
    await symlink(f.project, path.join(f.root, 'alias')); await assert.rejects(validateFolder(path.join(f.root, 'alias'), f.project));
    await writeFile(path.join(f.folder, '.git'), 'gitdir: synthetic'); await assert.rejects(validateFolder(f.folder, f.project));
    await assert.rejects(validateFolder(path.join(f.root, 'missing'), f.project));
  } finally { await f.cleanup(); }
});
test('same-second collision protects files; exactly two flat outputs and correct continuous bytes', async () => {
  const f = await fixture();
  try {
    const date = new Date('2026-10-23T09:48:15Z');
    assert.match(basename(date), /^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d[+-]\d{4}$/);
    const a = new CallFiles(f.folder, f.project); await a.create('audio/webm', date);
    await a.saveText('Synthetic draft'); await a.saveText('Synthetic final');
    await a.appendAudio(Buffer.from('header'), 0); await a.appendAudio(Buffer.from('chunk'), 1);
    await a.finish(true);
    assert.equal(a.audioSaved, true); assert.equal(await readFile(a.file('txt'), 'utf8'), 'Synthetic final');
    assert.equal(await readFile(a.file('webm'), 'utf8'), 'headerchunk');
    assert.deepEqual((await readdir(f.folder)).sort(), [`${a.base}.txt`, `${a.base}.webm`].sort());
    const b = new CallFiles(f.folder, f.project); await b.create('audio/webm', date);
    assert.equal(b.base, `${a.base}-1`); await b.saveText('Second synthetic call'); await b.appendAudio(Buffer.from('audio'), 0); await b.finish(true);
    assert.equal((await readdir(f.folder)).length, 4);
    assert.equal(await readFile(a.file('txt'), 'utf8'), 'Synthetic final');
  } finally { await f.cleanup(); }
});
test('incomplete audio retains .part, removes final reservation; recording failure does not block TXT', async () => {
  const f = await fixture();
  try {
    const a = new CallFiles(f.folder, f.project); await a.create('audio/webm');
    await assert.rejects(a.appendAudio(Buffer.from('wrong sequence'), 2));
    await assert.rejects(a.appendAudio(Buffer.alloc(1024 * 1024 + 1), 0));
    await a.appendAudio(Buffer.from('partial'), 0); a.audioFailed = true;
    await a.saveText('Still available synthetic captions'); await a.finish(false);
    assert.equal(a.txtSaved, true); assert.equal(a.audioSaved, false);
    assert.deepEqual((await readdir(f.folder)).sort(), [`${a.base}.txt`, `${a.base}.webm.part`].sort());
  } finally { await f.cleanup(); }
});
test('read-only or removed output fails visibly and cannot redirect output into project', async () => {
  const f = await fixture();
  try {
    await rm(f.folder, { recursive: true }); await symlink(f.project, f.folder);
    await assert.rejects(new CallFiles(f.folder, f.project).create('audio/webm'));
    assert.deepEqual(await readdir(f.project), []);
  } finally { await f.cleanup(); }
});

test('actual write permissions are checked before a call creates outputs', async t => {
  if (process.getuid?.() === 0) { t.skip('root bypasses mode-bit write checks'); return; }
  const { chmod } = await import('node:fs/promises');
  const f = await fixture();
  try {
    await chmod(f.folder, 0o500);
    await assert.rejects(validateFolder(f.folder, f.project));
    await assert.rejects(new CallFiles(f.folder, f.project).create('audio/webm'));
  } finally { await chmod(f.folder, 0o700); await f.cleanup(); }
});
