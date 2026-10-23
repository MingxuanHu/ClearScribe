import { RATE } from './transcript.js';
/** Streaming box-filter resampler. Fractional integration carries across input blocks. */
export class Resampler {
  private sum = 0;
  private weight = 0;
  private readonly ratio: number;
  constructor(inputRate: number, outputRate = RATE) {
    if (inputRate < outputRate || !Number.isFinite(inputRate)) throw new Error('Unsupported microphone sample rate');
    this.ratio = inputRate / outputRate;
  }
  push(input: Float32Array): Int16Array {
    const output: number[] = [];
    for (const sample of input) {
      let left = 1;
      while (left > 1e-9) {
        const portion = Math.min(left, this.ratio - this.weight);
        this.sum += sample * portion; this.weight += portion; left -= portion;
        if (this.weight >= this.ratio - 1e-9) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          output.push(Math.round(value * (value < 0 ? 32768 : 32767)));
          this.sum = 0; this.weight = 0;
        }
      }
    }
    return Int16Array.from(output);
  }
}
export interface AudioTurn { pcm: Int16Array; startSample: number; begin: boolean; end: boolean }
/** Energy gate: 300ms prefix, 850ms silence, max 25s turn. No accumulation of whole turns. */
export class Segmenter {
  private prefix: Int16Array[] = [];
  private prefixSamples = 0;
  private active = false;
  private quiet = 0;
  private length = 0;
  position = 0;
  constructor(readonly threshold = 0.008, readonly silenceMs = 850) {}
  push(pcm: Int16Array): AudioTurn | undefined {
    const start = this.position; this.position += pcm.length;
    const energy = Math.sqrt(pcm.reduce((sum, x) => sum + (x / 32768) ** 2, 0) / Math.max(1, pcm.length));
    if (!this.active && energy < this.threshold) {
      this.prefix.push(pcm); this.prefixSamples += pcm.length;
      while (this.prefixSamples > RATE * 0.3 && this.prefix.length > 1) this.prefixSamples -= this.prefix.shift()!.length;
      return;
    }
    let data = pcm;
    const begin = !this.active;
    const startSample = begin ? start - this.prefixSamples : start;
    if (begin) {
      data = new Int16Array(this.prefixSamples + pcm.length);
      let offset = 0; for (const block of this.prefix) { data.set(block, offset); offset += block.length; }
      data.set(pcm, offset); this.prefix = []; this.prefixSamples = 0; this.length = 0;
      this.active = true;
    }
    this.length += data.length;
    this.quiet = energy < this.threshold ? this.quiet + pcm.length : 0;
    const end = (this.quiet >= RATE * this.silenceMs / 1000 && this.length >= RATE * 0.2) || this.length >= RATE * 25;
    if (end) { this.active = false; this.quiet = 0; }
    return { pcm: data, startSample, begin, end };
  }
  finish() { const active = this.active; this.active = false; this.prefix = []; this.prefixSamples = 0; return active; }
}
export function base64PCM(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.length * 2);
  const view = new DataView(bytes.buffer);
  pcm.forEach((n, i) => view.setInt16(i * 2, n, true));
  let text = ''; for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
