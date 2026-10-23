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
