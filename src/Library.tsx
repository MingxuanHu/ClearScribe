import { useEffect, useMemo, useRef, useState } from 'react';
import type { Conversation, ConversationDetail } from '../shared/library';

interface Props {
  token?: string;
  folder?: { id: string; path: string };
  platform?: string;
  initialId?: string;
  message: string;
  busy: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onNew: () => void;
  onFolder: () => void;
  onOpenFolder: () => void;
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
/** Retain the complete saved text, including notices and provisional markers. */
export function transcriptBlocks(text: string) {
  return text.split(/\n(?=\[\d{2,}:\d{2}:\d{2}\])/).map((text, index) => {
    const match = /^\[(\d{2,}):(\d{2}):(\d{2})\]\s*/.exec(text);
    return { key: index, time: match ? match[0].trim() : undefined,
      seconds: match ? +match[1] * 3600 + +match[2] * 60 + +match[3] : undefined,
      text: match ? text.slice(match[0].length).trim() : text.trim() };
  }).filter(block => block.text);
}
export function Library(props: Props) {
  const { token, folder, initialId } = props;
  const [items, setItems] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest');
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState(initialId);
  const [detail, setDetail] = useState<ConversationDetail>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [playbackError, setPlaybackError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Conversation>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteStatus, setDeleteStatus] = useState('');
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const dirty = !!detail && (title !== detail.title || description !== detail.description);
  const base = `/api/library?folderId=${encodeURIComponent(folder?.id || '')}`;
  const detailUrl = `${base}&id=${encodeURIComponent(selectedId || '')}`;
  async function request(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token || '', ...init?.headers } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The library request failed.');
    return result;
  }
  useEffect(() => {
    if (!token || !folder) { setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError('');
    const timer = setTimeout(() => {
      void request(`${base}&q=${encodeURIComponent(query)}&sort=${sort}&offset=${offset}`, { signal: controller.signal }).then(result => {
        setItems(result.items); setTotal(result.total);
      }).catch(e => { if (!controller.signal.aborted) setError((e as Error).message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [token, folder?.id, query, sort, offset, refresh]);
  useEffect(() => {
    setDetail(undefined); setSaveStatus(''); setPlaybackError('');
    if (!selectedId || !folder || !token) return;
    const controller = new AbortController(); setError('');
    void request(detailUrl, { signal: controller.signal }).then((item: ConversationDetail) => {
      setDetail(item); setTitle(item.title); setDescription(item.description);
    }).catch(e => { if (!controller.signal.aborted) setError((e as Error).message); });
    return () => controller.abort();
  }, [selectedId, folder?.id, token]);
  useEffect(() => { props.onDirtyChange(dirty); return () => props.onDirtyChange(false); }, [dirty, props.onDirtyChange]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  useEffect(() => {
    if (deleteTarget) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [deleteTarget]);
  async function removeConversation() {
    if (!deleteTarget || deleting) return;
    setDeleting(true); setDeleteError(''); setDeleteStatus('');
    try {
      await request(`${base}&id=${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' });
      setDeleteTarget(undefined); setOffset(0); setRefresh(value => value + 1);
      setDeleteStatus(`Deleted “${deleteTarget.title}” and its related files.`);
    } catch (e) { setDeleteError((e as Error).message); }
    finally { setDeleting(false); }
  }
  function leave(action: () => void) {
    if (saving) return;
    if (!dirty || window.confirm('Discard the unsaved title and description?')) action();
  }
  async function save() {
    if (!detail || saving) return;
    setSaving(true); setError(''); setSaveStatus('');
    try {
      const result = await request(detailUrl, { method: 'POST', body: JSON.stringify({ title, description }) });
      setDetail({ ...detail, ...result }); setTitle(result.title); setDescription(result.description); setSaveStatus('Changes saved.'); setRefresh(value => value + 1);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  function fileUrl(extension: string, download = false) {
    return `/api/library/file?folderId=${encodeURIComponent(folder!.id)}&id=${encodeURIComponent(detail!.id)}&extension=${extension}${download ? '&download=1' : ''}`;
  }
  function seek(seconds: number) {
    if (!audio.current) return;
    try { audio.current.currentTime = seconds; }
    catch { setPlaybackError('This recording does not support seeking yet. Try downloading the audio.'); }
  }
  const blocks = useMemo(() => transcriptBlocks(detail?.transcript || ''), [detail?.transcript]);
  const audioExtension = detail?.files.find(ext => ext === 'mp3') || detail?.files.find(ext => ['webm', 'm4a', 'ogg'].includes(ext));
  const openLabel = props.platform === 'darwin' ? 'Open in Finder' : props.platform === 'win32' ? 'Open in File Explorer' : 'Open folder';
  return <main className="shell library-shell">
    <header className="masthead"><button className="library-brand" onClick={() => leave(() => setSelectedId(undefined))}><span className="brandmark" aria-hidden="true">≋</span> ClearScribe</button><span className="privacy"><span className="tiny-dot"/> Your microphone. Your workspace.</span></header>
    <div className="library-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h1>{selectedId ? 'Conversation review' : 'Conversation library'}</h1><p className="subtitle">{selectedId ? 'Read, listen, and add your own notes.' : 'Recordings, transcripts, and your notes. One place for every session.'}</p></div><button className="start-button" disabled={!token || saving} onClick={() => leave(props.onNew)}>＋ New recording</button></div>
    {(props.message || error) && <div className="notice notice-error" role="alert">{error || props.message}</div>}
    {!selectedId ? <>
      <div className="library-toolbar"><input type="search" aria-label="Search conversations" placeholder="Search titles, descriptions, and transcripts…" maxLength={500} value={query} disabled={!folder} onChange={e => { setQuery(e.target.value); setOffset(0); }}/><select aria-label="Sort conversations" value={sort} onChange={e => { setSort(e.target.value); setOffset(0); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A–Z</option></select><button className="library-button" disabled={loading || !folder} onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
      {deleteStatus && <p className="notice" role="status">{deleteStatus}</p>}
      <p className="library-count" role="status">{loading ? 'Loading conversations…' : `${total} ${total === 1 ? 'conversation' : 'conversations'}`}</p>
      {!loading && !items.length && <section className="library-empty"><h2>{!folder ? 'Choose your conversation folder' : query ? 'No matching conversations' : 'Your conversations start here'}</h2><p>{!folder ? 'Choose the folder containing your ClearScribe recordings, or select a new save folder.' : query ? 'Try a different title, note, or phrase from a transcript.' : 'Start a recording. Its transcript and audio will appear together here.'}</p>{!folder && <button className="library-button" disabled={!token || props.busy} onClick={props.onFolder}>Choose save folder</button>}</section>}
      <div className="conversation-list" aria-busy={loading}>{!loading && items.map(item => <article className="conversation-row" key={item.id}><button className="conversation-open" onClick={() => { setSelectedId(item.id); setError(''); }}><strong>{item.title}</strong><span>{item.description || 'Add a description to make this conversation easier to find.'}</span><small>{item.files.includes('txt') ? 'Transcript' : 'No transcript'} · {item.active ? 'Recording in progress' : item.files.some(ext => ['mp3', 'webm', 'm4a', 'ogg'].includes(ext)) ? 'Audio' : 'No finalized audio'}{item.files.some(ext => ext.endsWith('.part')) ? ' · Partial recording retained' : ''}{item.metadataWarning ? ' · Details unavailable' : ''}</small></button><time dateTime={item.recordedAt}>{dateLabel(item.recordedAt)}</time><button className="library-button conversation-delete" disabled={item.active || deleting} onClick={() => { setDeleteTarget(item); setDeleteError(''); }} aria-label={`Delete ${item.title}`} title={item.active ? 'Stop recording before deleting' : 'Delete conversation and related files'}><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></article>)}</div>
      {total > 50 && <nav className="library-pagination" aria-label="Library pages"><button className="library-button" disabled={!offset || loading} onClick={() => setOffset(Math.max(0, offset - 50))}>← Previous</button><span>{offset + 1}–{Math.min(offset + 50, total)} of {total}</span><button className="library-button" disabled={offset + 50 >= total || loading} onClick={() => setOffset(offset + 50)}>Next →</button></nav>}
    </> : <>
      <button className="text-button library-back" disabled={saving} onClick={() => leave(() => { setSelectedId(undefined); setError(''); setRefresh(value => value + 1); })}>← All conversations</button>
      {!detail ? <p role="status">{error ? 'Unable to open this conversation.' : 'Loading conversation…'}</p> : <>
        <section className="conversation-heading"><label htmlFor="conversation-title">Conversation title</label><input id="conversation-title" className="conversation-title" maxLength={200} value={title} disabled={saving} onChange={e => { setTitle(e.target.value); setSaveStatus(''); }}/><p>{dateLabel(detail.recordedAt)} · {detail.id}</p></section>
        {detail.metadataWarning && <p className="notice" role="status">{detail.metadataWarning}</p>}
        {detail.active && <p className="notice" role="status">This conversation is recording in another page. Review its latest saved text here; audio becomes available after recording ends. Return to the recording page to stop it.</p>}
        <div className="review-layout"><section className="review-transcript"><div className="review-section-heading"><h2>Transcript</h2><span>Read & listen</span></div>
          {audioExtension && !detail.active ? <><audio key={fileUrl(audioExtension)} ref={audio} controls preload="metadata" src={fileUrl(audioExtension)} onError={() => setPlaybackError('Audio could not be played. Try downloading it or reconnecting the recording drive.')}/><p className="audio-position">Select a transcript time to seek</p></> : <p className="hint">{detail.active ? 'Audio is still recording.' : 'No finalized audio is available. Any partial recording remains in your folder.'}</p>}
          {playbackError && <p className="notice" role="alert">{playbackError}</p>}
          <div className="review-segments">{detail.transcript ? blocks.map(block => <article className={block.time ? 'review-segment' : 'transcript-preamble'} key={block.key}>{block.time && <button disabled={!audioExtension || detail.active} onClick={() => seek(block.seconds!)} aria-label={`Seek to ${block.time}`}>{block.time}</button>}<p>{block.text}</p></article>) : <p className="hint">No saved transcript text is available for this conversation.</p>}</div>
        </section><aside className="review-sidebar"><section><label htmlFor="conversation-description">Your description</label><textarea id="conversation-description" maxLength={4000} rows={7} placeholder="What was this conversation about? Add context to help you find it later." value={description} disabled={saving} onChange={e => { setDescription(e.target.value); setSaveStatus(''); }}/><div className="description-actions"><button className="start-button" disabled={!dirty || !title.trim() || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save details'}</button><span role="status">{dirty ? 'Unsaved changes' : saveStatus}</span></div></section><section><h2>Files & exports</h2><p className="hint">Files stay in your selected folder. Titles do not rename the originals.</p><div className="review-files">{detail.files.map(extension => extension.endsWith('.part') || detail.active ? <span key={extension}>{extension.endsWith('.part') ? `Partial ${extension} · open folder to inspect` : `${extension.toUpperCase()} · recording in progress`}</span> : <a key={extension} href={fileUrl(extension, true)} download>↓ {extension === 'txt' ? 'Transcript · TXT' : extension === 'mp3' ? 'Audio · MP3' : `Original audio · ${extension.toUpperCase()}`}</a>)}</div><button className="library-button" disabled={props.busy} onClick={props.onOpenFolder}>{openLabel} ↗</button></section></aside></div>
      </>}
    </>}
    <dialog ref={deleteDialog} className="delete-dialog" aria-labelledby="delete-title" aria-describedby="delete-description" onCancel={event => { event.preventDefault(); if (!deleting) setDeleteTarget(undefined); }}>
      <h2 id="delete-title">Delete this conversation?</h2>
      <p className="delete-conversation-name">{deleteTarget?.title}</p>
      <p id="delete-description">This permanently deletes the transcript, all audio formats, partial recordings, and saved title and description for this conversation. This cannot be undone.</p>
      {deleteError && <p className="notice notice-error" role="alert">{deleteError}</p>}
      <div className="delete-dialog-actions"><button className="library-button" autoFocus disabled={deleting} onClick={() => setDeleteTarget(undefined)}>Cancel</button><button className="library-button delete-confirm" disabled={deleting} onClick={() => void removeConversation()}>{deleting ? 'Deleting…' : 'Delete all related files'}</button></div>
    </dialog>
    <footer className="library-footer"><div><span className="library-folder-path">{folder?.path || 'No save folder selected'}</span><button disabled={!token || props.busy || saving} onClick={() => leave(props.onFolder)}>Change save folder</button>{folder && <button disabled={props.busy} onClick={props.onOpenFolder}>{openLabel}</button>}</div><span>Local files · Your conversations stay yours.</span></footer>
  </main>;
}
