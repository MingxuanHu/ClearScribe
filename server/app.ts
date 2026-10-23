import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { ModelCatalog, compatible, parseSettings } from './models.js';
import { chooseFolder, validateFolder, CallFiles, MIME_EXTENSIONS } from './storage.js';
import { equal, localRequest, safeError } from './security.js';
import { readSettings, writeSettings } from './settings.js';
import { CallSession, ConnectionError, type UpstreamFactory } from './session.js';
export interface AppOptions { settingsFile?: string; port: number; devPort?: number; project: string; key: string; picker?: typeof chooseFolder; upstream?: UpstreamFactory; request?: typeof fetch }
export function createApp(options: AppOptions) {
  const token = randomBytes(32).toString('hex');
  const catalog = new ModelCatalog(options.key, options.request);
  let folder: { id: string; path: string } | undefined;
  let settingsWarning: string | undefined;
  const restored = (async () => {
    if (!options.settingsFile) return;
    try {
      const saved = await readSettings(options.settingsFile);
      if (saved) folder = { id: randomBytes(16).toString('hex'), path: await validateFolder(saved.saveFolder, options.project) };
    } catch {
      settingsWarning = 'Saved settings or save folder are unavailable. Reconnect the drive and restart, or choose a writable save folder again.';
    }
  })();
  let picking = false;
  let active: CallSession | undefined;
  let owner: WebSocket | undefined;
  let lastFiles: CallFiles | undefined;
  let starting = false;
  const ws = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  function authenticated(req: IncomingMessage) { return equal(req.headers.cookie?.split('; ').find(c => c.startsWith('cs_session='))?.slice(11), token); }
  function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
  const server = http.createServer((req, res) => { void handle(req, res); });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:*; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (!localRequest(req, options.port, options.devPort)) { json(res, 403, { error: 'Untrusted local origin or Host.' }); return; }
    const url = new URL(req.url || '/', `http://127.0.0.1:${options.port}`);
    try {
      await restored;
      if (url.pathname === '/api/bootstrap' && req.method === 'GET') {
        res.setHeader('Set-Cookie', `cs_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
        json(res, 200, { token, keyConfigured: !!options.key, folder, files: active?.files.info() || lastFiles?.info(), active: !!active && active.phase !== 'stopped', platform: process.platform, settingsWarning }); return;
      }
      if (url.pathname.startsWith('/api/')) {
        if (!authenticated(req) || (req.method !== 'GET' && !equal(String(req.headers['x-csrf-token'] || ''), token))) { json(res, 403, { error: 'Reload the local app to establish a trusted session.' }); return; }
        if (url.pathname === '/api/models' && req.method === 'GET') { json(res, 200, await catalog.list(url.searchParams.get('refresh') === '1')); return; }
        if (url.pathname === '/api/folder' && req.method === 'POST') {
          if (starting || picking || (active && active.phase !== 'stopped')) { json(res, 409, { error: 'Finish the current call or folder dialog first.' }); return; }
          picking = true;
          try {
            const selected = await (options.picker || chooseFolder)();
            if (selected) {
              const selectedPath = await validateFolder(selected, options.project);
              if (options.settingsFile) {
                try { await writeSettings(options.settingsFile, { version: 1, saveFolder: selectedPath }); }
                catch { json(res, 500, { error: 'Could not save settings. Check permissions and free space in the configuration directory (or CLEARSCRIBE_CONFIG_DIR), then choose the folder again. The previous selection was kept.' }); return; }
              }
              folder = { id: randomBytes(16).toString('hex'), path: selectedPath };
              settingsWarning = undefined;
            }
            json(res, 200, { folder, cancelled: !selected });
          } catch (e) { json(res, 400, { error: (e as Error).message.startsWith('Choose ') ? (e as Error).message : safeError(e) }); }
          finally { picking = false; }
          return;
        }
        if (url.pathname.startsWith('/api/recording/') && req.method === 'POST') {
          if (!active || active.phase === 'stopped' || url.pathname !== `/api/recording/${active.id}`) { json(res, 409, { error: 'No matching active recording.' }); return; }
          const body = await readBody(req, 1024 * 1024);
          try { await active.files.appendAudio(body, Number(req.headers['x-chunk-sequence'])); json(res, 200, { ok: true }); }
          catch (e) { active.files.audioFailed = true; json(res, 507, { error: safeError(e) }); }
          return;
        }
        if (url.pathname === '/api/files' && req.method === 'GET') {
          const files = active?.files || lastFiles;
          if (!files) { json(res, 404, { error: 'No files in this backend process. Existing files remain in your selected folder.' }); return; }
          json(res, 200, { ...files.info(), segments: active?.transcript.segments || [] }); return;
        }
        if (url.pathname === '/api/download' && req.method === 'GET') {
          const files = active?.files || lastFiles;
          const kind = url.searchParams.get('kind');
          if (!files || (kind !== 'txt' && kind !== 'audio') || (kind === 'audio' && !files.audioSaved)) { json(res, 404, { error: 'File is not finalized or available.' }); return; }
          const filename = files.file(kind === 'txt' ? 'txt' : files.extension);
          if (path.dirname(await realpath(filename)) !== files.folder) { json(res, 403, { error: 'Output path changed.' }); return; }
          res.writeHead(200, { 'Content-Type': kind === 'txt' ? 'text/plain; charset=utf-8' : 'application/octet-stream', 'Content-Disposition': `attachment; filename="${path.basename(filename)}"` });
          const stream = createReadStream(filename); stream.on('error', () => res.destroy()); stream.pipe(res); return;
        }
        json(res, 404, { error: 'Unknown local API.' }); return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      // Serve only built public assets, never repository files or arbitrary paths.
      const dist = path.resolve(options.project, 'dist');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.')) || pathname.includes('\\')) { res.writeHead(404); res.end(); return; }
      const filename = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!filename.startsWith(dist + path.sep)) { res.writeHead(404); res.end(); return; }
      const canonical = await realpath(filename);
      if (!canonical.startsWith(await realpath(dist) + path.sep) || !(await stat(canonical)).isFile()) throw new Error('Not a public file');
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      res.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream');
      res.end(req.method === 'HEAD' ? undefined : await readFile(canonical));
    } catch (e) {
      if (!res.headersSent) json(res, (e as Error).message === 'Body too large' ? 413 : url.pathname.startsWith('/api/') ? 400 : 404, { error: safeError(e) });
      else res.destroy();
    }
  }
  server.on('upgrade', (req, socket, head) => {
    const protocols = String(req.headers['sec-websocket-protocol'] || '').split(',').map(s => s.trim());
    if (req.url !== '/api/live' || !req.headers.origin || !localRequest(req, options.port, options.devPort) || !authenticated(req) || !protocols.includes(token) || owner) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    ws.handleUpgrade(req, socket, head, client => { ws.emit('connection', client); });
  });
  ws.on('connection', client => {
    owner = client;
    let alive = true;
    const heartbeat = setInterval(() => { if (!alive) { client.terminate(); return; } alive = false; client.ping(); }, 15000);
    client.on('pong', () => { alive = true; });
    const sendError = (message: string) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'error', message })); };
    client.on('error', () => {});
    client.on('message', (raw, binary) => {
      if (binary) { client.close(1008, 'JSON business messages only'); return; }
      let m: any;
      try { m = JSON.parse(raw.toString()); if (!m || typeof m.type !== 'string') throw new Error('Invalid message'); }
      catch { client.close(1008, 'Invalid message'); return; }
      if (m.type === 'start') {
        if (starting || (active && active.phase !== 'stopped')) { sendError('A call is already active.'); return; }
        if (!options.key) { sendError('Set OPENAI_API_KEY in .env and restart the backend.'); return; }
        if (!folder || m.folderId !== folder.id || !compatible(m.model) || !MIME_EXTENSIONS[m.mime]) { sendError('Choose a valid external folder, supported recording format, and compatible model.'); return; }
        let settings;
        try { settings = parseSettings(m.settings); } catch { sendError('Invalid context settings. Keep context short and terms on separate lines.'); return; }
        starting = true;
        void (async () => {
          let files: CallFiles | undefined;
          try {
            const canonical = await validateFolder(folder!.path, options.project);
            files = new CallFiles(canonical, options.project); await files.create(m.mime);
            active = new CallSession(client, files, options.key, m.model, settings, options.upstream); lastFiles = files;
            if (client.readyState !== WebSocket.OPEN) { await active.stop(false); return; }
            await active.persist(); await active.start();
            if (client.readyState !== WebSocket.OPEN) await active.stop(false);
          } catch (e) {
            sendError(e instanceof ConnectionError ? e.message : safeError(e));
            if (active && active.phase !== 'stopped') await active.stop(false);
          } finally { starting = false; }
        })();
        return;
      }
      if (!active || active.phase === 'stopped' || m.sessionId !== active.id) { sendError('No matching active call.'); return; }
      try {
        if (m.type === 'audio') active.audio(m);
        else if (m.type === 'switch' && compatible(m.model)) void active.switchModel(m.model).catch(() => active?.fault('Invalid model switch state.'));
        else if (m.type === 'stop') void active.stop(m.audioComplete === true);
        else throw new Error('Unknown command');
      } catch { active.fault('Invalid audio message or queue limit. Capture stopped; existing text is preserved.'); }
    });
    client.on('close', () => { clearInterval(heartbeat); if (owner === client) owner = undefined; if (active && active.phase !== 'stopped') void active.stop(false); });
  });
  return { server, ws, async close() { if (active) await active.stop(false); ws.clients.forEach(c => c.terminate()); ws.close(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  if (Number(req.headers['content-length']) > limit) { req.resume(); throw new Error('Body too large'); }
  for await (const chunk of req) { size += chunk.length; if (size > limit) { req.resume(); throw new Error('Body too large'); } chunks.push(chunk); }
  return Buffer.concat(chunks);
}
