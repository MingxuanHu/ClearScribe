import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
export function equal(a: string | undefined, b: string) {
  return !!a && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function localRequest(req: IncomingMessage, port: number, devPort?: number) {
  const hosts = [`127.0.0.1:${port}`, ...(devPort ? [`127.0.0.1:${devPort}`] : [])];
  if (!hosts.includes(req.headers.host || '')) return false;
  if (req.headers.origin && !hosts.map(h => `http://${h}`).includes(req.headers.origin)) return false;
  return !req.headers['sec-fetch-site'] || ['same-origin', 'none', 'same-site'].includes(String(req.headers['sec-fetch-site']));
}
export function safeError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC') return 'Save failed: disk is full. Free space and start a new call.';
  if (['EACCES', 'EPERM', 'EROFS'].includes(code || '')) return 'Save failed: folder is not writable. Choose another folder.';
  if (['ENOENT', 'ENODEV', 'EIO', 'ESTALE'].includes(code || '')) return 'Save failed: folder or drive is unavailable.';
  return 'Operation failed. Check the selected folder, local service, and network; retry safely.';
}
export function upstreamError(code: unknown): string {
  const codes: Record<string, string> = {
    invalid_api_key: 'OpenAI rejected the API key. Update the backend .env and restart.',
    insufficient_quota: 'OpenAI quota is exhausted. Check API billing.',
    rate_limit_exceeded: 'OpenAI rate limit reached. Stop and retry later.',
    model_not_found: 'This account cannot use the selected model. No fallback model was used.',
    session_expired: 'The upstream transcription session expired. Start a new call.',
  };
  return codes[String(code)] || 'OpenAI rejected or interrupted transcription. Check model access, API billing, context settings, and network. No automatic retry was made.';
}
