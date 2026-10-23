import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { configDirectory, readSettings, writeSettings } from '../server/settings.js';
import { createApp, type AppOptions } from '../server/app.js';

test('platform configuration paths and explicit override', () => {
  assert.equal(configDirectory('darwin', {}, '/user'), '/user/Library/Application Support/ClearScribe');
  assert.equal(configDirectory('win32', { APPDATA: 'C:\\Users\\Test\\AppData\\Roaming' }, 'C:\\Users\\Test'), 'C:\\Users\\Test\\AppData\\Roaming\\ClearScribe');
  assert.equal(configDirectory('win32', {}, 'C:\\Users\\Test'), 'C:\\Users\\Test\\AppData\\Roaming\\ClearScribe');
  assert.equal(configDirectory('linux', {}, '/user'), '/user/.config/clearscribe');
  assert.equal(configDirectory('linux', { XDG_CONFIG_HOME: '/config' }, '/user'), '/config/clearscribe');
  assert.equal(configDirectory('darwin', { CLEARSCRIBE_CONFIG_DIR: '/custom' }), '/custom');
});

test('settings persist atomically, reject malformed versions and preserve the previous file on failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clearscribe-settings-'));
  const filename = path.join(root, 'config', 'settings.json');
  try {
    assert.equal(await readSettings(filename), undefined);
    const value = { version: 1 as const, saveFolder: path.join(root, 'recordings') };
    await writeSettings(filename, value); assert.deepEqual(await readSettings(filename), value);
    await writeSettings(filename, { ...value, saveFolder: root });
    assert.equal((await readSettings(filename))?.saveFolder, root);
    assert.deepEqual(await readdir(path.dirname(filename)), ['settings.json']);
    await writeFile(filename, '{broken'); await assert.rejects(readSettings(filename));
    await writeFile(filename, JSON.stringify({ version: 2, saveFolder: root })); await assert.rejects(readSettings(filename));
    await writeFile(filename, JSON.stringify({ version: 1, saveFolder: 'relative' })); await assert.rejects(readSettings(filename));
    const blocker = path.join(root, 'blocker'); await writeFile(blocker, 'untouched');
    await assert.rejects(writeSettings(path.join(blocker, 'settings.json'), value));
    assert.equal(await readFile(blocker, 'utf8'), 'untouched');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('service restart restores a validated folder with a fresh ID; unavailable folders warn and cancelled picker preserves settings', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'clearscribe-restart-')));
  const project = path.join(root, 'project'), folder = path.join(root, 'output'), settingsFile = path.join(root, 'config', 'settings.json');
  await mkdir(project); await mkdir(folder);
  let selection: string | null = folder;
  async function launch() {
    const options: AppOptions = { port: 0, project, settingsFile, key: '', picker: async () => selection };
    const app = createApp(options);
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    options.port = (app.server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${options.port}`;
    const response = await fetch(base + '/api/bootstrap'); const boot = await response.json() as any;
    const pick = () => fetch(base + '/api/folder', { method: 'POST', headers: { cookie: response.headers.get('set-cookie')!.split(';')[0], 'x-csrf-token': boot.token } }).then(r => r.json()) as Promise<any>;
    return { app, boot, pick };
  }
  let running: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    running = await launch(); assert.equal(running.boot.folder, undefined);
    const chosen = await running.pick(); assert.equal(chosen.folder.path, folder);
    await running.app.close(); running = await launch();
    assert.equal(running.boot.folder.path, folder); assert.notEqual(running.boot.folder.id, chosen.folder.id);
    selection = null; const cancelled = await running.pick(); assert.equal(cancelled.cancelled, true); assert.equal(cancelled.folder.path, folder);
    await running.app.close(); await rm(folder, { recursive: true }); running = await launch();
    assert.equal(running.boot.folder, undefined); assert.match(running.boot.settingsWarning, /unavailable/);
    assert.equal((await readSettings(settingsFile))?.saveFolder, folder);
    await running.app.close(); await writeFile(settingsFile, '{broken'); running = await launch();
    assert.equal(running.boot.folder, undefined); assert.match(running.boot.settingsWarning, /unavailable/);
  } finally { await running?.app.close(); await rm(root, { recursive: true, force: true }); }
});
