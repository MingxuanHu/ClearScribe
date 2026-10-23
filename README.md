# ClearScribe

### Live English captions, no AI replies.

A quiet workspace for following a real conversation. Put your phone on speaker beside your Mac, select the built-in microphone, and read English captions as you talk. Your words stay yours: ClearScribe does not suggest answers, translate, summarize, polish speech, assign speakers, or play an AI voice.

**Local application · React + TypeScript · OpenAI transcription · Apache-2.0**

---

## What it does

- Streams microphone PCM to a dedicated transcription session, with partial captions that are replaced by the final text.
- Offers compatible account models through a maintained capability allowlist, with explicit output timing and availability status.
- Segments speech on the client, keeps a short prefix, and commits long utterances regularly.
- Saves an incremental UTF-8 transcript and a continuous encoded recording directly into a folder you choose outside all Git worktrees.
- Keeps the same timeline and file pair during model switches. Shows pending/switching states and bounds the audio buffer.
- Provides readable captions, adjustable font size, microphone level, pauseable auto-follow, copying and file downloads.
- Keeps the long-lived API key on the local backend. No account system, database, screen sharing, virtual soundcard or telephone integration is required.

This is a working implementation with offline mock coverage, **not a claim of measured recognition quality**. Actual model access, microphone capture, speakerphone quality, Indian English recognition, playable recordings and hour-long sessions require the [local acceptance checks](docs/MANUAL_ACCEPTANCE.md). No accent accuracy or zero-latency guarantee is made.

## Quick start

**Requirements:** macOS or Windows, a current desktop Chrome, Node.js **22.12 or newer** (Node 24 recommended), npm, Internet access and an OpenAI API key with transcription access. Native folder selection supports macOS and Windows (Windows PowerShell with Windows Forms). Linux is not yet a supported recording environment. Chrome is the intended primary audio environment; this delivery did not run real Chrome microphone/API acceptance.

Replace `<repository-url>` with the actual repository URL after the owner publishes it:

```sh
git clone <repository-url> ClearScribe
cd ClearScribe
npm ci
cp .env.example .env
```

Edit `.env` locally and fill in `OPENAI_API_KEY`. Do not send your key in chat, enter it in a webpage, or prefix it with `VITE_`.

```sh
npm run dev
```

Open **[http://127.0.0.1:5173](http://127.0.0.1:5173)**. One command runs both the frontend and backend; Ctrl+C stops both. Missing-key startup shows a clear setup message and disables Start.

For the built application:

```sh
npm run build
npm start
```

Open **[http://127.0.0.1:4317](http://127.0.0.1:4317)**. The backend serves only built public assets. Use `127.0.0.1`, not another hostname; the service intentionally checks Host and Origin. Both modes bind to loopback only. Do not expose them using a tunnel or reverse proxy.

The code is free and open source. **OpenAI API usage is billed separately; ChatGPT Plus does not include API usage.** Consult [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) and your API billing settings. No fixed price is asserted here.

## Remembered save folder

Choosing a folder saves its canonical absolute path immediately to a local `settings.json` file. The next `npm start` or `npm run dev` restores it, including after reboot. Default locations:

| Platform | Settings file |
| --- | --- |
| macOS | `~/Library/Application Support/ClearScribe/settings.json` |
| Windows | `%APPDATA%\ClearScribe\settings.json` (falls back to the user's `AppData\Roaming`) |
| Linux configuration convention | `$XDG_CONFIG_HOME/clearscribe/settings.json`, or `~/.config/clearscribe/settings.json` |

Set `CLEARSCRIBE_CONFIG_DIR` in `.env` or the backend environment to override the configuration directory; an absolute path is recommended. Development and built mode share these settings for the current OS user. Recordings and transcripts remain in your chosen output folder. Configuration contains only a schema version and the save-folder path, not API keys, audio, transcripts, or browser authentication tokens. Other recognition/UI preferences are not persisted by this feature.

Startup validates the restored folder using the same checks as folder selection. If settings are damaged, the folder was removed, permissions changed, or an external disk is disconnected, the page shows a warning and requires a valid selection. The saved path is retained so reconnecting the drive and restarting can restore it. Cancelling a folder dialog preserves the previous selection. Choosing a new folder replaces the settings atomically; failure to save is reported instead of claiming persistence. Moving this file to another computer does not make its local folder path portable.

## Optional Chrome extension: one-key recording

**Quick Start is a Chrome browser extension feature**, supplied in [`chrome-extension/`](chrome-extension/). The normal page and Start button work without the extension. Chrome and the local frontend/backend must be running; the global shortcut cannot launch a fully quit Chrome or start the local servers.

1. Start the built app with `npm start` (after building), or start development with `npm run dev`.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's `chrome-extension` folder. Chrome adds a card named **ClearScribe Quick Start**. If ClearScribe was already open before installation, refresh that webpage once so the extension can communicate with it.
3. On the **ClearScribe Quick Start** card, click **Details**, then **Extension options** to open the app URL settings. The default app URL is `http://127.0.0.1:4317/`. For development use `http://127.0.0.1:5173/`; for a custom port, enter its exact local root URL. Only HTTP URLs on `127.0.0.1` are accepted. Click **Save** after changing the URL; changing this setting does not require reloading the extension.
4. At `chrome://extensions/shortcuts`, set **Open ClearScribe and start recording** to your preferred combination and set its scope to **Global**. The suggested shortcut is Ctrl+Shift+9 (Command+Shift+9 on macOS). OS or other extension conflicts may require a different combination.
5. Complete first-use setup on the page: backend API key, writable save folder, available model, and Chrome/OS microphone permission. For predictable capture, verify your microphone once with the normal Start button.
6. From another tab or another app, press the shortcut. If ClearScribe is closed, the extension opens it, focuses the browser window, waits for setup to load, and requests a new recording and live-caption session. If already open, it reuses the page. Clicking the extension toolbar icon does the same thing.

**After updating the extension files** (for example, after pulling a new version of this project):

1. Finish any active recording first and wait for **Finishing** to complete.
2. Open `chrome://extensions` and find the **ClearScribe Quick Start** card. With **Developer mode** enabled, click the card's circular-arrow **Reload** button. This makes Chrome reread the files in `chrome-extension/`. Refreshing the extensions management webpage alone does not reload the extension.
3. Switch to each already-open **ClearScribe webpage** and refresh it using Chrome's toolbar reload button, **Command+R** on Mac, or **Ctrl+R** on Windows. This reconnects the page to the newly loaded extension. If no ClearScribe page is open, skip this step; the shortcut will open a new one.
4. Press your shortcut again to open or focus ClearScribe and start a new session.

These are two separate actions: **Reload** on the extension card updates the extension; refreshing the **ClearScribe webpage** reconnects that page. You do not need to reinstall the extension or repeat these steps for everyday use, service restarts, or saved URL/shortcut changes. See Chrome's official guides for [opening extension settings](https://developer.chrome.com/docs/extensions/develop/ui/options-page#locating_the_options_page) and [reloading an extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#reload_the_extension).

Repeated presses during connection/recording/finishing only bring the page forward; they do not replace an active call. If a different page owns an active session, return to that page rather than starting another call. Loading or refreshing the URL on its own never starts recording. Missing settings and microphone permissions require your action; Chrome can also block audio startup on a newly opened page. ClearScribe then asks you to click **Start session** and checks audio startup before opening an upstream transcription session. One-key startup remains subject to browser and OS permissions.

If the local app cannot be reached, the extension displays a **!** badge; hover its toolbar icon for the error. Check that the service is running and that the configured URL matches your mode/port, then press again. Successful delivery brings you to the page, which shows actual connection/recording status and any setup or API errors.

The extension has access only to `http://127.0.0.1/*` and stores its app URL locally in Chrome. Chrome host permissions cannot be limited to individual ports, so this covers loopback ports. The extension sends a start request to the matching app tab; microphone capture, captions and file saving remain in ClearScribe. It does not handle your API key or record inside the extension.

## A call, from beginning to end

1. Configure your backend key and restart the service.
2. Click **Choose save folder**. In the macOS dialog, select an ordinary writable folder outside this project and every other Git worktree. The folder is not created automatically. Its full path is shown locally for confirmation; avoid including that path in public screenshots.
3. Refresh/select a compatible model and select your Mac’s built-in microphone. Model refresh does not start a paid audio session.
4. Put your phone on speaker near the Mac. Click **Start session** and allow microphone access. **Connecting** is preparation; recording and upstream audio transmission begin only after the transcription configuration is confirmed and the microphone pipeline starts. Wait for **Listening** before speaking.
5. Read the captions. Provisional text may change. Scroll upward to pause following, then use **Jump to latest**. Adjust font size as needed.
6. To change models, select the new model. ClearScribe waits for a speech boundary, commits/drains the old segment, then creates and confirms the new transcription session. The recording continues into the same audio file. Switching is bounded and is not guaranteed gapless.
7. Click **Stop session**. Capture stops immediately; already captured samples and recording chunks finish, the last speech turn is committed, and final results are awaited for a limited time. Leave the page open during **Finishing**.
8. Check the independent **TXT Saved** and **AUDIO Saved** indicators. Only finalized audio is offered for download. Copy text or download file copies. Start again for a new call and a new file pair.

Clear screen clears only the visible captions. It does not delete any saved file. Use Finder to delete recordings and transcripts yourself.

## Models and recognition settings

| Model | Output | Implemented adapter |
| --- | --- | --- |
| `gpt-live-transcribe` | Partial text while speech arrives; final on commit | Dedicated transcription session, 24 kHz PCM16, client segmentation |
| `gpt-transcribe` | Transcription begins **after each speech segment is committed** | Separate configuration over the same dedicated WebSocket workflow |

The backend intersects **the dynamic account model list with a known capability allowlist** in `server/models.ts`. Model IDs must match exactly; unknown snapshots and assistant, translation, TTS, deprecated and offline-only models are excluded. New model releases usually require documentation review, adapter maintenance and tests. The account list does not provide a complete capability matrix, and a listed model can still fail due to permissions, quota or endpoint access.

Listing permission denied: compatible candidates are marked **unconfirmed** and actual session creation checks access. Network/authentication failures: the UI explicitly shows stale/candidate results and their last successful timestamp. Successful lists that exclude your saved preference require you to choose another available model. Refreshes are cached for five minutes and explicit refreshes are throttled to at most once per 30 seconds, including concurrent requests. The model preference is stored in browser local storage. The save-folder preference is stored by the backend in the per-user settings file described below.

Live-model delay defaults to **low**; **medium** supplies more context at the expense of earlier text. Context and terms are recognition hints, never a request to generate missing content. The UI conservatively limits context to 400 characters, 40 terms and 60 characters per term. Terms cannot contain angle brackets or embedded newlines. English uses `languages: ["en"]`; the legacy singular field is not sent.

Automatic gain is on; noise suppression and echo cancellation default off because the phone speaker is wanted input. Adjust these in **Fine-tune recognition** using your actual setup. The energy gate defaults to 0.008 normalized RMS, with 300 ms pre-roll, 850 ms end silence and a 25-second maximum turn. A low-volume phone may require a lower threshold or closer placement. This gate is a simple, tunable heuristic; background sound may trigger false speech.

## Your two files

All formal outputs are flat in the selected folder. A successful call produces exactly two files sharing a local start-time basename:

```text
2026-10-23_20-48-15+1100.txt
2026-10-23_20-48-15+1100.webm
```

The example is synthetic. UTC offsets and fixed-width date/time fields use the machine's local timezone. Same-second collisions use the same incremental suffix on both files, e.g. `…+1100-1.txt` and `…+1100-1.webm`; exclusive creation protects existing files. Extension follows the actual supported MIME type: WebM/Opus → `.webm`, MP4 → `.m4a`, Ogg/Opus → `.ogg`. Renaming WebM does not convert it to WAV.

- TXT is saved incrementally as results change, including clearly marked `[PROVISIONAL]` text. Final text replaces its partial at the same sequence position. Updates coalesce, sync a `.txt.tmp` file and rename it into place; no permanent JSON/JSONL sidecar is created.
- Recording includes natural pauses from the same microphone stream. MediaRecorder chunks are appended in order to a single `.webm.part` (or corresponding format) directly in your selected folder; chunks are not assumed independently playable. A final audio-name reservation prevents collisions. Only a successful encoder/upload/flush and backend finalization marks audio **Saved** and renames the part file.
- Cancelling the picker preserves the current selection. The backend validates real paths, project containment, ancestor `.git` markers, permissions and an exclusive write probe on selection and Start. Output is never staged inside this repository. Folder selection is persisted in the per-user settings file and revalidated after a service restart. Restarting never resumes recording automatically.
- Refreshing/closing releases the upstream connection and attempts to save text already received; it cannot guarantee the final MediaRecorder chunk. Capture never resumes automatically. The current backend process exposes its latest TXT/finished audio for recovery/download; older files remain in Finder. There is no session database.
- Crashes, unplugged disks, full disks and power loss can leave empty reservations, partial audio or temporary TXT. Do not assume these are complete recordings; preserve recoverable files and inspect them locally. No application can guarantee the normal two-file outcome after those failures. The application does not silently delete partial content.

Timestamps are **approximate segment starts from the microphone sample clock**, relative to capture start. They are not network arrival times, speaker timestamps or word-level alignment. No confidence percentage or speaker identity is invented.

## Architecture & bounds

```text
Microphone → AudioWorklet → stateful resampling → client speech gate
                                                  ↓ PCM16 / 24 kHz
                                           local Node WebSocket
                                                  ↓ backend key
                                      OpenAI transcription session
                                                  ↓ deltas / finals
                                      ordered captions + incremental TXT

Same microphone → MediaRecorder → independent bounded HTTP chunk queue
                                         ↓ local backend
                               selected external folder / audio.part
```

The browser does not play captured audio. The backend constructs all OpenAI requests; the browser cannot specify upstream URLs or authentication. Recognition audio is sent to OpenAI: **this is not offline transcription**. Encoded recordings stay on the local machine and are not sent to any other service by ClearScribe.

PCM transport stops with an explicit gap warning beyond five seconds of upstream/backpressure or switch buffering; it never accumulates an entire utterance before transmission. Recording has its own 8 MiB browser queue, sequential uploads, a 1 MiB chunk limit and a 10-second request timeout. Failed audio saving does not block captions. Audio finalization has a bounded browser wait; final transcript drain waits up to eight seconds. There is no automatic reconnect/replay, avoiding hidden repeated transcription/cost. Retry means a new user-initiated call. Existing results remain visible.

Sessions conservatively request rotation at 50 minutes, or earlier from a returned expiry, at a safe speech boundary. A 45-second rotation deadline stops explicitly if rotation cannot proceed. This application policy is intentionally below the general Realtime duration ceiling; a separate guarantee for these transcription models was not established in the dedicated guide. Model switches use the same call/file identity. Unconfirmed old results remain provisional; retired connection events are isolated. Buffer overflow or switch failure stops with a possible-gap warning, rather than claiming the new model is active.

For one-hour planning, 64 kbit/s encoded audio is about **29 MB/hour before container overhead**; actual browser output varies. PCM is streamed and not retained for the whole call. Transcript memory is limited to approximately 2 million JavaScript characters, 20,000 segments and 200,000 upstream event IDs; TXT snapshots are capped at 4 MiB. Calls have a four-hour submitted-audio safety cap. Disk usage grows with actual duration; available disk space is not unlimited. These are design bounds, not measured hour-long resource/latency results. Saving can affect performance; no zero-overhead claim is made.

## Configuration

| Variable / setting | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Empty | Backend environment only; required for Start |
| `PORT` | `4317` | Local backend HTTP/WebSocket port |
| `DEV_PORT` | `5173` | Vite development port and allowed development origin |
| Model preference | `gpt-live-transcribe` | The only browser-persisted preference |
| Live delay | `low` | `low` or `medium` |
| Save folder | None | Selected via native macOS dialog; no arbitrary path API |

Restart after changing environment variables. Do not put secret values into Vite configuration or frontend code.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Start disabled | Configure the backend key, choose a valid external folder and a currently offered model. Restart after key edits. |
| Permission denied / microphone missing | Chrome site settings → microphone; macOS privacy permissions; correct input device; retry Start. |
| No words / speakerphone too quiet | Wait for Listening, watch the level meter, bring the phone closer, raise speaker volume or lower the speech threshold. Avoid headphones for this speakerphone setup. |
| Accent/technical terms misrecognized | Try relevant literal terms and medium live delay, improve phone audio and compare representative consented audio. Recognition can still be wrong. |
| Key invalid / model unavailable / quota | Check the API project key, transcription-model access and API billing. Plus subscriptions are separate. No silent model fallback occurs. |
| Refresh fails or selection disappears | Stale/unconfirmed labels are intentional. Check listing permission/network; explicitly select an offered model after a successful refresh. |
| Network disconnect / slow switch | Existing text remains; later audio may be missing. Stop, inspect TXT/audio, then start a new call. Audio is not silently replayed. |
| Recording save fails | Check folder permissions, free disk space and attached disks. Captions can continue. A `.part` file may be incomplete; choose another directory for the next call. |
| Native folder dialog fails | macOS is required; allow the native dialog and any applicable OS automation permission. Browser download settings are not a replacement for folder selection. |
| Only one tab connects | The backend intentionally allows a single live client. Close the previous tab or wait for it to stop. |
| Page reload loses live capture | Expected. Current process files can be recovered; capture must be started again. Never reload while Finishing. |
| Wrong address / port occupied | Use the exact printed `http://127.0.0.1:PORT` URL. Stop another instance or change PORT/DEV_PORT and restart. |

## Development & verification

```sh
npm run typecheck
npm test
npm run build
npm run licenses
# Install official gitleaks first, e.g. brew install gitleaks on macOS:
npm run secrets
# Or set GITLEAKS_BIN to an already installed verified binary.
```

`npm run check` runs types, all tests and the production build. Tests use synthetic content and local mock WebSocket servers. They do not require an API key, contact OpenAI, or upload recordings. CI uses read-only permissions, verified pinned actions and checksum-verified gitleaks. It runs no microphone tests and publishes no private artifacts.

For a clearly labeled **synthetic layout preview only**, run the development server and open `http://127.0.0.1:5173/?preview=1`. It creates no microphone or OpenAI session; Start is disabled. This development-only fixture is not simulated recognition and is omitted from production behavior.

See [verification details](docs/VERIFICATION.md), [official API decisions](docs/API_NOTES.md), [manual acceptance](docs/MANUAL_ACCEPTANCE.md), [security](SECURITY.md), and [contributing](CONTRIBUTING.md).

## Before publishing

1. Complete the representative local acceptance checks and record honest results. Review screenshots for paths and real conversation content.
2. Inspect `git status`, tracked files, the staged diff and history. Ensure no environment files, keys, private audio or transcript exports are tracked. Revoke/replace any exposed key before attempting cleanup or publication.
3. Run `npm ci`, `npm run check`, `npm run licenses` and `npm run secrets`. Review failures; a scanner pass does not prove absolute safety.
4. Review [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). This selected project name does not assert global uniqueness or trademark clearance.
5. Create the remote repository manually, replace the clone placeholder, enable private security reporting if desired, review/stage/commit the intended public files, add your remote and push yourself. No remote repository, push, release or deployment is created by this project-generation task.

## License

[Apache License, Version 2.0](LICENSE). The original full license text is retained; it was checked against the [Apache Software Foundation source](https://www.apache.org/licenses/LICENSE-2.0.txt). Direct runtime dependencies retain their MIT notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
