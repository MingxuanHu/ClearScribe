import { constants } from 'node:fs';
import { open, readdir, realpath, rename, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Conversation, ConversationDetail } from '../shared/library.js';

const BASE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}[+-]\d{4}(?:-\d{1,3})?$/;
const FILE = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}[+-]\d{4}(?:-\d{1,3})?)\.(txt|txt\.tmp|clearscribe\.json|mp3|webm|m4a|ogg|(?:webm|m4a|ogg)\.part)$/;
const EXTENSIONS = new Set(['txt', 'mp3', 'webm', 'm4a', 'ogg', 'webm.part', 'm4a.part', 'ogg.part']);
export function validConversationId(id: string) { return BASE.test(id); }
function filename(folder: string, id: string, extension: string) {
  if (!validConversationId(id) || (!EXTENSIONS.has(extension) && extension !== 'clearscribe.json')) throw new Error('Invalid conversation file.');
  return path.join(folder, `${id}.${extension}`);
}
/** Open only regular files in the canonical selected folder; never follow file symlinks. */
export async function openConversationFile(folder: string, id: string, extension: string) {
  const name = filename(folder, id, extension);
  if (await realpath(folder) !== folder || await realpath(name) !== name) throw new Error('Conversation path changed.');
  const handle = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Conversation file is unavailable.');
    return { handle, info };
  } catch (error) { await handle.close(); throw error; }
}
async function readText(folder: string, id: string, extension: string, limit: number) {
  const { handle, info } = await openConversationFile(folder, id, extension);
  try {
    if (info.size > limit) throw new Error('Conversation text exceeds the supported size.');
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}
function isMissing(error: unknown) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
export function parseMetadata(value: unknown): { title: string; description: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid conversation details.');
  const { title, description } = value as Record<string, unknown>;
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof description !== 'string' || description.length > 4000) {
    throw new Error('Use a title of 1–200 characters and a description of at most 4,000 characters.');
  }
  return { title: title.trim(), description };
}
async function summary(folder: string, id: string, files: string[], activeBase?: string): Promise<Conversation> {
  const recordedAt = `${id.slice(0, 10)}T${id.slice(11, 19).replaceAll('-', ':')}${id.slice(19, 22)}:${id.slice(22, 24)}`;
  let metadata = { title: `Untitled conversation · ${id.slice(0, 10)}`, description: '' };
  let metadataWarning: string | undefined;
  try { metadata = parseMetadata(JSON.parse(await readText(folder, id, 'clearscribe.json', 32 * 1024))); }
  catch (error) { if (!isMissing(error)) metadataWarning = 'Saved title or description could not be read. Original files are unchanged.'; }
  return { id, ...metadata, recordedAt, files: files.filter(extension => extension !== 'clearscribe.json' && extension !== 'txt.tmp' && !files.includes(extension + '.part')), active: id === activeBase, metadataWarning };
}
export async function listConversations(folder: string, activeBase?: string) {
  if (await realpath(folder) !== folder) throw new Error('The selected folder has changed. Choose it again.');
  const grouped = new Map<string, string[]>();
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const match = FILE.exec(entry.name);
    if (!entry.isFile() || !match) continue;
    const files = grouped.get(match[1]) || []; files.push(match[2]); grouped.set(match[1], files);
  }
  const results: Conversation[] = [];
  // Read metadata sequentially to avoid exhausting file descriptors in large libraries.
  for (const [id, files] of grouped) results.push(await summary(folder, id, files.sort(), activeBase));
  return results;
}
export async function conversationDetail(folder: string, item: Conversation): Promise<ConversationDetail> {
  let transcript = '';
  if (item.files.includes('txt')) transcript = await readText(folder, item.id, 'txt', 4 * 1024 * 1024);
  return { ...item, transcript };
}
export async function saveConversation(folder: string, id: string, value: unknown) {
  const metadata = parseMetadata(value);
  const target = filename(folder, id, 'clearscribe.json');
  if (await realpath(folder) !== folder) throw new Error('The selected folder has changed. Choose it again.');
  // Exclusive temporary file and atomic replacement preserve existing metadata on failure.
  const temp = path.join(folder, `.clearscribe-${randomUUID()}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try {
    try { await handle.writeFile(JSON.stringify({ version: 1, ...metadata }) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, target);
  } finally { await unlink(temp).catch(() => {}); }
  return metadata;
}

/** Delete only exact session filenames, never prefix matches or symlink targets. */
export async function deleteConversation(folder: string, id: string) {
  if (!validConversationId(id) || await realpath(folder) !== folder) throw new Error('Conversation path changed.');
  const names = new Set([...EXTENSIONS, 'txt.tmp', 'clearscribe.json'].map(extension => `${id}.${extension}`));
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const conversionTemp = new RegExp(`^\\.${escaped}\\.mp3\\.[a-f0-9-]{36}\\.tmp$`);
  const candidates: string[] = [];
  for (const entry of await readdir(folder)) {
    if (!names.has(entry) && !conversionTemp.test(entry)) continue;
    const file = path.join(folder, entry);
    const info = await lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; });
    if (!info) continue;
    // A symlink itself may be removed, but its target is never followed or deleted.
    if (!info.isFile() && !info.isSymbolicLink()) throw new Error('A conversation filename is no longer a file.');
    candidates.push(file);
  }
  // Preserve metadata until last so failed deletion can still be identified and retried.
  candidates.sort((a, b) => Number(a.endsWith('.clearscribe.json')) - Number(b.endsWith('.clearscribe.json')));
  for (const file of candidates) {
    if (await realpath(folder) !== folder) throw new Error('Conversation folder changed during deletion.');
    await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return candidates.length;
}
