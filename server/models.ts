export const CAPABILITIES = [
  { id: 'gpt-live-transcribe', label: 'Live captions', timing: 'As you speak', endpoint: 'realtime', session: 'transcription', format: 'pcm16/24000', parameters: ['languages', 'keywords', 'prompt', 'delay'], deprecated: false, implemented: true },
  { id: 'gpt-transcribe', label: 'Committed-turn transcription', timing: 'After each speech segment', endpoint: 'realtime', session: 'transcription', format: 'pcm16/24000', parameters: ['languages', 'keywords', 'prompt'], deprecated: false, implemented: true },
] as const;
export function compatible(id: unknown): id is string { return CAPABILITIES.some(m => m.id === id && m.implemented && !m.deprecated); }
export interface ModelList { models: Array<(typeof CAPABILITIES)[number] & { availability: 'listed' | 'unconfirmed' }>; checkedAt: string | null; stale: boolean; message: string }
export function intersectModels(data: { id: string; shutdown_date?: string | null }[]) {
  return CAPABILITIES.filter(m => data.some(row => row.id === m.id && !row.shutdown_date)).map(m => ({ ...m, availability: 'listed' as const }));
}
export class ModelCatalog {
  private cache?: ModelList;
  private lastAttempt = 0;
  private inflight?: Promise<ModelList>;
  constructor(private key: string, private request: typeof fetch = fetch) {}
  async list(refresh = false): Promise<ModelList> {
    if (this.inflight) return this.inflight;
    if (this.cache && (!refresh || Date.now() - this.lastAttempt < 30000) && Date.now() - this.lastAttempt < 300000) return this.cache;
    this.inflight = this.load().finally(() => { this.inflight = undefined; });
    return this.inflight;
  }
  private async load(): Promise<ModelList> {
    this.lastAttempt = Date.now();
    const candidates = () => CAPABILITIES.map(m => ({ ...m, availability: 'unconfirmed' as const }));
    if (!this.key) return { models: candidates(), checkedAt: null, stale: true, message: 'Set OPENAI_API_KEY in .env and restart the backend.' };
    try {
      const response = await this.request('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(10000) });
      if (response.status === 403) return this.cache = { models: candidates(), checkedAt: new Date().toISOString(), stale: false, message: 'Model listing permission denied. Account availability unconfirmed; checked when starting.' };
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { data?: { id: string; shutdown_date?: string | null }[] };
      if (!Array.isArray(body.data)) throw new Error('Invalid list');
      return this.cache = { models: intersectModels(body.data), checkedAt: new Date().toISOString(), stale: false, message: 'Account list ∩ implemented transcription adapters. Listing does not guarantee access.' };
    } catch {
      return this.cache = { models: this.cache?.models || candidates(), checkedAt: this.cache?.checkedAt || null, stale: true, message: 'Refresh failed (network, authentication, or quota). Cached/candidate availability is unconfirmed.' };
    }
  }
}
export function sessionUpdate(model: string, settings: Settings) {
  if (!compatible(model)) throw new Error('Unsupported transcription model');
  return { type: 'session.update', session: { type: 'transcription', audio: { input: {
    format: { type: 'audio/pcm', rate: 24000 }, turn_detection: null,
    transcription: { model, languages: ['en'], keywords: settings.keywords, prompt: settings.prompt, ...(model === 'gpt-live-transcribe' ? { delay: settings.delay } : {}) },
  } } } };
}
export interface Settings { keywords: string[]; prompt: string; delay: 'low' | 'medium' }
export function parseSettings(value: unknown): Settings {
  const v = value as Partial<Settings> | null;
  if (!v || typeof v.prompt !== 'string' || v.prompt.length > 400 || !Array.isArray(v.keywords) || v.keywords.length > 40 || v.keywords.some(k => typeof k !== 'string' || k.length > 60 || /[<>\r\n]/.test(k)) || !['low', 'medium'].includes(v.delay || '')) throw new Error('Invalid context settings');
  return v as Settings;
}
