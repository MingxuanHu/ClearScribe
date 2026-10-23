export interface Segment {
  seq: number; itemId?: string; startSample: number; text: string; final: boolean;
}
export const RATE = 24000;
export function timestamp(samples: number): string {
  const seconds = Math.max(0, Math.floor(samples / RATE));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(n => String(n).padStart(2, '0')).join(':');
}
export function transcriptText(segments: Segment[], started: string, notices: string[] = []): string {
  return `ClearScribe\nStarted: ${started}\nApproximate segment times; no speaker labels.\n${notices.map(n => `Notice: ${n}\n`).join('')}\n` +
    [...segments].sort((a, b) => a.seq - b.seq).filter(s => s.text.trim()).map(s =>
      `[${timestamp(s.startSample)}] ${s.final ? '' : '[PROVISIONAL] '}${s.text}\n`).join('\n');
}
/** Owns each item exactly once. Completion replaces partial text, including empty completion. */
export class Transcript {
  segments: Segment[] = [];
  private items = new Map<string, Segment>();
  private seen = new Set<string>();
  constructor(readonly sessionId: string) {}
  begin(seq: number, startSample: number) {
    if (!this.segments.some(s => s.seq === seq)) this.segments.push({ seq, startSample, text: '', final: false });
  }
  bind(itemId: string, seq: number) {
    const segment = this.segments.find(s => s.seq === seq);
    if (!segment) throw new Error('Unknown segment');
    const existing = this.items.get(itemId);
    if (existing && existing !== segment) throw new Error('Duplicate item ownership');
    if (segment.itemId && segment.itemId !== itemId) throw new Error('Segment already bound');
    segment.itemId = itemId; this.items.set(itemId, segment);
    return segment;
  }
  event(sessionId: string, event: { event_id?: string; item_id: string; delta?: string; transcript?: string }, seq: number) {
    if (sessionId !== this.sessionId || (event.event_id && this.seen.has(event.event_id))) return false;
    if (this.seen.size >= 200000) throw new Error('Event limit reached');
    if (event.event_id) this.seen.add(event.event_id);
    const segment = this.items.get(event.item_id) || this.bind(event.item_id, seq);
    if (event.transcript !== undefined) { segment.text = event.transcript; segment.final = true; }
    else if (!segment.final) segment.text += event.delta || '';
    if (this.segments.reduce((n, s) => n + s.text.length, 0) > 2 * 1024 * 1024) throw new Error('Transcript size limit reached');
    return true;
  }
}
