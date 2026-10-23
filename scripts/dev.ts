import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';
try { loadEnvFile('.env'); } catch { /* Environment variables can be set externally. */ }
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: 'inherit', env: { ...process.env, CLEARSCRIBE_DEV: '1' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  children.forEach(c => c.kill('SIGTERM'));
  process.exitCode = code;
}
children.forEach(c => c.on('exit', code => close(code || 0)));
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
