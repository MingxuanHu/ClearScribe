import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, realpath, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PREFERENCES, parsePreferencePatch, type Preferences } from '../shared/preferences.js';
import { readSettings, writeSettings } from '../server/settings.js';
import { createApp, type AppOptions } from '../server/app.js';
import { PreferenceSaver } from '../src/preferences.js';

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'clearscribe-preferences-')));
  const project = path.join(root, 'project'), folder = path.join(root, 'output'), second = path.join(root, 'second');
  const settingsFile = path.join(root, 'config', 'settings.json');
  await Promise.all([mkdir(project), mkdir(folder), mkdir(second)]);
  let selected: string | null = folder;
  const apps: ReturnType<typeof createApp>[] = [];
  async function launch() {
    const options: AppOptions = { port: 0, project, settingsFile, key: '', picker: async () => selected };
    const app = createApp(options); apps.push(app);
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    options.port = (app.server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${options.port}`;
    const response = await fetch(base + '/api/bootstrap');
    const boot = await response.json() as any;
    const headers = { cookie: response.headers.get('set-cookie')!.split(';')[0], 'x-csrf-token': boot.token };
    const api = (url: string, init: RequestInit = {}) => fetch(base + url, { ...init, headers: { ...headers, ...init.headers } });
    const patch = (value: object) => api('/api/preferences', { method: 'POST', body: JSON.stringify(value) });
    return { app, base, boot, api, patch };
  }
  return { root, project, folder, second, settingsFile, launch, select: (value: string | null) => { selected = value; },
    async cleanup() { for (const app of apps) await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('legacy folder configuration gains preferences without losing the folder, and restores after restart', async () => {
  const f = await fixture();
  try {
    await writeSettings(f.settingsFile, { version: 1, saveFolder: f.folder });
    const first = await f.launch();
    assert.equal(first.boot.preferencesSaved, false);
    assert.deepEqual(first.boot.preferences, DEFAULT_PREFERENCES);
    const preferred: Preferences = { microphoneId: 'synthetic-microphone-id', model: 'gpt-transcribe',
      keywords: 'Kubernetes\nOAuth', context: 'Synthetic interview context.', delay: 'medium',
      noiseSuppression: true, autoGainControl: false, echoCancellation: true, speechThreshold: 0.015,
      captionFontSize: 36, advancedOpen: true };
    assert.equal((await first.patch(preferred)).status, 200);
    await first.app.close();
    const next = await f.launch();
    assert.equal(next.boot.folder.path, f.folder); assert.equal(next.boot.preferencesSaved, true);
    assert.deepEqual(next.boot.preferences, preferred);
    assert.deepEqual(await readSettings(f.settingsFile), { version: 1, saveFolder: f.folder, preferences: preferred });
    const saved = await readFile(f.settingsFile, 'utf8');
    assert.ok(!saved.includes(next.boot.token)); assert.ok(!saved.includes('OPENAI_API_KEY'));
    // A disconnected output drive must not prevent preference recovery or erase its path.
    await next.app.close(); await rm(f.folder, { recursive: true });
    const unavailable = await f.launch();
    assert.equal(unavailable.boot.folder, undefined); assert.match(unavailable.boot.settingsWarning, /unavailable/);
    assert.deepEqual(unavailable.boot.preferences, preferred);
    assert.equal((await unavailable.patch({ captionFontSize: 40 })).status, 200);
    assert.equal((await readSettings(f.settingsFile))?.saveFolder, f.folder);
  } finally { await f.cleanup(); }
});

test('preferences can be saved before folder selection; concurrent patches and picker writes merge safely', async () => {
  const f = await fixture();
  try {
    const run = await f.launch();
    assert.equal((await run.patch({ microphoneId: 'saved-device', model: 'unavailable-model' })).status, 200);
    assert.equal((await readSettings(f.settingsFile))?.saveFolder, undefined);
    f.select(f.second);
    const results = await Promise.all([
      run.api('/api/folder', { method: 'POST' }), run.patch({ captionFontSize: 32 }),
      run.patch({ noiseSuppression: true, keywords: 'Synthetic\nDraft' }),
    ]);
    assert.ok(results.every(result => result.status === 200));
    const saved = await readSettings(f.settingsFile);
    assert.equal(saved?.saveFolder, f.second);
    assert.equal(saved?.preferences?.captionFontSize, 32); assert.equal(saved?.preferences?.noiseSuppression, true);
    assert.equal(saved?.preferences?.microphoneId, 'saved-device'); assert.equal(saved?.preferences?.model, 'unavailable-model');
    await run.app.close();
    const restored = await f.launch();
    assert.equal(restored.boot.preferences.model, 'unavailable-model');
    assert.equal(restored.boot.preferences.microphoneId, 'saved-device');
    f.select(null); await restored.api('/api/folder', { method: 'POST' });
    assert.deepEqual(await readSettings(f.settingsFile), saved);
  } finally { await f.cleanup(); }
});

test('preference endpoint enforces authentication, CSRF, schema, and body bounds without altering saved settings', async () => {
  const f = await fixture();
  try {
    const run = await f.launch(); await run.patch({ model: 'gpt-transcribe' });
    const before = await readFile(f.settingsFile, 'utf8');
    assert.equal((await fetch(run.base + '/api/preferences', { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await run.api('/api/preferences', { method: 'POST', headers: { 'x-csrf-token': '' }, body: '{}' })).status, 403);
    assert.equal((await run.api('/api/preferences', { method: 'POST', headers: { origin: 'https://untrusted.example' }, body: '{}' })).status, 403);
    for (const value of [{ captionFontSize: 100 }, { autoGainControl: 'false' }, { speechThreshold: -1 },
      { microphoneId: null }, { model: '' }, { saveFolder: f.project }, { context: 'x'.repeat(401) },
      { keywords: 'x'.repeat(4097) }, { advancedOpen: 1 }, { delay: 'high' }]) {
      assert.equal((await run.patch(value)).status, 400);
    }
    assert.equal((await run.api('/api/preferences', { method: 'POST', body: '{bad' })).status, 400);
    assert.equal((await run.api('/api/preferences', { method: 'POST', body: 'x'.repeat(48 * 1024 + 1) })).status, 413);
    assert.equal(await readFile(f.settingsFile, 'utf8'), before);
    assert.throws(() => parsePreferencePatch(JSON.parse('{"__proto__":{}}')));
  } finally { await f.cleanup(); }
});

test('failed preference writes preserve prior settings and can be retried after permissions recover', async t => {
  if (process.getuid?.() === 0) { t.skip('root bypasses permission checks'); return; }
  const f = await fixture();
  try {
    const run = await f.launch(); await run.api('/api/folder', { method: 'POST' }); await run.patch({ captionFontSize: 30 });
    const before = await readFile(f.settingsFile, 'utf8');
    await chmod(path.dirname(f.settingsFile), 0o500);
    assert.equal((await run.patch({ captionFontSize: 38 })).status, 507);
    assert.equal(await readFile(f.settingsFile, 'utf8'), before);
    const boot = await run.api('/api/bootstrap').then(response => response.json()) as any;
    assert.equal(boot.preferences.captionFontSize, 30);
    await chmod(path.dirname(f.settingsFile), 0o700);
    assert.equal((await run.patch({ captionFontSize: 38 })).status, 200);
    assert.equal((await readSettings(f.settingsFile))?.preferences?.captionFontSize, 38);
    assert.equal((await readSettings(f.settingsFile))?.saveFolder, f.folder);
  } finally { await chmod(path.dirname(f.settingsFile), 0o700).catch(() => {}); await f.cleanup(); }
});

test('preference saver coalesces fast edits and serializes changes made during a slow save', async () => {
  const calls: Partial<Preferences>[] = [];
  let release!: () => void;
  const slow = new Promise<void>(resolve => { release = resolve; });
  const saver = new PreferenceSaver(async patch => { calls.push(patch); if (calls.length === 1) await slow; }, () => {});
  saver.enqueue({ captionFontSize: 29 }); saver.enqueue({ captionFontSize: 30, model: 'gpt-transcribe' });
  const first = saver.flush();
  saver.enqueue({ model: 'gpt-live-transcribe' }); saver.enqueue({ noiseSuppression: true });
  assert.equal(calls.length, 1);
  release(); await first; await saver.flush();
  assert.deepEqual(calls, [{ captionFontSize: 30, model: 'gpt-transcribe' }, { model: 'gpt-live-transcribe', noiseSuppression: true }]);
});

test('failed browser saves retain edits and merge newer choices into the retry', async () => {
  let fail = true;
  const calls: Partial<Preferences>[] = [], reports: boolean[] = [];
  const saver = new PreferenceSaver(async patch => { calls.push(patch); if (fail) throw new Error('Synthetic outage'); }, value => { reports.push(value); });
  saver.enqueue({ model: 'gpt-transcribe', microphoneId: 'saved-mic' }); await saver.flush();
  fail = false; saver.enqueue({ model: 'gpt-live-transcribe', captionFontSize: 34 }); await saver.flush();
  assert.deepEqual(calls[1], { model: 'gpt-live-transcribe', microphoneId: 'saved-mic', captionFontSize: 34 });
  assert.deepEqual(reports, [true, false]);
});
