import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { Transcript, transcriptText, RATE } from '../shared/transcript.js';
import { sessionUpdate, compatible, type Settings } from './models.js';
import { CallFiles } from './storage.js';
import { safeError, upstreamError } from './security.js';
export class ConnectionError extends Error {}
export type UpstreamFactory = (key: string) => WebSocket;
const productionUpstream: UpstreamFactory = key => new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', { headers: { Authorization: `Bearer ${key}` }, maxPayload: 1024 * 1024, handshakeTimeout: 10000 });
export class CallSession {
  readonly id = randomUUID();
  readonly transcript = new Transcript(this.id);
  readonly notices: string[] = [];
  started = new Date();
  model: string;
  phase: 'connecting' | 'listening' | 'switching' | 'stopping' | 'stopped' = 'connecting';
  private upstream?: WebSocket;
  private generation = 0;
  private current?: number;
  private seq = 0;
  private turnSamples = 0;
  private committed: number[] = [];
  private pending = new Set<number>();
  private wake?: () => void;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private persistTimer?: ReturnType<typeof setTimeout>;
  private finalizing?: Promise<void>;
  private totalSamples = 0;
  private lastSample = 0;
  private savedWarning = false;
  constructor(readonly client: WebSocket, readonly files: CallFiles, private key: string, model: string, private settings: Settings, private factory = productionUpstream) { this.model = model; }
  send(type: string, data: object = {}) {
    if (this.client.readyState === WebSocket.OPEN && this.client.bufferedAmount < 4 * 1024 * 1024) this.client.send(JSON.stringify({ type, sessionId: this.id, ...data }));
  }
  private clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  async connect(model = this.model) {
    const generation = ++this.generation;
    const socket = this.factory(this.key); this.upstream = socket;
    await new Promise<void>((resolve, reject) => {
      let configured = false;
      const timer = setTimeout(() => { reject(new ConnectionError('OpenAI connection/configuration timed out.')); socket.terminate(); }, 12000);
      const fail = (message: string) => {
        clearTimeout(timer);
        if (!configured) reject(new ConnectionError(message));
        else if (generation === this.generation && this.phase !== 'stopping' && this.phase !== 'stopped') this.fault(message);
      };
      socket.on('open', () => socket.send(JSON.stringify(sessionUpdate(model, this.settings))));
      socket.on('unexpected-response', (_request, response) => { response.resume(); fail(upstreamError(response.statusCode === 401 ? 'invalid_api_key' : response.statusCode === 429 ? 'rate_limit_exceeded' : 'model_not_found')); socket.terminate(); });
      socket.on('error', () => fail('OpenAI connection failed. Check your network; no automatic retry was made.'));
      socket.on('close', () => fail('OpenAI disconnected. Audio after the last confirmed segment may be missing.'));
      socket.on('message', raw => {
        if (generation !== this.generation) return;
        let event: any;
        try { event = JSON.parse(raw.toString()); } catch { fail('Invalid upstream event.'); return; }
        if (event.type === 'error') { fail(upstreamError(event.error?.code)); return; }
        if (event.type === 'session.updated' && !configured) {
          if (event.session?.type !== 'transcription' || event.session?.audio?.input?.transcription?.model !== model) { fail('OpenAI did not confirm the requested transcription model.'); return; }
          configured = true; clearTimeout(timer); this.model = model;
          // Dedicated guide gives no separate duration guarantee. Rotate conservatively.
          const expiry = event.session?.expires_at;
          const rotateMs = typeof expiry === 'number' ? Math.min(50 * 60000, expiry * 1000 - Date.now() - 60000) : 50 * 60000;
          this.timers.push(setTimeout(() => this.send('rotate', { model: this.model }), Math.max(1000, rotateMs)));
          this.timers.push(setTimeout(() => this.fault('Session rotation deadline reached. Stop and start again.'), Math.max(30000, rotateMs + 45000)));
          resolve(); return;
        }
        try { this.onEvent(event); } catch { this.fault('Transcript protocol limit or item ordering error. Existing text is preserved.'); }
      });
    });
  }
  async start() { await this.connect(); this.phase = 'listening'; this.send('ready', { model: this.model, files: this.files.info() }); }
  private onEvent(event: any) {
    if (event.type === 'input_audio_buffer.committed') {
      const seq = this.committed.shift();
      if (seq === undefined || typeof event.item_id !== 'string') return;
      this.transcript.bind(event.item_id, seq);
    }
    if (!['conversation.item.input_audio_transcription.delta', 'conversation.item.input_audio_transcription.completed', 'conversation.item.input_audio_transcription.failed'].includes(event.type)) return;
    if (event.type.endsWith('.failed')) { this.fault('OpenAI could not transcribe a segment. Unconfirmed text is retained.'); return; }
    if (typeof event.item_id !== 'string' || (event.delta !== undefined && typeof event.delta !== 'string') || (event.transcript !== undefined && typeof event.transcript !== 'string')) return;
    const existing = this.transcript.segments.find(s => s.itemId === event.item_id);
    const seq = existing?.seq ?? this.current ?? this.committed[0];
    if (seq === undefined) return;
    this.transcript.event(this.id, event, seq);
    if (event.type.endsWith('.completed')) { this.pending.delete(seq); this.wake?.(); }
    this.send('segment', { segment: this.transcript.segments.find(s => s.seq === seq) });
    if (event.type.endsWith('.completed')) void this.persist();
    else if (!this.persistTimer) this.persistTimer = setTimeout(() => { this.persistTimer = undefined; void this.persist(); }, 1000);
  }
  audio(message: any) {
    if (this.phase !== 'listening') throw new Error('Session is not ready for audio');
    if (typeof message.audio !== 'string' || message.audio.length > 50000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.audio)) throw new Error('Invalid audio block');
    const bytes = Buffer.from(message.audio, 'base64');
    if (!bytes.length || bytes.length % 2) throw new Error('Invalid PCM16');
    if (this.upstream?.readyState !== WebSocket.OPEN || this.upstream.bufferedAmount > RATE * 2 * 5) { this.fault('Audio queue exceeded five seconds. Possible transcription gap; start a new call.'); return; }
    if (message.begin) {
      if (this.current !== undefined || !Number.isSafeInteger(message.startSample) || message.startSample < this.lastSample || message.startSample > RATE * 60 * 60 * 4) throw new Error('Invalid segment boundary');
      if (this.seq >= 20000) throw new Error('Segment limit reached');
      this.current = ++this.seq; this.turnSamples = 0;
      this.transcript.begin(this.current, message.startSample); this.lastSample = message.startSample;
    }
    if (this.current === undefined) throw new Error('Audio requires a speech segment');
    this.turnSamples += bytes.length / 2; this.totalSamples += bytes.length / 2;
    if (this.turnSamples > RATE * 27 || this.totalSamples > RATE * 60 * 60 * 4) throw new Error('Audio duration limit reached');
    this.upstream.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: message.audio }));
    if (message.end === true) this.commit();
  }
  commit() {
    if (this.current === undefined) return;
    // API requires a nonempty turn. Pad sub-100ms final utterances with silence.
    if (this.turnSamples < RATE * 0.12) this.upstream?.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: Buffer.alloc(Math.ceil(RATE * 0.12 - this.turnSamples) * 2).toString('base64') }));
    this.pending.add(this.current); this.committed.push(this.current); this.current = undefined;
    this.upstream?.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
  }
  private async drain(timeout = 8000) {
    this.commit();
    if (!this.pending.size) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, timeout);
      this.wake = () => { if (!this.pending.size) { clearTimeout(timer); resolve(); } };
    });
    this.wake = undefined;
    if (this.pending.size) { this.notices.push('Final-result timeout: unconfirmed segments remain PROVISIONAL.'); this.send('warning', { message: this.notices.at(-1) }); }
  }
  async switchModel(model: string) {
    if (!compatible(model) || this.phase !== 'listening') throw new Error('Cannot switch now');
    this.phase = 'switching'; this.send('switching', { model });
    await this.drain();
    this.clearTimers(); this.generation++; this.upstream?.close(); this.pending.clear(); this.committed = [];
    if (this.phase !== 'switching') return;
    try { await this.connect(model); if (this.phase !== 'switching') return; this.phase = 'listening'; this.send('switched', { model }); }
    catch { this.fault('Model switch failed. Transcription stopped; existing text and the same recording files are retained.'); }
  }
  async persist() {
    try { await this.files.saveText(transcriptText(this.transcript.segments, this.started.toString(), this.notices)); this.send('saved', { files: this.files.info() }); }
    catch (e) { if (!this.savedWarning) { this.savedWarning = true; this.send('warning', { message: safeError(e) }); } }
  }
  fault(message: string) {
    if (this.phase === 'stopped' || this.phase === 'stopping') return;
    this.notices.push(`[${Math.floor((Date.now() - this.started.getTime()) / 1000)}s] ${message}`);
    this.send('fatal', { message });
    // Immediately close paid upstream; let the browser finish its recording independently.
    this.generation++; this.upstream?.terminate(); this.clearTimers();
    this.phase = 'stopping'; void this.persist();
    this.timers.push(setTimeout(() => { void this.stop(false); }, 15000));
  }
  stop(completeAudio: boolean) {
    if (this.finalizing) return this.finalizing;
    this.finalizing = this.finish(completeAudio); return this.finalizing;
  }
  private async finish(completeAudio: boolean) {
    this.phase = 'stopping'; this.send('finishing');
    try {
      if (this.upstream?.readyState === WebSocket.OPEN) await this.drain();
      else if (this.current !== undefined || this.pending.size) this.notices.push('Connection closed before final acknowledgement; text may be incomplete.');
      if (this.persistTimer) clearTimeout(this.persistTimer);
      await this.persist();
      try { await this.files.finish(completeAudio); } catch (e) { this.send('warning', { message: safeError(e) }); }
    } finally {
      this.generation++; this.clearTimers(); this.upstream?.terminate(); this.phase = 'stopped';
      this.send('stopped', { files: this.files.info(), segments: this.transcript.segments });
    }
  }
}
