import path from 'node:path';
import { configDirectory } from './settings.js';
import { createApp } from './app.js';
const port = Number(process.env.PORT || 4317);
const devPort = process.env.CLEARSCRIBE_DEV === '1' ? Number(process.env.DEV_PORT || 5173) : undefined;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
const app = createApp({ settingsFile: path.join(configDirectory(), 'settings.json'), port, devPort, project: process.cwd(), key: process.env.OPENAI_API_KEY?.trim() || '' });
if (!process.env.OPENAI_API_KEY?.trim()) console.warn('ClearScribe: OPENAI_API_KEY is missing. Configure the backend .env and restart.');
app.server.listen(port, '127.0.0.1', () => console.log(`ClearScribe local service: http://127.0.0.1:${port}`));
app.server.on('error', () => { console.error('ClearScribe could not bind its local port. Check whether it is already running.'); process.exitCode = 1; });
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (closing) return; closing = true;
  const deadline = setTimeout(() => process.exit(1), 12000); deadline.unref();
  void app.close().finally(() => { clearTimeout(deadline); process.exit(); });
});
