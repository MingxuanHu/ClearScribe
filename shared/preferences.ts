export interface Preferences {
  microphoneId: string;
  model: string;
  keywords: string;
  context: string;
  delay: 'low' | 'medium';
  noiseSuppression: boolean;
  autoGainControl: boolean;
  echoCancellation: boolean;
  speechThreshold: number;
  captionFontSize: number;
  advancedOpen: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = {
  microphoneId: '', model: 'gpt-live-transcribe',
  keywords: 'Java\nSpring Boot\nKafka\nRedis\nPostgreSQL\nAWS',
  context: 'An English conversation about Java backend engineering.',
  delay: 'low', noiseSuppression: false, autoGainControl: true, echoCancellation: false,
  speechThreshold: 0.008, captionFontSize: 28, advancedOpen: false,
};

/** Preferences can retain drafts; session hints still undergo their existing stricter validation. */
export function parsePreferencePatch(value: unknown): Partial<Preferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preferences');
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    let valid = false;
    switch (key) {
      case 'microphoneId': valid = typeof item === 'string' && item.length <= 1024; break;
      case 'model': valid = typeof item === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(item); break;
      case 'keywords': valid = typeof item === 'string' && item.length <= 4096; break;
      case 'context': valid = typeof item === 'string' && item.length <= 400; break;
      case 'delay': valid = item === 'low' || item === 'medium'; break;
      case 'noiseSuppression': case 'autoGainControl': case 'echoCancellation': case 'advancedOpen':
        valid = typeof item === 'boolean'; break;
      case 'speechThreshold': valid = typeof item === 'number' && Number.isFinite(item) && item >= 0.002 && item <= 0.04; break;
      case 'captionFontSize': valid = typeof item === 'number' && Number.isInteger(item) && item >= 20 && item <= 44; break;
    }
    if (!valid) throw new Error('Invalid preferences');
    result[key] = item;
  }
  return result;
}
