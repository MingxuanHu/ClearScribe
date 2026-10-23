import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, unlink, lstat, link, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { validateFolder, type CallFiles } from './storage.js';
const ffmpeg: string | null = createRequire(import.meta.url)('ffmpeg-static');

interface Job { version: 1; id: string; source: string; attempts: number; nextAttempt: number }
type Convert = (source: string, output: string, signal: AbortSignal) => Promise<void>;
const reservation = (id: string) => Buffer.from(`ClearScribe MP3 reservation ${id}\n`);

/** Prefer no-replace hard links; exFAT uses the same exclusive reservation/rename pattern as recordings. */
export async function publishMp3(temp: string, output: string, id: string, createLink = link) {
  try { await createLink(temp, output); return; }
  catch (error) {
    if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'ENOSYS', 'EXDEV'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
  }
  const handle = await open(output, 'wx', 0o600);
  const identity = await handle.stat();
  try {
    await handle.writeFile(reservation(id)); await handle.sync(); await handle.close();
    await rename(temp, output);
  } catch (error) {
    await handle.close().catch(() => {});
    // Remove only this operation's reservation, never a replacement from another writer.
    const current = await lstat(output).catch(() => undefined);
    if (current?.dev === identity.dev && current.ino === identity.ino) await unlink(output).catch(() => {});
    throw error;
  }
}

function run(args: string[], signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (!ffmpeg) { reject(new Error('Bundled FFmpeg is unavailable')); return; }
    const child = spawn(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], {
      stdio: 'ignore', windowsHide: true, signal, timeout: 60 * 60 * 1000,
    });
    let failure: Error | undefined;
    try { if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Best effort on restricted hosts. */ }
    child.once('error', error => { failure = error; });
    // Wait for the process to release output handles before shutdown cleans temporary files.
    child.once('close', code => failure ? reject(failure) : code === 0 ? resolve() : reject(new Error('FFmpeg conversion or validation failed')));
  });
}

export const convertMp3: Convert = async (source, output, signal) => {
  await run(['-xerror', '-protocol_whitelist', 'file,pipe', '-threads', '1', '-i', source, '-map', '0:a:0', '-vn',
    '-map_metadata', '-1', '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k', '-threads', '1', '-f', 'mp3', '-y', output], signal);
  if (!(await lstat(output)).size) throw new Error('Empty MP3 output');
  await run(['-xerror', '-protocol_whitelist', 'file,pipe', '-threads', '1', '-i', output, '-map', '0:a:0', '-f', 'null', '-'], signal);
};

/** Durable intents for new recordings only. No recording-directory discovery. */
export class Mp3Queue {
  private jobs = new Map<string, Job>();
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = false;
  private abort = new AbortController();
  private ready: Promise<void>;
  constructor(private directory: string, private project: string, private busy = () => false,
    private convert: Convert = convertMp3, private now = Date.now) {
    this.ready = this.restore();
    void this.ready.then(() => this.wake());
  }
  private filename(job: Job) { return path.join(this.directory, `${job.id}.json`); }
  private async persist(job: Job) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temp = `${this.filename(job)}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(job)); await handle.sync(); } finally { await handle.close(); }
      await rename(temp, this.filename(job));
    } finally { await unlink(temp).catch(() => {}); }
  }
  private async restore() {
    try {
      for (const name of await readdir(this.directory)) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        try {
          const job = JSON.parse(await readFile(path.join(this.directory, name), 'utf8')) as Job;
          if (job.version !== 1 || `${job.id}.json` !== name || !path.isAbsolute(job.source) ||
            !/\.(webm|m4a|ogg)$/.test(job.source) || !Number.isInteger(job.attempts) || job.attempts < 0 || !Number.isFinite(job.nextAttempt)) throw new Error('Invalid job');
          this.jobs.set(job.id, job);
        } catch { console.error('ClearScribe: could not restore an MP3 job; its file was retained.'); }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('ClearScribe: MP3 queue storage is unavailable.');
    }
  }
  async track(files: CallFiles) {
    await this.ready;
    const job: Job = { version: 1, id: files.id, source: files.file(files.extension), attempts: 0, nextAttempt: 0 };
    this.jobs.set(job.id, job);
    try { await this.persist(job); }
    catch { console.error('ClearScribe: MP3 intent persistence failed; retrying in the background.'); }
    this.wake();
  }
  wake() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, 1000);
    this.timer.unref();
  }
  async discard(id: string) {
    await this.ready;
    const job = this.jobs.get(id);
    if (job) {
      try { await this.remove(job); }
      catch { console.error('ClearScribe: incomplete recording intent cleanup will be retried.'); }
    }
  }
  /** Also exposed for deterministic recovery tests. Never awaited by session finalization. */
  async drain() {
    await this.ready;
    if (this.stopped) return;
    if (this.running) return this.running;
    clearTimeout(this.timer); this.timer = undefined;
    this.running = this.process().finally(() => {
      this.running = undefined;
      if (!this.stopped && this.jobs.size) {
        this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, 30000);
        this.timer.unref();
      }
    });
    return this.running;
  }
  private async process() {
    for (const job of this.jobs.values()) {
      if (this.stopped || this.busy()) break;
      if (job.nextAttempt > this.now()) continue;
      let temp: string | undefined;
      try {
        await this.persist(job);
        const folder = path.dirname(job.source);
        if (await validateFolder(folder, this.project) !== folder) throw new Error('Recording directory changed');
        // An intent is saved before capture; a finalized source has no .part sibling.
        try { await lstat(`${job.source}.part`); await this.remove(job); continue; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        const source = await lstat(job.source);
        if (!source.isFile() || !source.size || await realpath(job.source) !== job.source) throw new Error('Source is unavailable');
        const output = job.source.replace(/\.[^.]+$/, '.mp3');
        try {
          const existing = await lstat(output);
          if (existing.isFile() && existing.size === reservation(job.id).length &&
            (await readFile(output)).equals(reservation(job.id))) {
            // Recover our own reservation if shutdown interrupted exFAT publication.
            await unlink(output);
          } else {
            // Never overwrite an existing file, even if another application made it.
            await this.remove(job); continue;
          }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        temp = path.join(folder, `.${path.basename(output)}.${job.id}.tmp`);
        // Reclaim only this job's temporary file after an interrupted conversion.
        await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
        const handle = await open(temp, 'wx', 0o600); await handle.close();
        await this.convert(job.source, temp, this.abort.signal);
        if (this.stopped) throw new Error('Conversion interrupted');
        const finished = await open(temp, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { if (!(await finished.stat()).size) throw new Error('Empty MP3'); await finished.sync(); } finally { await finished.close(); }
        await publishMp3(temp, output, job.id);
        await this.remove(job);
      } catch (error) {
        if (!this.stopped) {
          job.attempts++;
          job.nextAttempt = this.now() + [60000, 5 * 60000, 30 * 60000, 24 * 60 * 60000][Math.min(job.attempts - 1, 3)];
          try { await this.persist(job); } catch { /* Keep the in-memory job and its durable previous intent. */ }
          const reason = (error as NodeJS.ErrnoException).code || (error as Error).message;
          console.error(`ClearScribe: MP3 job ${job.id} deferred (${reason}); automatic retry is scheduled.`);
        }
      } finally { if (temp) await unlink(temp).catch(() => {}); }
    }
  }
  private async remove(job: Job) {
    await unlink(this.filename(job)); this.jobs.delete(job.id);
  }
  async close() {
    this.stopped = true; clearTimeout(this.timer); this.abort.abort();
    await this.ready; await this.running;
  }
}
