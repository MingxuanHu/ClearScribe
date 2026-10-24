import { useEffect, useRef, useState } from 'react';
import { Capture } from './capture';
import { timestamp, transcriptText, type Segment } from '../shared/transcript';
import type { ModelList } from '../server/models';
import { DEFAULT_PREFERENCES, parsePreferencePatch, type Preferences } from '../shared/preferences';
import { PreferenceSaver } from './preferences';
type Phase = 'Idle' | 'Connecting' | 'Listening' | 'Switching' | 'Stopping' | 'Stopped' | 'Error';
interface Files { base: string; extension: string; audioSaved: boolean; txtSaved: boolean; audioFailed: boolean; txtFailed: boolean; bytes: number }
interface Bootstrap { token: string; keyConfigured: boolean; folder?: { id: string; path: string }; files?: Files; active: boolean; platform: string; settingsWarning?: string; preferences: Preferences; preferencesSaved: boolean }
export function App() {
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).get('preview') === '1';
  const [shortcutRequested, setShortcutRequested] = useState(false);
  const [boot, setBoot] = useState<Bootstrap>();
  const [catalog, setCatalog] = useState<ModelList>();
  const [preferences, setPreferences] = useState<Preferences>({ ...DEFAULT_PREFERENCES });
  const preferencesRef = useRef(preferences);
  const preferenceSaver = useRef<PreferenceSaver | undefined>(undefined);
  const { model, microphoneId: deviceId, captionFontSize: fontSize, keywords, context, delay,
    noiseSuppression: noise, autoGainControl: gain, echoCancellation: echo, speechThreshold: threshold, advancedOpen } = preferences;
  const [currentModel, setCurrentModel] = useState('');
  const [pendingModel, setPendingModel] = useState('');
  const [phase, setPhase] = useState<Phase>('Idle');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [files, setFiles] = useState<Files>();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [message, setMessage] = useState('');
  const [warning, setWarning] = useState('');
  const [level, setLevel] = useState(0);
  const [samples, setSamples] = useState(0);
  const [sampleRate, setSampleRate] = useState(0);
  const [following, setFollowing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openingFolder, setOpeningFolder] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const capture = useRef<Capture | undefined>(undefined);
  const socket = useRef<WebSocket | undefined>(undefined);
  const sessionId = useRef('');
  const phaseRef = useRef<Phase>('Idle');
  const pending = useRef('');
  const speaking = useRef(false);
  const switching = useRef(false);
  const queued = useRef<object[]>([]);
  const queuedBytes = useRef(0);
  const stopping = useRef(false);
  const attempt = useRef(0);
  const startDate = useRef('');
  const notes = useRef<string[]>([]);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = ['Connecting', 'Listening', 'Switching', 'Stopping'].includes(phase);
  const changePhase = (next: Phase) => { phaseRef.current = next; setPhase(next); };
  function updatePreferences(patch: Partial<Preferences>) {
    const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => preferencesRef.current[key as keyof Preferences] !== value));
    if (!Object.keys(changed).length) return;
    const next = { ...preferencesRef.current, ...changed };
    preferencesRef.current = next; setPreferences(next);
    if (!preview) preferenceSaver.current?.enqueue(changed);
  }
  const setDeviceId = (value: string) => updatePreferences({ microphoneId: value });
  const setFontSize = (value: number) => updatePreferences({ captionFontSize: value });
  const setKeywords = (value: string) => updatePreferences({ keywords: value });
  const setContext = (value: string) => updatePreferences({ context: value });
  const setDelay = (value: 'low' | 'medium') => updatePreferences({ delay: value });
  const setNoise = (value: boolean) => updatePreferences({ noiseSuppression: value });
  const setGain = (value: boolean) => updatePreferences({ autoGainControl: value });
  const setEcho = (value: boolean) => updatePreferences({ echoCancellation: value });
  const setThreshold = (value: number) => updatePreferences({ speechThreshold: value });
  async function api(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, headers: { 'X-CSRF-Token': boot?.token || '', ...init?.headers } });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Local service request failed.'); return body;
  }
  async function refreshModels() {
    setBusy(true);
    try { setCatalog(await api('/api/models?refresh=1')); } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  async function enumerate() {
    try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput')); } catch { /* Permission requested only on Start. */ }
  }
  useEffect(() => {
    if (preview) {
      setSegments([
        { seq: 1, startSample: 48000, text: 'We use Kafka to decouple the services and process events asynchronously.', final: true },
        { seq: 2, startSample: 288000, text: 'How would you handle a message that fails during processing?', final: true },
        { seq: 3, startSample: 504000, text: 'I would start with a retry policy and a dead-letter queue', final: false },
      ]);
      startDate.current = 'Synthetic UI preview';
      setMessage('SYNTHETIC UI PREVIEW — sample text only. No microphone, recording, or OpenAI connection.');
      return;
    }
    let disposed = false;
    fetch('/api/bootstrap').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(async (b: Bootstrap) => {
      if (disposed) return;
      const restoredPreferences = { ...DEFAULT_PREFERENCES, ...b.preferences };
      let legacyModel: string | undefined;
      if (!b.preferencesSaved) {
        try {
          const value = localStorage.getItem('clearscribe-model');
          if (value) { parsePreferencePatch({ model: value }); legacyModel = value; restoredPreferences.model = value; }
        } catch { /* Browser storage may be disabled; server settings remain authoritative. */ }
      }
      preferencesRef.current = restoredPreferences; setPreferences(restoredPreferences);
      const saveWarning = 'Preferences could not be saved. Retrying automatically; keep this page open.';
      preferenceSaver.current = new PreferenceSaver(async patch => {
        const response = await fetch('/api/preferences', { method: 'POST', keepalive: true, signal: AbortSignal.timeout(10000),
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': b.token }, body: JSON.stringify(patch) });
        if (!response.ok) throw new Error('Preference save failed');
        if (patch.model !== undefined) {
          try { localStorage.removeItem('clearscribe-model'); } catch { /* Migration cleanup is optional. */ }
        }
      }, failed => { if (!disposed) setWarning(previous => failed ? saveWarning : previous === saveWarning ? '' : previous); });
      if (legacyModel) preferenceSaver.current.enqueue({ model: legacyModel });
      setBoot(b); if (b.settingsWarning) setWarning(b.settingsWarning); if (b.files) setFiles(b.files);
      const r = await fetch('/api/models'); const models = await r.json(); if (disposed) return; setCatalog(models);
      if (b.files) {
        const restored = await fetch('/api/files').then(r => r.json());
        if (disposed) return;
        if (restored.segments) setSegments(restored.segments);
        setWarning('Page reloaded. Capture does not resume automatically. Check saved files; unfinished audio may remain .part.');
      }
    }).catch(() => { if (!disposed) setMessage('Cannot reach the local backend. Start it with npm run dev, or build and run npm start.'); });
    void enumerate();
    const deviceChange = () => { void enumerate(); };
    navigator.mediaDevices?.addEventListener('devicechange', deviceChange);
    const unload = (event: BeforeUnloadEvent) => {
      if (['Connecting', 'Listening', 'Switching', 'Stopping'].includes(phaseRef.current)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', unload);
    const hide = () => { void preferenceSaver.current?.flush(); if (capture.current) { socket.current?.close(); void capture.current.stop(); } };
    const visibility = () => { if (document.visibilityState === 'hidden') void preferenceSaver.current?.flush(); };
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visibility);
    return () => { disposed = true; void preferenceSaver.current?.flush(); navigator.mediaDevices?.removeEventListener('devicechange', deviceChange); window.removeEventListener('beforeunload', unload); window.removeEventListener('pagehide', hide); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => { if (following && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [segments, following]);
  function send(value: object) {
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    socket.current.send(JSON.stringify({ ...value, sessionId: sessionId.current })); return true;
  }
  function requestSwitch(next: string) {
    if (switching.current || stopping.current) return;
    switching.current = true; changePhase('Switching');
    send({ type: 'switch', model: next });
  }
  function chooseModel(next: string) {
    updatePreferences({ model: next });
    if (phaseRef.current === 'Listening') {
      pending.current = next; setPendingModel(next);
      if (!speaking.current) requestSwitch(next);
    }
  }
  function audio(data: { audio: string; begin: boolean; end: boolean; startSample: number }) {
    speaking.current = !data.end;
    const value = { type: 'audio', ...data };
    if (switching.current) {
      queuedBytes.current += data.audio.length * 0.75;
      if (queuedBytes.current > 24000 * 2 * 5) {
        setWarning('Switch buffer exceeded five seconds. Possible caption gap; call stopped. The continuous recording is retained.');
        queued.current = []; void stop(); return;
      }
      queued.current.push(value); return;
    }
    if ((socket.current?.bufferedAmount || 0) > 24000 * 2 * 5 || !send(value)) {
      setWarning('Local audio connection stalled. Possible transcription gap; stopping safely.'); void stop(); return;
    }
    if (data.end && pending.current) requestSwitch(pending.current);
  }
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (preview || event.source !== window || event.origin !== location.origin || event.data?.type !== 'clearscribe-start' || typeof event.data.requestId !== 'string') return;
      window.postMessage({ type: 'clearscribe-start-ack', requestId: event.data.requestId }, location.origin);
      setShortcutRequested(true);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [preview]);
  useEffect(() => {
    if (!shortcutRequested || !boot || !catalog || busy) return;
    setShortcutRequested(false);
    if (boot.active) { setWarning('A session is already active in another page. Return to that page to follow the captions.'); return; }
    if (['Connecting', 'Listening', 'Switching', 'Stopping'].includes(phaseRef.current)) return;
    if (!boot.keyConfigured || !boot.folder || !catalog.models.some(m => m.id === model)) {
      setMessage('Quick Start needs setup: configure the backend API key, choose a writable save folder, and select an available model. Then use the shortcut again.');
      return;
    }
    void start();
  });
  async function start() {
    if (['Connecting', 'Listening', 'Switching', 'Stopping'].includes(phaseRef.current) || !boot || !boot.keyConfigured || !boot.folder || !catalog?.models.some(m => m.id === model)) return;
    const thisAttempt = ++attempt.current;
    stopping.current = false; switching.current = false; speaking.current = false; pending.current = '';
    queued.current = []; queuedBytes.current = 0; sessionId.current = ''; notes.current = [];
    setMessage(''); setWarning(''); setPendingModel(''); changePhase('Connecting');
    const mic = new Capture({ deviceId, noiseSuppression: noise, autoGainControl: gain, echoCancellation: echo, threshold, token: boot.token,
      onAudio: audio, onLevel: (value, position) => { setLevel(value); setSamples(position); },
      onWarning: value => { notes.current.push(value); setWarning(value); setFiles(previous => previous && { ...previous, audioFailed: true }); },
      onFatal: value => { notes.current.push(value); setWarning(value); void stop(); },
    });
    capture.current = mic;
    try {
      await mic.prepare(); await enumerate();
      if (stopping.current) { await mic.stop(); return; }
      setSampleRate(mic.sampleRate);
      const connection = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/live`, ['clearscribe', boot.token]);
      socket.current = connection;
      const connectionTimer = setTimeout(() => { if (phaseRef.current === 'Connecting') { setMessage('Connection timed out. Check the backend and model access.'); connection.close(); void mic.stop(); changePhase('Error'); } }, 18000);
      connection.onopen = () => connection.send(JSON.stringify({ type: 'start', folderId: boot.folder!.id, model, mime: mic.mime,
        settings: { keywords: keywords.split('\n').map(k => k.trim()).filter(Boolean), prompt: context, delay } }));
      connection.onmessage = event => {
        if (socket.current !== connection) return;
        const data = JSON.parse(event.data);
        if (data.sessionId && sessionId.current && data.sessionId !== sessionId.current) return;
        if (data.sessionId && !sessionId.current) sessionId.current = data.sessionId;
        if (data.type === 'ready') {
          clearTimeout(connectionTimer);
          if (stopping.current) { send({ type: 'stop', audioComplete: false }); return; }
          setSegments([]); setSamples(0); setFiles(data.files); setFollowing(true); setCurrentModel(data.model);
          startDate.current = new Date().toString();
          void mic.start(data.sessionId).then(() => changePhase('Listening')).catch(() => { setMessage('Microphone could not start. Retry after checking browser permissions.'); void stop(); });
        } else if (data.type === 'segment') {
          setSegments(previous => [...previous.filter(s => s.seq !== data.segment.seq), data.segment].sort((a, b) => a.seq - b.seq));
        } else if (data.type === 'saved') setFiles(data.files);
        else if (data.type === 'switched') {
          setCurrentModel(data.model); setPendingModel(''); pending.current = ''; switching.current = false;
          for (const value of queued.current) send(value);
          queued.current = []; queuedBytes.current = 0;
          if (!stopping.current) changePhase('Listening');
        } else if (data.type === 'rotate') { pending.current = data.model; setPendingModel(data.model); if (!speaking.current) requestSwitch(data.model); }
        else if (data.type === 'warning') { notes.current.push(data.message); setWarning(data.message); }
        else if (data.type === 'fatal' || data.type === 'error') {
          clearTimeout(connectionTimer); notes.current.push(data.message); setMessage(data.message);
          void stop();
        } else if (data.type === 'finishing') changePhase('Stopping');
        else if (data.type === 'stopped') {
          clearTimeout(connectionTimer); clearTimeout(finishTimer.current); setFiles(data.files); setSegments(data.segments);
          setLevel(0); setPendingModel(''); pending.current = '';
          void mic.stop().finally(() => { if (socket.current === connection) { changePhase('Stopped'); connection.close(); } });
        }
      };
      connection.onclose = () => {
        if (socket.current !== connection) return;
        clearTimeout(connectionTimer);
        if (!['Stopped', 'Idle', 'Error'].includes(phaseRef.current)) {
          notes.current.push('Connection closed; unconfirmed text may be incomplete.');
          setWarning('Connection closed. Possible caption gap; check TXT and any .part recording in your save folder.');
          void mic.stop().finally(() => { changePhase('Error'); setLevel(0); }); changePhase('Stopping');
        }
      };
      connection.onerror = () => setMessage('Local WebSocket connection failed. Close other ClearScribe tabs and retry.');
    } catch (e) {
      if (attempt.current !== thisAttempt) { await mic.stop(); return; }
      const error = e as Error;
      setMessage(error.name === 'NotAllowedError' ? 'Microphone permission denied. Allow microphone access in Chrome site settings, then retry.' : error.name === 'NotFoundError' ? 'No microphone found. Connect or select a microphone.' : error.name === 'OverconstrainedError' ? 'The selected microphone is unavailable. Reconnect it or choose another microphone.' : error.message);
      await mic.stop(); changePhase('Error');
    }
  }
  async function stop() {
    if (stopping.current) return;
    const closingSocket = socket.current;
    const closingCapture = capture.current;
    stopping.current = true; changePhase('Stopping'); setLevel(0);
    if (queued.current.length) { notes.current.push('Stopped during model switching; buffered audio may not have been transcribed.'); setWarning(notes.current.at(-1)!); queued.current = []; }
    const complete = await closingCapture?.stop().catch(() => false);
    if (capture.current !== closingCapture || socket.current !== closingSocket) return;
    if (sessionId.current && socket.current?.readyState === WebSocket.OPEN) {
      send({ type: 'stop', audioComplete: complete === true });
      finishTimer.current = setTimeout(() => { setWarning('Finishing timed out. Existing text is retained; verify saved files.'); socket.current?.close(); changePhase('Error'); }, 15000);
    } else { socket.current?.close(); changePhase('Stopped'); }
  }
  async function pickFolder() {
    setBusy(true); setMessage('');
    try { const response = await api('/api/folder', { method: 'POST' }); setBoot(b => b && { ...b, folder: response.folder }); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  async function openSaveFolder() {
    if (!boot?.folder || openingFolder) return;
    setOpeningFolder(true); setMessage('');
    try { await api('/api/folder/open', { method: 'POST' }); }
    catch (error) { setMessage((error as Error).message); }
    finally { setOpeningFolder(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(transcriptText(segments, startDate.current || 'Restored local session', notes.current)); setWarning('Transcript copied. Unconfirmed text is marked PROVISIONAL.'); }
    catch { setMessage('Clipboard access denied. Use Download TXT.'); }
  }
  const microphoneMissing = !!deviceId && !devices.some(device => device.deviceId === deviceId);
  const selectedMissing = catalog && !catalog.models.some(m => m.id === model);
  const folderOpenLabel = boot?.platform === 'darwin' ? 'Open in Finder' : boot?.platform === 'win32' ? 'Open in File Explorer' : 'Open folder';
  const canStart = !!boot?.keyConfigured && !!boot.folder && !selectedMissing && !!catalog?.models.length && !busy;
  const finalized = segments.filter(s => s.final && s.text).length;
  return <main className="shell">
    <header className="masthead"><a className="brand" href="/" aria-label="ClearScribe home"><span className="brandmark" aria-hidden="true">≋</span> ClearScribe<span className="local-tag">LOCAL WORKSPACE</span></a><span className="privacy"><span className="tiny-dot"/> Your microphone. Your workspace.</span></header>
    <section className="intro"><div><p className="eyebrow">A LITTLE CLARITY FOR EVERY CONVERSATION</p><h1>Stay in the conversation.</h1><p className="subtitle">Live English captions, no AI replies.</p></div><div className="intro-note"><span className="note-icon">↗</span><p>Listen closely.<br/>Read clearly.<br/><strong>Respond as yourself.</strong></p></div></section>
    <div className="preview-banner" hidden={!preview}>SYNTHETIC LAYOUT PREVIEW · no microphone or OpenAI session</div>
    <div className="workspace">
      <aside className="setup" inert={!boot && !preview}><div className="panel-heading"><span className="eyebrow">YOUR SETUP</span><span className="step-chip">01 / READY</span></div>
        <div className="field-section"><div className="label-row"><label htmlFor="mic">Microphone</label><span className="field-icon">◉</span></div><select id="mic" value={deviceId} onChange={e => setDeviceId(e.target.value)} disabled={active}><option value="">System default microphone</option>{microphoneMissing && <option value={deviceId}>Saved microphone — reconnect or choose another</option>}{devices.map((d, i) => <option value={d.deviceId} key={d.deviceId || i}>{d.label || `Microphone ${i + 1}`}</option>)}</select><p className="hint">Choose your Mac’s built-in microphone. Place your phone on speaker nearby.</p></div>
        <div className="field-section"><div className="label-row"><label htmlFor="model">Transcription model</label><button className="text-button" disabled={busy || preview} onClick={() => void refreshModels()} aria-label="Refresh models">↻ Refresh models</button></div><select id="model" value={model} onChange={e => chooseModel(e.target.value)} disabled={preview || phase === 'Connecting' || phase === 'Stopping' || phase === 'Switching'}>{preview && <option value="gpt-live-transcribe">gpt-live-transcribe · preview</option>}{selectedMissing && <option value={model}>{model} — unavailable; choose a model</option>}{catalog?.models.map(m => <option value={m.id} key={m.id}>{m.id}{m.availability === 'unconfirmed' ? ' · unconfirmed' : ''}</option>)}</select><p className="model-description">{preview ? 'Synthetic text · no active model' : catalog?.models.find(m => m.id === model)?.timing || 'Waiting for compatible models'}</p><p className="hint catalog-status">{preview ? 'This is a visual fixture. Open the normal page for real transcription.' : catalog?.message || 'Loading the account model list…'}{catalog?.checkedAt && <span> {catalog.stale ? 'Stale · ' : 'Checked · '}{new Date(catalog.checkedAt).toLocaleTimeString()}</span>}</p>{pendingModel && <p className="hint highlight">Pending: {pendingModel}. Switching at the next speech boundary.</p>}</div>
        <div className="field-section"><div className="label-row"><label>Save location</label><button className="text-button" disabled={!boot?.folder || busy || openingFolder || preview || !['darwin', 'win32'].includes(boot?.platform || '')} onClick={() => void openSaveFolder()} title="Open the current save folder without changing it.">{openingFolder ? 'Opening…' : folderOpenLabel}</button></div><button className="folder-button" disabled={active || busy || openingFolder || preview} onClick={() => void pickFolder()}><span>▱</span> {boot?.folder ? 'Change save folder' : 'Choose save folder'} <span>↗</span></button><p className="folder-path">{boot?.folder?.path || 'Choose a folder outside all Git projects.'}</p><p className="hint">Transcript + original audio.<br/>MP3 follows automatically in the same folder.</p></div>
        <details className="advanced" open={advancedOpen} onToggle={event => updatePreferences({ advancedOpen: event.currentTarget.open })}><summary>Fine-tune recognition <span>＋</span></summary><label htmlFor="terms">Terms · one per line</label><textarea id="terms" maxLength={4096} value={keywords} onChange={e => setKeywords(e.target.value)} disabled={active} rows={5}/><label htmlFor="context">Short context · max 400 characters</label><textarea id="context" value={context} maxLength={400} onChange={e => setContext(e.target.value)} disabled={active} rows={3}/><p className="hint">Recognition hints only. These should never add words that were not spoken.</p><label htmlFor="delay">Live model delay</label><select id="delay" value={delay} onChange={e => setDelay(e.target.value as 'low' | 'medium')} disabled={active}><option value="low">Low · earlier partial text</option><option value="medium">Medium · more audio context</option></select><label htmlFor="threshold">Speech threshold · {threshold.toFixed(3)}</label><input id="threshold" type="range" min="0.002" max="0.04" step="0.001" value={threshold} disabled={active} onChange={e => setThreshold(Number(e.target.value))}/>{[['Noise suppression', noise, setNoise], ['Automatic gain', gain, setGain], ['Echo cancellation', echo, setEcho]].map(([name, value, setter]) => <label className="checkbox" key={String(name)}><input type="checkbox" checked={value as boolean} disabled={active} onChange={e => (setter as (v: boolean) => void)(e.target.checked)}/>{name as string}</label>)}<p className="hint">Speakerphone audio is wanted speech. Try suppression off first; compare using your actual phone.</p></details>
        <div className="cloud-note"><span>⌁</span><p>Runs locally. Audio is sent to OpenAI for recognition. API usage is billed separately.</p></div>
      </aside>
      <section className="caption-panel" aria-label="Live transcript">
        <div className="caption-toolbar"><div className="status"><span className={`status-dot ${phase.toLowerCase()}`}/><strong>{phase === 'Stopping' ? 'Finishing' : phase}</strong><span className="toolbar-divider"/><span className="timer">{timestamp(samples)}</span></div><div className="font-control"><span>Aa</span><input aria-label="Caption font size" disabled={!boot && !preview} type="range" min="20" max="44" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}/><span>Aa</span></div></div>
        <div className="transcript-scroll" ref={viewport} onScroll={() => { const el = viewport.current!; setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 65); }}>
          {!segments.some(s => s.text) ? <div className="empty-state"><div className="empty-glyph" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/></div><h2>{phase === 'Listening' ? 'Listening for your first words…' : phase === 'Connecting' ? 'Getting everything connected…' : 'Every word, a little clearer.'}</h2><p>{phase === 'Listening' ? 'Speak naturally. Your captions will appear here.' : 'Set up your microphone and save folder,\nthen start when you’re ready.'}</p><div className="empty-badges"><span>ENGLISH CAPTIONS</span><span>NO GENERATED REPLIES</span></div></div> : <div className="segments" style={{ fontSize }}>{segments.filter(s => s.text).map(s => <article className={`segment ${s.final ? '' : 'provisional'}`} key={s.seq}><div className="segment-meta"><time>{timestamp(s.startSample)}</time>{!s.final && <span>PROVISIONAL</span>}</div><p>{s.text}</p></article>)}</div>}
        </div>
        {!following && segments.length > 0 && <button className="jump" onClick={() => setFollowing(true)}>↓ Jump to latest</button>}
        <div className="caption-bottom"><span><span className="tiny-dot"/> {finalized} finalized segments</span><span>Approximate segment timestamps</span></div>
      </section>
    </div>
    {(message || warning || (boot && (!boot.keyConfigured || !boot.folder || selectedMissing))) && <div className={`notice ${message || !boot?.keyConfigured ? 'notice-error' : ''}`} role="status">{message || (!boot?.keyConfigured ? 'Before starting: copy .env.example to .env, set OPENAI_API_KEY locally, and restart the backend. Never share your key here.' : warning || (!boot?.folder ? 'Before starting: choose a writable save folder outside all Git projects.' : selectedMissing ? 'Your preferred model is unavailable. Select a compatible model from the refreshed list.' : ''))}</div>}
    <section className="control-bar"><div className="transport">{active ? <button className="start-button stop-button" disabled={phase === 'Stopping'} onClick={() => void stop()}><span className="square"/>{phase === 'Stopping' ? 'Finishing…' : 'Stop session'}</button> : <button className="start-button" disabled={!canStart} onClick={() => void start()}><span className="record-dot"/> Start session</button>}<div className="level-area"><div className="level-bars" aria-label={`Microphone level ${Math.round(level * 100)} percent`}>{Array.from({ length: 16 }, (_, i) => <i key={i} className={level * 16 > i ? 'lit' : ''}/>)}</div><span>{phase === 'Listening' ? 'MICROPHONE ACTIVE' : 'MICROPHONE LEVEL'}</span></div></div><div className="export-actions"><button disabled={!segments.some(s => s.text)} onClick={() => void copy()}>⧉ <span>Copy transcript</span></button><a className={!files?.txtSaved ? 'disabled' : ''} aria-disabled={!files?.txtSaved} href={files?.txtSaved ? '/api/download?kind=txt' : undefined}>↓ <span>Download TXT</span></a><a className={!files?.audioSaved ? 'disabled' : ''} aria-disabled={!files?.audioSaved} href={files?.audioSaved ? '/api/download?kind=audio' : undefined}>↓ <span>Download audio</span></a></div></section>
    <div className="save-status"><span>TXT <b>{files?.txtFailed ? 'Save failed' : files?.txtSaved ? active ? 'Saving incrementally' : 'Saved' : 'Not started'}</b></span><span>AUDIO <b>{files?.audioFailed ? 'Save failed · partial' : files?.audioSaved ? 'Saved' : active ? 'Recording / finishing' : files?.bytes ? 'Incomplete · check .part' : 'Not started'}</b></span>{files?.base && <code>{files.base}</code>}{sampleRate > 0 && <span className="sample-rate">{sampleRate / 1000} kHz mic → 24 kHz PCM</span>}</div>
    <footer><span>Built for listening. The conversation is yours.</span><div>{currentModel && <span>{currentModel}</span>}<button disabled={active || !segments.length} onClick={() => { setSegments([]); setWarning('Screen cleared. Saved files were not deleted.'); }}>Clear screen</button><span>Apache-2.0</span></div></footer>
  </main>;
}
