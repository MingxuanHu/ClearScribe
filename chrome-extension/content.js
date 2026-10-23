// Only an extension message initiates a request; loading/reloading the page does not.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message.type !== 'clearscribe-start') return;
  const requestId = message.requestId;
  const receive = event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'clearscribe-start-ack' || event.data.requestId !== requestId) return;
    clearInterval(retry); clearTimeout(timeout); window.removeEventListener('message', receive);
    reply({ accepted: true });
  };
  const send = () => window.postMessage({ type: 'clearscribe-start', requestId }, location.origin);
  window.addEventListener('message', receive);
  const retry = setInterval(send, 200);
  const timeout = setTimeout(() => {
    clearInterval(retry); window.removeEventListener('message', receive); reply({ accepted: false });
  }, 1000);
  send();
  return true;
});
