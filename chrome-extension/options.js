import { appUrl } from './url.js';
const input = document.querySelector('#url');
const status = document.querySelector('#status');
chrome.storage.local.get('url').then(({ url }) => { input.value = url || appUrl(); });
document.querySelector('#settings').addEventListener('submit', async event => {
  event.preventDefault();
  try { await chrome.storage.local.set({ url: appUrl(input.value) }); status.textContent = 'Saved.'; }
  catch (error) { status.textContent = error.message; }
});
document.querySelector('#shortcuts').addEventListener('click', () => { chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); });
