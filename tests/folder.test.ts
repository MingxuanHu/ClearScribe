import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, realpath, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, type AppOptions } from '../server/app.js';

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'clearscribe-folder-')));
  const project = path.join(root, 'project'), folder = path.join(root, 'recordings & samples');
  const settingsFile = path.join(root, 'config', 'settings.json');
  await mkdir(project); await mkdir(folder);
  const opened: string[] = [];
  let opener = async () => {};
  const options: AppOptions = { port: 0, project, settingsFile, key: '', picker: async () => folder,
    openFolder: async selected => { opened.push(selected); await opener(); } };
  const app = createApp(options); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  options.port = (app.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${options.port}`;
  const response = await fetch(base + '/api/bootstrap'); const boot = await response.json() as any;
  const headers = { cookie: response.headers.get('set-cookie')!.split(';')[0], 'x-csrf-token': boot.token };
  const api = (url: string, init: RequestInit = {}) => fetch(base + url, { ...init, headers: { ...headers, ...init.headers } });
  const select = () => api('/api/folder', { method: 'POST' });
  const open = (init: RequestInit = {}) => api('/api/folder/open', { method: 'POST', ...init });
  return { root, project, folder, settingsFile, base, api, select, open, opened, setOpener: (value: typeof opener) => { opener = value; },
    async cleanup() { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('opening uses only the selected directory and never changes saved settings or selection', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.open()).status, 409); assert.deepEqual(f.opened, []);
    const selected = await f.select().then(response => response.json()) as any;
    await f.api('/api/preferences', { method: 'POST', body: JSON.stringify({ model: 'gpt-transcribe', captionFontSize: 34 }) });
    const before = await readFile(f.settingsFile, 'utf8');
    // A caller-supplied path must not select or launch any other directory.
    assert.equal((await f.open({ body: JSON.stringify({ path: f.project }) })).status, 200);
    assert.deepEqual(f.opened, [f.folder]);
    assert.equal(await readFile(f.settingsFile, 'utf8'), before);
    const boot = await f.api('/api/bootstrap').then(response => response.json()) as any;
    assert.deepEqual(boot.folder, selected.folder); assert.equal(boot.preferences.captionFontSize, 34);
    assert.equal((await f.api('/api/folder/open')).status, 404);
    assert.deepEqual(f.opened, [f.folder]);
  } finally { await f.cleanup(); }
});

test('opening requires local authentication and CSRF protection', async () => {
  const f = await fixture();
  try {
    await f.select();
    assert.equal((await fetch(f.base + '/api/folder/open', { method: 'POST' })).status, 403);
    assert.equal((await f.open({ headers: { 'x-csrf-token': '' } })).status, 403);
    assert.equal((await f.open({ headers: { origin: 'https://untrusted.example' } })).status, 403);
    assert.deepEqual(f.opened, []);
  } finally { await f.cleanup(); }
});

test('missing or redirected folders are not opened; reconnecting permits retry without changing selection', async () => {
  const f = await fixture();
  try {
    await f.select(); const before = await readFile(f.settingsFile, 'utf8');
    await rm(f.folder, { recursive: true });
    assert.equal((await f.open()).status, 404); assert.deepEqual(f.opened, []);
    await symlink(f.project, f.folder);
    assert.equal((await f.open()).status, 404); assert.deepEqual(f.opened, []);
    await rm(f.folder); await mkdir(f.folder);
    assert.equal((await f.open()).status, 200); assert.deepEqual(f.opened, [f.folder]);
    assert.equal(await readFile(f.settingsFile, 'utf8'), before);
  } finally { await f.cleanup(); }
});

test('launcher failure permits retry and duplicate folder actions cannot run concurrently', async () => {
  const f = await fixture();
  let release!: () => void;
  try {
    await f.select(); const before = await readFile(f.settingsFile, 'utf8');
    f.setOpener(async () => { throw new Error('Synthetic OS launch failure'); });
    assert.equal((await f.open()).status, 503);
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const finish = new Promise<void>(resolve => { release = resolve; });
    f.setOpener(async () => { started(); await finish; });
    const pending = f.open(); await began;
    assert.equal((await f.open()).status, 409);
    assert.equal((await f.select()).status, 409);
    release(); assert.equal((await pending).status, 200);
    assert.equal(f.opened.length, 2); assert.equal(await readFile(f.settingsFile, 'utf8'), before);
  } finally { release?.(); await f.cleanup(); }
});
