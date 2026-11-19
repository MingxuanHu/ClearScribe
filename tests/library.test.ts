import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createApp } from '../server/app';
import { listConversations, parseMetadata, saveConversation } from '../server/library';
import { transcriptBlocks } from '../src/Library';

const id = '2026-11-19_14-51-47+1100';
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'clearscribe-library-')));
  const folder = path.join(root, 'recordings'), project = path.join(root, 'project');
  await mkdir(folder); await mkdir(project);
  const transcript = 'ClearScribe\nStarted: Synthetic fixture\nNotice: Test notice\n\n[00:00:00] [First caption: unavailable] A searchable Kafka conversation.\n\n[00:00:17] [First caption: ~1200 ms] [PROVISIONAL] Still speaking.\n';
  await writeFile(path.join(folder, `${id}.txt`), transcript);
  await writeFile(path.join(folder, `${id}.webm`), '0123456789');
  await writeFile(path.join(folder, `${id}.mp3`), 'synthetic mp3');
  const options = { port: 0, project, key: '', picker: async () => folder };
  const app = createApp(options); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  options.port = (app.server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${options.port}`;
  const bootstrap = await fetch(origin + '/api/bootstrap'); const boot = await bootstrap.json() as any;
  const headers = { cookie: bootstrap.headers.get('set-cookie')!.split(';')[0], 'x-csrf-token': boot.token };
  const api = (url: string, init: RequestInit = {}) => fetch(origin + url, { ...init, headers: { ...headers, ...init.headers } });
  const selected = await (await api('/api/folder', { method: 'POST' })).json() as any;
  const base = `/api/library?folderId=${selected.folder.id}`;
  return { root, folder, project, transcript, origin, api, base, folderId: selected.folder.id,
    close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('legacy file triplets become one searchable conversation; titles persist without renaming originals', async () => {
  const f = await fixture();
  try {
    const list = await (await f.api(f.base)).json() as any;
    assert.equal(list.total, 1); assert.deepEqual(list.items[0].files, ['mp3', 'txt', 'webm']);
    assert.equal(list.items[0].recordedAt, '2026-11-19T14:51:47+11:00');
    assert.equal((await (await f.api(f.base + '&q=kafka')).json() as any).total, 1);
    assert.equal((await (await f.api(f.base + '&q=missing')).json() as any).total, 0);
    const details = { title: 'Recruiter conversation', description: 'Follow up about the backend role.' };
    assert.equal((await f.api(f.base + '&id=' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify(details) })).status, 200);
    const restored = await listConversations(f.folder);
    assert.equal(restored[0].title, details.title); assert.equal(restored[0].description, details.description);
    assert.equal((await (await f.api(f.base + '&q=follow%20up')).json() as any).total, 1);
    assert.equal(await readFile(path.join(f.folder, `${id}.txt`), 'utf8'), f.transcript);
    assert.equal(await readFile(path.join(f.folder, `${id}.webm`), 'utf8'), '0123456789');
    const result = await (await f.api(f.base + '&id=' + encodeURIComponent(id))).json() as any;
    assert.equal(result.transcript, f.transcript);
    assert.equal((await f.api(f.base + '&id=' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ title: '', description: '' }) })).status, 400);
    assert.equal((await listConversations(f.folder))[0].title, details.title);
  } finally { await f.close(); }
});

test('historical audio supports byte ranges, suffixes, HEAD, and download; invalid ranges are rejected', async () => {
  const f = await fixture();
  try {
    const file = `/api/library/file?folderId=${f.folderId}&id=${encodeURIComponent(id)}&extension=webm`;
    let response = await f.api(file, { headers: { Range: 'bytes=2-5' } });
    assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await response.text(), '2345');
    response = await f.api(file, { headers: { Range: 'bytes=-3' } }); assert.equal(await response.text(), '789');
    response = await f.api(file, { method: 'HEAD' }); assert.equal(response.headers.get('content-length'), '10'); assert.equal(await response.text(), '');
    response = await f.api(file + '&download=1'); assert.match(response.headers.get('content-disposition')!, /^attachment/); assert.equal(await response.text(), '0123456789');
    for (const range of ['bytes=99-', 'bytes=4-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4']) assert.equal((await f.api(file, { headers: { Range: range } })).status, 416);
  } finally { await f.close(); }
});

test('library enforces authentication, CSRF, selected folder identity, known IDs and symlink boundaries', async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.origin + f.base)).status, 403);
    assert.equal((await f.api(f.base + '&id=' + encodeURIComponent(id), { method: 'POST', headers: { 'x-csrf-token': 'wrong' }, body: '{}' })).status, 403);
    assert.equal((await f.api('/api/library?folderId=stale')).status, 409);
    assert.equal((await f.api(f.base + '&id=..%2Fsecret')).status, 400);
    const outside = path.join(f.root, 'private.txt'); await writeFile(outside, 'private');
    const otherId = '2026-11-18_14-51-47+1100';
    await symlink(outside, path.join(f.folder, `${otherId}.txt`));
    assert.equal((await listConversations(f.folder)).length, 1);
    const file = `/api/library/file?folderId=${f.folderId}&id=${encodeURIComponent(otherId)}&extension=txt`;
    assert.equal((await f.api(file)).status, 400);
    assert.equal((await f.api(f.base + '&id=' + encodeURIComponent(otherId), { method: 'POST', body: JSON.stringify({ title: 'No', description: '' }) })).status, 404);
    await symlink(outside, path.join(f.folder, `${id}.clearscribe.json`));
    assert.match((await listConversations(f.folder))[0].metadataWarning!, /could not be read/);
    await saveConversation(f.folder, id, { title: 'Safe replacement', description: '' });
    assert.equal(await readFile(outside, 'utf8'), 'private');
    assert.equal((await listConversations(f.folder))[0].title, 'Safe replacement');
  } finally { await f.close(); }
});

test('partial audio, missing formats, corrupt metadata, pagination and stable sort remain manageable', async () => {
  const f = await fixture();
  try {
    for (let i = 1; i <= 52; i++) await writeFile(path.join(f.folder, `2026-11-18_14-51-47+1100-${i}.webm.part`), 'partial');
    await writeFile(path.join(f.folder, `${id}.clearscribe.json`), '{broken');
    await writeFile(path.join(f.folder, 'unrelated.txt'), 'not a recording');
    await writeFile(path.join(f.folder, '2026-11-18_14-51-47+1100-1.webm'), '');
    assert.deepEqual((await listConversations(f.folder)).find(item => item.id === '2026-11-18_14-51-47+1100-1')!.files, ['webm.part']);
    const list = await (await f.api(f.base)).json() as any;
    assert.equal(list.total, 53); assert.equal(list.items.length, 50); assert.equal(list.items[0].id, id);
    assert.match(list.items[0].metadataWarning, /could not be read/);
    const next = await (await f.api(f.base + '&offset=50')).json() as any;
    assert.equal(next.items.length, 3);
    const oldest = await (await f.api(f.base + '&sort=oldest')).json() as any;
    assert.ok(oldest.items[0].id.startsWith('2026-11-18'));
    assert.equal((await (await f.api(f.base + '&id=' + encodeURIComponent(oldest.items[0].id))).json() as any).transcript, '');
    assert.throws(() => parseMetadata({ title: 'a'.repeat(201), description: '' }));
    assert.throws(() => parseMetadata({ title: 'Title', description: 'a'.repeat(4001) }));
  } finally { await f.close(); }
});

test('review parser preserves notices, timing annotations, multiline content and provisional status', () => {
  const blocks = transcriptBlocks('ClearScribe\nNotice: Incomplete recording\n\n[00:00:17] [First caption: ~1200 ms] [PROVISIONAL] First line\nsecond line\n\n[01:02:03] Confirmed');
  assert.match(blocks[0].text, /Notice: Incomplete/);
  assert.equal(blocks[1].seconds, 17); assert.match(blocks[1].text, /\[PROVISIONAL\] First line\nsecond line/);
  assert.equal(blocks[2].seconds, 3723);
});


test('deleting a conversation removes all exact related files and preserves neighbors and symlink targets', async () => {
  const f = await fixture();
  try {
    const outside = path.join(f.root, 'unrelated.txt'); await writeFile(outside, 'Keep outside target');
    await symlink(outside, path.join(f.folder, `${id}.ogg`));
    for (const extension of ['m4a', 'webm.part', 'm4a.part', 'ogg.part', 'txt.tmp', 'clearscribe.json']) await writeFile(path.join(f.folder, `${id}.${extension}`), '{}');
    await writeFile(path.join(f.folder, `.${id}.mp3.12345678-1234-1234-1234-123456789abc.tmp`), 'conversion temp');
    const neighbor = `${id}-1.txt`; await writeFile(path.join(f.folder, neighbor), 'Keep neighboring recording');
    const unrelated = `${id}.personal.txt`; await writeFile(path.join(f.folder, unrelated), 'Not managed by ClearScribe');
    const url = f.base + '&id=' + encodeURIComponent(id);
    assert.equal((await f.api(url, { method: 'DELETE', headers: { 'x-csrf-token': 'wrong' } })).status, 403);
    assert.equal((await f.api('/api/library?folderId=stale&id=' + encodeURIComponent(id), { method: 'DELETE' })).status, 409);
    assert.equal((await f.api(f.base + '&id=..%2Fother', { method: 'DELETE' })).status, 400);
    assert.equal((await f.api(url, { method: 'DELETE' })).status, 200);
    assert.deepEqual((await readdir(f.folder)).sort(), [neighbor, unrelated].sort());
    assert.equal(await readFile(outside, 'utf8'), 'Keep outside target');
    assert.equal((await (await f.api(f.base)).json() as any).total, 1);
    assert.equal((await f.api(url, { method: 'DELETE' })).status, 404);
  } finally { await f.close(); }
});

test('deletion refuses directory replacements and can retry a metadata-only conversation', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.folder, `${id}.ogg`));
    const url = f.base + '&id=' + encodeURIComponent(id);
    assert.equal((await f.api(url, { method: 'DELETE' })).status, 507);
    assert.equal(await readFile(path.join(f.folder, `${id}.txt`), 'utf8'), f.transcript);
    await rm(path.join(f.folder, `${id}.ogg`), { recursive: true });
    for (const extension of ['txt', 'mp3', 'webm']) await rm(path.join(f.folder, `${id}.${extension}`));
    await saveConversation(f.folder, id, { title: 'Remaining details', description: 'Retry cleanup' });
    assert.equal((await listConversations(f.folder))[0].title, 'Remaining details');
    assert.equal((await f.api(url, { method: 'DELETE' })).status, 200);
    assert.deepEqual(await readdir(f.folder), []);
  } finally { await f.close(); }
});
