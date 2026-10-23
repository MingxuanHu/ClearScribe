import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
// @ts-expect-error Extension modules are shipped as browser JavaScript.
import { appUrl } from '../chrome-extension/url.js';

test('extension accepts only local app root URLs', () => {
  assert.equal(appUrl(), 'http://127.0.0.1:4317/');
  assert.equal(appUrl('http://127.0.0.1:5173'), 'http://127.0.0.1:5173/');
  for (const url of ['https://example.com/', 'http://localhost:4317/', 'http://127.0.0.1:4317/other', 'http://127.0.0.1:4317/?start=1', 'http://user@127.0.0.1:4317/']) assert.throws(() => appUrl(url));
});

test('shortcut creates a missing tab, focuses window, waits for content script; existing tab is reused and repeated triggers coalesce', async () => {
  const source = (await readFile(new URL('../chrome-extension/background.js', import.meta.url), 'utf8')).replace("import { appUrl } from './url.js';", '');
  for (const existing of [false, true]) {
    const calls: any[] = []; let trigger: (command: string) => void = () => {}; let toolbar: () => void = () => {};
    let deliveries = 0;
    const chrome = {
      storage: { local: { get: async () => ({}) } },
      action: {
        setBadgeText: async (value: any) => { calls.push(['badge', value]); }, setBadgeBackgroundColor: async () => {}, setTitle: async () => {},
        onClicked: { addListener: (listener: () => void) => { toolbar = listener; } },
      },
      tabs: {
        query: async () => existing ? [{ id: 7, windowId: 8, url: appUrl() }] : [],
        create: async (value: any) => { calls.push(['create', value]); return { id: 7, windowId: 8 }; },
        update: async (...args: any[]) => { calls.push(['update', ...args]); },
        sendMessage: async (...args: any[]) => { calls.push(['send', ...args]); if (++deliveries === 1) throw new Error('not ready'); return { accepted: true }; },
      },
      windows: { update: async (...args: any[]) => { calls.push(['focus', ...args]); } },
      commands: { onCommand: { addListener: (listener: typeof trigger) => { trigger = listener; } } },
    };
    const context = vm.createContext({ chrome, appUrl, URL, crypto, setTimeout: (callback: () => void) => setTimeout(callback, 0) });
    vm.runInContext(source, context);
    trigger('start-session'); toolbar();
    // Wait for the actual async workflow, rather than a fixed wall-clock delay.
    await vm.runInContext('(async () => { while (opening) await pause(1); })()', context);
    assert.equal(calls.filter(c => c[0] === 'create').length, existing ? 0 : 1);
    assert.equal(calls.filter(c => c[0] === 'update').length, existing ? 1 : 0);
    assert.equal(calls.filter(c => c[0] === 'focus').length, 1);
    assert.equal(deliveries, 2);
    assert.equal(calls.find(c => c[0] === 'send')[2].requestId, calls.filter(c => c[0] === 'send')[1][2].requestId);
  }
});

test('content bridge waits for app readiness, checks sender/origin and acknowledges one start request', async () => {
  const source = await readFile(new URL('../chrome-extension/content.js', import.meta.url), 'utf8');
  let listener: any; let receive: any; let retry: any; let timeout: any;
  const sent: any[] = []; const replies: any[] = [];
  const window = {
    addEventListener: (_: string, callback: any) => { receive = callback; },
    removeEventListener: (_: string, callback: any) => { if (receive === callback) receive = undefined; },
    postMessage: (...args: any[]) => { sent.push(args); },
  };
  vm.runInNewContext(source, {
    chrome: { runtime: { id: 'test-extension', onMessage: { addListener: (callback: any) => { listener = callback; } } } },
    window, location: { origin: 'http://127.0.0.1:4317' },
    setInterval: (callback: any) => { retry = callback; return 1; }, clearInterval: () => { retry = undefined; },
    setTimeout: (callback: any) => { timeout = callback; return 2; }, clearTimeout: () => { timeout = undefined; },
  });
  const message = { type: 'clearscribe-start', requestId: 'request-1' };
  listener(message, { id: 'other-extension' }, (value: any) => replies.push(value)); assert.equal(sent.length, 0);
  assert.equal(listener(message, { id: 'test-extension' }, (value: any) => replies.push(value)), true);
  retry(); assert.equal(sent.length, 2); assert.equal(replies.length, 0);
  const ack = { source: window, origin: 'http://127.0.0.1:4317', data: { type: 'clearscribe-start-ack', requestId: 'request-1' } };
  receive({ ...ack, origin: 'https://example.com' }); assert.equal(replies.length, 0);
  receive(ack); assert.equal(replies[0].accepted, true);
  assert.equal(receive, undefined); assert.equal(retry, undefined); assert.equal(typeof timeout, 'undefined');
  listener(message, { id: 'test-extension' }, (value: any) => replies.push(value));
  timeout(); assert.equal(replies[1].accepted, false); assert.equal(receive, undefined); assert.equal(retry, undefined);
});
