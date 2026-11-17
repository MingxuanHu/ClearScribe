import type { Segment } from '../shared/transcript';

export function delaySeverity(ms: number): 'acceptable' | 'medium' | 'large' {
  return ms <= 1000 ? 'acceptable' : ms <= 2000 ? 'medium' : 'large';
}

/** Browser monotonic times only; segment prefixes are not speech onset. */
export class CaptionDelay {
  private pending = new Map<number, number>();
  private latestStart = -1;

  begin(startSample: number, speechStartedAt: number) {
    this.pending.set(startSample, speechStartedAt);
  }

  rendered(segments: readonly Segment[], now: number, record?: (segment: Segment, ms: number) => void): number | undefined {
    let delay: number | undefined;
    for (const segment of segments) {
      const started = this.pending.get(segment.startSample);
      if (started === undefined || !segment.text.trim()) continue;
      this.pending.delete(segment.startSample);
      const measured = Math.max(0, Math.round(now - started));
      record?.(segment, measured);
      // Late results for older segments must not replace the latest measurement.
      if (segment.startSample <= this.latestStart) continue;
      this.latestStart = segment.startSample;
      delay = measured;
    }
    return delay;
  }
}
