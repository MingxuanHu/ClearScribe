import type { Preferences } from '../shared/preferences';

/** Coalesce edits and serialize saves so slow requests cannot revert newer choices. */
export class PreferenceSaver {
  private pending: Partial<Preferences> = {};
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  constructor(private save: (patch: Partial<Preferences>) => Promise<void>, private report: (failed: boolean) => void) {}
  enqueue(patch: Partial<Preferences>) {
    Object.assign(this.pending, patch);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, 300);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) { await this.running; if (Object.keys(this.pending).length) await this.flush(); return; }
    if (!Object.keys(this.pending).length) return;
    const patch = this.pending; this.pending = {};
    let failed = false;
    this.running = this.save(patch).then(() => this.report(false)).catch(() => {
      this.pending = { ...patch, ...this.pending }; failed = true; this.report(true);
    });
    await this.running; this.running = undefined;
    if (Object.keys(this.pending).length) this.timer = setTimeout(() => { void this.flush(); }, failed ? 5000 : 0);
  }
}
