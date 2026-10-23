import { within } from '../shared/deadline';
import { Resampler, Segmenter, base64PCM } from '../shared/audio';
export interface CaptureOptions {
  deviceId: string; noiseSuppression: boolean; autoGainControl: boolean; echoCancellation: boolean;
  threshold: number; token: string;
  onAudio: (audio: { audio: string; begin: boolean; end: boolean; startSample: number }) => void;
  onLevel: (level: number, samples: number) => void;
  onWarning: (message: string) => void;
  onFatal: (message: string) => void;
}
export class Capture {
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private recorder?: MediaRecorder;
  private segmenter: Segmenter;
  private resampler?: Resampler;
  private stopped = false;
  private stopPromise?: Promise<boolean>;
  private enabled = false;
  private uploadQueue: Blob[] = [];
  private uploadBytes = 0;
  private uploading?: Promise<void>;
  private sequence = 0;
  private recordingFailed = false;
  private sessionId = '';
  private uploadAbort = new AbortController();
  private flushResolve?: () => void;
  mime = '';
  sampleRate = 0;
  constructor(private options: CaptureOptions) { this.segmenter = new Segmenter(options.threshold); }
  async prepare() {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode || !window.MediaRecorder) throw new Error('Use a current desktop Chrome on http://127.0.0.1.');
      this.mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m)) || '';
      if (!this.mime) throw new Error('This browser does not support a compatible recording format.');
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: this.options.deviceId ? { exact: this.options.deviceId } : undefined,
        channelCount: 1, noiseSuppression: this.options.noiseSuppression,
        autoGainControl: this.options.autoGainControl, echoCancellation: this.options.echoCancellation,
      }, video: false });
      if (this.stopped) { this.stream.getTracks().forEach(t => t.stop()); throw new Error('Capture was cancelled.'); }
      this.context = new AudioContext(); this.sampleRate = this.context.sampleRate;
      this.resampler = new Resampler(this.sampleRate);
      // Worklet is bundled locally; microphone samples never go through an audio playback path.
      await this.context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(this.context, 'clearscribe-pcm');
      this.node.port.onmessage = event => {
        if (event.data === 'flushed') { this.flushResolve?.(); return; }
        if (!this.enabled) return;
        const input = event.data as Float32Array;
        const pcm = this.resampler!.push(input);
        const turn = this.segmenter.push(pcm);
        const rms = Math.sqrt(input.reduce((sum, x) => sum + x * x, 0) / Math.max(1, input.length));
        this.options.onLevel(Math.min(1, rms * 8), this.segmenter.position);
        if (turn) this.options.onAudio({ audio: base64PCM(turn.pcm), begin: turn.begin, end: turn.end, startSample: turn.startSample });
      };
      this.source = this.context.createMediaStreamSource(this.stream);
      // Connect only on confirmed readiness; no recording or upstream samples during Connecting.
      this.stream.getTracks().forEach(track => track.addEventListener('ended', () => {
        if (!this.stopped) this.options.onFatal('Microphone disconnected. Capture stopped; final text may be incomplete.');
      }));
    } catch (e) { await this.dispose(); throw e; }
  }
  async start(sessionId: string) {
    if (this.stopped || !this.stream || !this.context || !this.node || !this.source) throw new Error('Microphone is not prepared');
    this.sessionId = sessionId;
    this.recorder = new MediaRecorder(this.stream, { mimeType: this.mime, audioBitsPerSecond: 64000 });
    this.recorder.ondataavailable = event => this.enqueue(event.data);
    this.recorder.onerror = () => { this.recordingFailed = true; this.options.onWarning('Recording encoder failed. Captions can continue; audio will remain incomplete.'); };
    await this.context.resume();
    this.enabled = true;
    this.recorder.start(1000);
    this.source.connect(this.node);
    // Worklet outputs zeros; no captured audio is played.
    this.node.connect(this.context.destination);
  }
  private enqueue(blob: Blob) {
    if (!blob.size || this.recordingFailed) return;
    if (blob.size > 1024 * 1024 || this.uploadBytes + blob.size > 8 * 1024 * 1024) {
      this.recordingFailed = true; this.uploadQueue = []; this.uploadBytes = 0;
      this.options.onWarning('Recording queue limit exceeded. Captions continue; the recording is incomplete.'); return;
    }
    this.uploadQueue.push(blob); this.uploadBytes += blob.size;
    if (!this.uploading) this.uploading = this.upload().finally(() => { this.uploading = undefined; });
  }
  private async upload() {
    while (this.uploadQueue.length && !this.recordingFailed) {
      const blob = this.uploadQueue.shift()!;
      let saveError = 'Audio save failed (disk, permissions, or local connection). Captions remain available.';
      try {
        const response = await fetch(`/api/recording/${this.sessionId}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': this.options.token, 'X-Chunk-Sequence': String(this.sequence++) }, body: blob, signal: AbortSignal.any([this.uploadAbort.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          if (typeof body.error === 'string') saveError = body.error + ' Captions can continue; audio is incomplete.';
          throw new Error('Recording write failed');
        }
      } catch {
        this.recordingFailed = true; this.uploadQueue = [];
        this.options.onWarning(saveError);
      } finally { this.uploadBytes = Math.max(0, this.uploadBytes - blob.size); }
    }
  }
  stop(): Promise<boolean> {
    this.stopPromise ||= this.finishStop();
    return this.stopPromise;
  }
  private async finishStop(): Promise<boolean> {
    if (this.stopped) return !this.recordingFailed;
    this.stopped = true;
    // Disconnect source immediately, then flush already captured worklet samples in FIFO order.
    this.source?.disconnect();
    if (this.enabled && this.node) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 300);
        this.flushResolve = () => { clearTimeout(timer); resolve(); };
        this.node!.port.postMessage('flush');
      });
    }
    this.enabled = false;
    this.segmenter.finish();
    const recorder = this.recorder;
    const recorderDone = recorder && recorder.state !== 'inactive' ? new Promise<void>(resolve => {
      recorder.addEventListener('stop', () => resolve(), { once: true }); recorder.stop();
    }) : Promise.resolve();
    this.stream?.getTracks().forEach(t => t.stop());
    if (!await within(recorderDone, 2000)) this.recordingFailed = true;
    await this.dispose();
    // Separate recording queue; bounded finishing time, never blocks live PCM.
    if (!await within(this.uploading || Promise.resolve(), 12000)) {
      this.recordingFailed = true; this.uploadAbort.abort(); this.uploadQueue = []; this.uploadBytes = 0;
    }
    return !this.recordingFailed;
  }
  async dispose() {
    this.source?.disconnect(); this.node?.disconnect(); this.stream?.getTracks().forEach(t => t.stop());
    if (this.context && this.context.state !== 'closed') await this.context.close();
  }
}
