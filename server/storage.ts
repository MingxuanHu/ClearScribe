import { constants } from 'node:fs';
import { access, realpath, lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile);
export const MIME_EXTENSIONS: Record<string, string> = { 'audio/webm;codecs=opus': 'webm', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg;codecs=opus': 'ogg' };
export async function validateFolder(folder: string, project: string) {
  const selected = await realpath(folder);
  const root = await realpath(project);
  if (selected === root || selected.startsWith(root + path.sep)) throw new Error('Choose a folder outside the project and all Git worktrees.');
  if (!(await lstat(selected)).isDirectory()) throw new Error('Choose a directory.');
  for (let ancestor = selected; ; ancestor = path.dirname(ancestor)) {
    try { await lstat(path.join(ancestor, '.git')); throw new Error('GIT_FOLDER'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Choose a folder outside all Git worktrees.'); }
    if (ancestor === path.dirname(ancestor)) break;
  }
  await access(selected, constants.W_OK | constants.X_OK);
  // A real exclusive write probe also catches read-only mounts / ACL failures.
  const probe = path.join(selected, `.clearscribe-${randomUUID()}.tmp`);
  const handle = await open(probe, 'wx', 0o600); await handle.close(); await unlink(probe);
  return selected;
}
export async function chooseFolder(): Promise<string | null> {
  if (process.platform !== 'darwin') throw new Error('Native folder selection requires macOS.');
  try {
    const { stdout } = await exec('/usr/bin/osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose a ClearScribe save folder outside all Git projects")'], { timeout: 120000, maxBuffer: 8192 });
    return stdout.trim();
  } catch (e) {
    if (String((e as { stderr?: string }).stderr).includes('(-128)')) return null;
    throw new Error('Folder picker failed. Allow the native macOS dialog and try again.');
  }
}
export function basename(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`;
}
export class CallFiles {
  readonly id = randomUUID();
  audioSaved = false;
  txtSaved = false;
  audioFailed = false;
  txtFailed = false;
  bytes = 0;
  private audioSeq = 0;
  private writingAudio = false;
  private desired?: string;
  private writer?: Promise<void>;
  private closed = false;
  private audio!: FileHandle;
  private txt!: FileHandle;
  base = '';
  extension = '';
  constructor(readonly folder: string, readonly project: string) {}
  async create(mime: string, date = new Date()) {
    this.extension = MIME_EXTENSIONS[mime];
    if (!this.extension) throw new Error('Unsupported recording format');
    if (await validateFolder(this.folder, this.project) !== this.folder) throw new Error('Folder changed');
    const start = basename(date);
    for (let suffix = 0; suffix < 1000; suffix++) {
      this.base = start + (suffix ? `-${suffix}` : '');
      try { this.txt = await open(this.file('txt'), 'wx', 0o600); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue; throw e; }
      try {
        // Reserve final audio name exclusively; empty reservation is removed on completion.
        const reserved = await open(this.file(this.extension), 'wx', 0o600); await reserved.close();
      } catch (e) {
        await this.txt.close(); await unlink(this.file('txt'));
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue; throw e;
      }
      try { this.audio = await open(this.file(this.extension + '.part'), 'wx', 0o600); return; }
      catch (e) { await this.txt.close(); await unlink(this.file('txt')); await unlink(this.file(this.extension)); throw e; }
    }
    throw new Error('Too many filename collisions');
  }
  file(ext: string) { return path.join(this.folder, `${this.base}.${ext}`); }
  async appendAudio(chunk: Buffer, seq: number) {
    if (this.closed || this.audioFailed || this.writingAudio || seq !== this.audioSeq || chunk.length > 1024 * 1024) throw new Error('Invalid recording sequence or queue');
    this.writingAudio = true;
    try {
      let offset = 0;
      while (offset < chunk.length) { const result = await this.audio.write(chunk, offset); if (!result.bytesWritten) throw new Error('Short write'); offset += result.bytesWritten; }
      this.bytes += chunk.length; this.audioSeq++;
    } catch (e) { this.audioFailed = true; throw e; }
    finally { this.writingAudio = false; }
  }
  saveText(text: string) {
    if (this.closed || this.txtFailed) return Promise.resolve();
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) { this.txtFailed = true; return Promise.reject(new Error('Transcript size limit reached')); }
    this.desired = text; // Coalesce snapshots; at most one write plus one latest snapshot.
    if (!this.writer) this.writer = this.writeText().finally(() => { this.writer = undefined; });
    return this.writer;
  }
  private async writeText() {
    try {
      while (this.desired !== undefined) {
        const text = this.desired; this.desired = undefined;
        const temp = this.file('txt.tmp');
        const handle = await open(temp, constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        await rename(temp, this.file('txt')); this.txtSaved = true;
      }
    } catch (e) { this.txtFailed = true; throw e; }
  }
  async finish(completeAudio: boolean) {
    try { await this.writer; } catch { this.txtFailed = true; }
    this.closed = true;
    if (!completeAudio) this.audioFailed = true;
    await this.txt.close();
    try {
      await this.audio.sync(); await this.audio.close();
      if (completeAudio && !this.audioFailed && this.bytes > 0) {
        await rename(this.file(this.extension + '.part'), this.file(this.extension)); this.audioSaved = true;
      } else { await unlink(this.file(this.extension)); }
    } catch (e) { this.audioFailed = true; throw e; }
  }
  info() { return { id: this.id, base: this.base, extension: this.extension, audioSaved: this.audioSaved, txtSaved: this.txtSaved && !this.txtFailed, audioFailed: this.audioFailed, txtFailed: this.txtFailed, bytes: this.bytes }; }
}
