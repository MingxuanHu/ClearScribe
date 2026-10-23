import { appUrl } from './url.js';
let opening = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function launch() {
  if (opening) return;
  opening = true;
  try {
    await chrome.action.setBadgeText({ text: '' });
    const { url } = await chrome.storage.local.get('url');
    const target = appUrl(url);
    const tabs = await chrome.tabs.query({ url: `${new URL(target).origin}/*` });
    let tab = tabs.find(t => t.url === target) || tabs.find(t => t.url?.split(/[?#]/)[0] === target);
    if (tab) await chrome.tabs.update(tab.id, { active: true });
    else tab = await chrome.tabs.create({ url: target, active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    // New tabs may not yet have their content script. A single acknowledged request
    // queues the start until the app's settings and model list are ready.
    const requestId = crypto.randomUUID();
    let delivered = false;
    for (let i = 0; i < 40; i++) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'clearscribe-start', requestId });
        if (response?.accepted) { delivered = true; break; }
      } catch { /* Wait for navigation and content script injection. */ }
      await pause(250);
    }
    if (!delivered) throw new Error('Cannot reach ClearScribe. Start the local service, check the app URL in extension options, then retry.');
    await chrome.action.setTitle({ title: 'Open ClearScribe and start recording' });
  } catch (error) {
    await chrome.action.setBadgeBackgroundColor({ color: '#a13e32' });
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setTitle({ title: error.message });
  } finally { opening = false; }
}
chrome.commands.onCommand.addListener(command => { if (command === 'start-session') void launch(); });
chrome.action.onClicked.addListener(() => { void launch(); });
