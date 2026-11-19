# Verification record

Date: **2026-10-23**, Australia/Melbourne. No real OpenAI API key was configured. All transcription integration content was synthetic and sent only to an injected local mock upstream. No GitHub repository, push, release or hosted deployment was created.

## Commands run

| Command / check | Result |
| --- | --- |
| `npm install` | Lockfile generated; 124 packages installed; npm reported zero known audit vulnerabilities at installation time (not a perpetual guarantee). Registry access required network permission. |
| `npm run check` | TypeScript check, **29 tests**, and Vite + backend production build passed; zero skipped tests. |
| `npm run licenses` | Direct runtime dependencies React 19.3.1, React DOM 19.3.1, ws 8.22.0: MIT license files verified; notices retained. |
| Official Apache license comparison | Existing LICENSE equals the Apache Software Foundation text after trimming only surrounding whitespace. Existing file preserved. |
| `GITLEAKS_BIN=/tmp/clearscribe-tools/gitleaks npm run secrets` | gitleaks 8.30.1: current deliverables, built client/backend, local environment files if present, staged diff and all existing Git history passed. Private-media filename inventory passed. No local `.env` existed during this run; staged diff was empty and existing history contained only the initial LICENSE commit. |
| gitleaks binary verification | Official release archive checked against its published SHA-256 checksum before extraction/execution. |
| `git diff --check` | Passed. Files were left unstaged for owner review. |
| Production `PORT=4318 npm start` | Built service started on loopback; page and bootstrap returned 200; `/.env` returned 404; foreign Origin returned 403; unauthenticated models request returned 403. Temporary production service was stopped afterward. |

The local runtime used Node.js 24.8.0 / npm 11.6.0. Node 22.12 is the declared compatibility floor; it was not separately executed here. GitHub Actions pins were resolved from the official action repositories on this date. The workflow itself has **not** run on GitHub.

## Automated coverage

- Partial merging, completion replacement, empty completion, duplicate event suppression, late partial suppression, out-of-order final text, ownership and old-session rejection.
- Approximate sample timestamps, UTF-8/provisional TXT formatting, block-invariant 44.1/48 kHz resampling, clipping/fractional boundaries, silence/prefix handling and bounded long speech turns.
- Exact model filtering, snapshot/assistant/deprecation exclusion, denied listing, missing key, refresh throttling, disappeared selection, cache preservation and stale refresh behavior.
- Real local mock WebSocket exchange using the production protocol adapter; Stop tail commit, final timeout/provisional retention, repeat calls/new IDs and upstream release.
- Switching commits/drains before the new adapter, uses one file pair/timeline, confirms the new model, handles failure without hidden fallback, and isolates connection generations in the implementation.
- Recording channel failure independent of successful captions, PCM backpressure, oversized recording chunks, upload/message limits and idempotent browser capture disposal using test doubles.
- Folder cancellation, external/project/Git/symlink rejection, actual mode-bit write denial, missing paths, exclusive collisions, no overwrite, two formal flat outputs and recoverable part files.
- Foreign Origin, invalid Host/fetch metadata, missing local authentication, rejected WebSocket upgrade, fixed business protocol, sensitive error redaction and denied static secret paths.

Filesystem tests used disposable external temporary folders, not project runtime-data. Encoded test bytes are deliberately synthetic and **not playable recordings**. Browser capture disposal tests use doubles; they do not prove actual browser permission, encoder or device behavior.

## Browser inspection

Opened the real development UI in the Codex in-app browser and checked the initial layout, missing-key disabled Start, advanced controls, a clearly marked development-only synthetic caption preview, final/provisional text layout, bottom controls/save statuses and screen clearing. Inspected the compact and wider panel layouts. No microphone was activated, no real caption timing was measured, and clipboard/download/audio playback interoperability was not verified. The preview performs no microphone, recording or OpenAI session.

## Not measured / release gates

Actual account/model access and API events, native macOS picker behavior/OS permission prompts, current Chrome microphone/MediaRecorder/AudioWorklet behavior, Indian English/telephony recognition, final playable audio, disk-full or detached-drive behavior, real network outages, model switching under real latency and a one-hour call across automatic rotation remain untested. Recording-on/off latency/resource comparison is also outstanding. Follow [MANUAL_ACCEPTANCE.md](MANUAL_ACCEPTANCE.md) before treating the app as validated for important calls.

Secret scanning and filename inventory cannot prove the absence of all private text, copyrighted content or novel secret formats; review public files/screenshots manually before publishing. Do not describe offline mock success as real audio accuracy or guaranteed reliability.

## Feature delivery verification — 2026-10-24

Scope: the custom favicon, additional asynchronous MP3 exports, shared saved preferences, native save-folder opening, and the documented PR/CI merge workflow.

- `npm ci`, `npm run check` (54 tests, zero failures/skips, TypeScript and production builds), and `npm run licenses` passed on macOS arm64 with Node.js 24.8.0.
- The final review corrected MP3 finalization to open its temporary file with write access before syncing; Windows `FlushFileBuffers` requires a writable handle. This is a code correction, not a claim of Windows hardware testing.
- Official gitleaks 8.30.1 was checked against its published SHA-256 checksum. The unchanged `npm run secrets` scanner passed in a clean local release checkout containing the committed deliverables, complete feature history, and current client/backend build outputs. The workstation's ignored local `.env` remained private and unchanged.
- Browser inspection used isolated synthetic settings to check preference restoration and the separate open-folder button. Automated integration tests cover opening the selected folder during a mock transcription session, authentication/CSRF, unavailable or redirected folders, retries, and unchanged saved settings.
- Real microphone/OpenAI latency and Windows native file-manager behavior remain manual acceptance items. No audio-quality or zero-impact latency claim is made.

The earlier verification sections above are the original dated record, not the current test count or an assertion that cloud CI has never run.

## Conversation library implementation — 2026-11-19

- Implemented the library home page, saved title/description editing, transcript/audio review, and a separate live recording workspace. Historical timestamp filenames are grouped without modifying original media or text. Chrome Quick Start 0.2.0 requests the recording workspace; the app preserves active sessions and deduplicates retried requests.
- `npm ci`, `npm run check` (68 tests, zero failures/skips, TypeScript and production frontend/backend builds), `npm run licenses`, and `GITLEAKS_BIN=/private/tmp/clearscribe-tools/gitleaks npm run secrets` passed. Gitleaks 8.30.1 was downloaded from the official release and its archive verified against the published SHA-256 checksum before use.
- New tests cover legacy grouping, transcript/description search, persistence through fresh disk reads, original-file preservation, pagination, sort, missing/partial formats, corrupt metadata, ID/path validation, symlink rejection, authentication/CSRF, stale folder identity, and HTTP byte ranges/HEAD/download. Mock session integration confirms active files cannot be played and finalized conversations can be reviewed. Extension tests cover delivery of the recording destination through the background/content bridge.
- The existing asynchronous MP3 integration test had a race: the final MP3 could appear before temporary-file and job cleanup completed. Its wait now observes cleanup as well as publication; its exact final-output assertions remain intact.
- Browser checks used the production build on a separate loopback port and disposable synthetic files/settings. Verified library grouping, review navigation, title/description saves, description search, native audio metadata loading, seeking a three-second synthetic MP3 to one second using a transcript button, and navigation to the existing recording setup with Start disabled for a missing key. Inspected desktop and 390px library/review layouts; the narrow review had no horizontal document overflow. Screenshots contain only synthetic content.
- The unsaved-edits confirmation appeared during browser inspection, but the browser automation could not dismiss the dialog reliably; the discard/cancel flow remains a manual acceptance item. No real microphone/OpenAI session, installed Chrome extension shortcut, Windows playback, or native folder-manager launch was exercised. Backend/native launch and extension bridges use existing offline coverage. No publication, merge, release, or deployment was performed.

### Conversation deletion — 2026-11-19

- The user reported successful real recording and Chrome extension testing of the library implementation before this follow-up.
- Replaced the redundant right-side Open button with an accessible trash icon. A modal names the conversation, warns that deletion is permanent, and offers Cancel and Delete all related files. Titles still open review. Active recordings cannot be deleted.
- The authenticated, CSRF-protected deletion endpoint removes exact session filenames (transcript, audio formats, partial audio, transcript temporary file, metadata, and known MP3 temporary files), cancels queued/running MP3 conversion and its durable intents, and reports partial failures. Neighboring session prefixes and unrelated filenames are preserved. Symlink targets are not followed; directory replacements are refused. Metadata writes and deletion cannot overlap.
- `npm run check` passed with 71 tests, zero failures/skips, type checking, and production builds. License and verified-gitleaks secret scans passed. New coverage exercises complete related-file removal, neighboring file and symlink-target preservation, CSRF/stale-folder/ID rejection, active-recording rejection, failure/retry and metadata-only cleanup, and queued/in-flight MP3 cancellation with no retry intent or temporary output left behind.
- Production browser inspection with disposable synthetic content verified the trash icon, accessible confirmation dialog, Cancel and Escape dismissal (all four sessions retained), and title-click navigation into review. No real recordings were deleted during development; confirmed deletion was exercised through the isolated API/filesystem tests.

### Owner acceptance before delivery — 2026-11-19

The owner reported that recording and the Chrome extension worked as expected, then confirmed all changes, including conversation deletion, and authorized a GitHub pull request and protected merge to `main`. This records owner acceptance; it does not add measured recognition accuracy, latency, or Windows test results.
