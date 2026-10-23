import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, rename, open, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DEFAULT_PREFERENCES, parsePreferencePatch, type Preferences } from '../shared/preferences.js';

export function configDirectory(platform = process.platform, env = process.env, home = os.homedir()) {
  if (env.CLEARSCRIBE_CONFIG_DIR) return path.resolve(env.CLEARSCRIBE_CONFIG_DIR);
  if (platform === 'win32') return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'ClearScribe');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'ClearScribe');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'clearscribe');
}
export interface Settings { version: 1; saveFolder?: string; preferences?: Preferences }
export async function readSettings(filename: string): Promise<Settings | undefined> {
  try {
    const value = JSON.parse(await readFile(filename, 'utf8'));
    if (value?.version !== 1 || (value.saveFolder !== undefined && (typeof value.saveFolder !== 'string' || !path.isAbsolute(value.saveFolder)))) throw new Error('Invalid settings');
    return { version: 1, ...(value.saveFolder !== undefined ? { saveFolder: value.saveFolder } : {}),
      ...(value.preferences !== undefined ? { preferences: { ...DEFAULT_PREFERENCES, ...parsePreferencePatch(value.preferences) } } : {}) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}
export async function writeSettings(filename: string, settings: Settings) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temp = `${filename}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(settings, null, 2) + '\n'); await file.sync(); }
    finally { await file.close(); }
    await rename(temp, filename);
  } finally { await unlink(temp).catch(() => {}); }
}
