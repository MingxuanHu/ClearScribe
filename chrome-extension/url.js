export function appUrl(value = 'http://127.0.0.1:4317/') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use a local root URL such as http://127.0.0.1:4317/ or http://127.0.0.1:5173/.');
  }
  return url.href;
}
