# Local acceptance — still required

Use macOS and current Chrome, a locally configured key, an explicitly selected external folder, and synthetic or consented non-private test speech. Do not commit phone recordings, real interview text, secrets or identifying screenshots. These checks were **not run against real microphone/OpenAI audio during generation**.

- [ ] Missing key: guidance is visible; Start cannot create a paid session. Listing denied: candidates show unconfirmed. Removed model preference requires a new explicit choice.
- [ ] Native chooser: select an external writable folder; cancel preserves selection; project/subdirectories/another worktree/symlink into a worktree are rejected. Allow any applicable macOS dialog permission. No folder is auto-created.
- [ ] Start: microphone permission only after the click; denial, missing device and unsupported encoding are clear. Connecting sends no microphone audio; wait for Listening before speaking.
- [ ] English speech appears incrementally with the live model. Final text replaces provisional text. With the committed-turn model, output begins after the speech boundary.
- [ ] Representative Indian English, connected speech, technical terms and phone speaker audio: inspect actual errors. Compare low/medium delay, threshold, gain, echo cancellation and suppression. Do not assume a fixed accuracy.
- [ ] Silence causes no repeated empty commits. Quiet speech retains its beginning; mid-sentence pauses are acceptable; a long utterance commits around 25 seconds without unbounded buffering.
- [ ] Stop during speech: microphone indicator turns off promptly, final words arrive or remain marked PROVISIONAL, and Finishing ends. Repeat quick Start/Stop, including cancellation while connecting.
- [ ] Switch mid-speech, mid-silence, during a long utterance and immediately before Stop. Pending/current indicators are honest; only a confirmed new session becomes active. Test switch failure and buffer overflow; inspect gap notices. The same two files/timeline persist and recording stays continuous.
- [ ] Font controls, copy, auto-follow pause, Jump to latest, TXT/audio download and Clear screen all work. Clearing the screen leaves disk files intact.
- [ ] Disconnect the Internet or close the upstream: existing text remains, the gap is explicit, there is no hidden replay/reconnect. User retry creates a new call.
- [ ] Make save folder unwritable/full or detach its drive. Captions can continue, separate save statuses report failure, no false Saved appears. Start a new call in a new folder.
- [ ] Final normal output is exactly two flat files, with the same safe basename/offset, no extra JSON or metadata. Same-second starts do not overwrite anything. TXT order, punctuation, approximate times and provisional labels match the UI.
- [ ] **Play the entire final encoded audio in a trusted local player**, including opening, last phrase, natural pauses and model-switch boundary. Confirm MIME/extension agreement. Unit tests contain deliberately non-playable synthetic byte buffers and cannot verify this.
- [ ] Refresh/close: browser warns during active capture; the backend releases its upstream; the latest files remain recoverable. Partial recordings are not mislabeled complete. Restart the service and reselect the folder.
- [ ] Run at least **one hour**, crossing the 50-minute session rotation. Watch RAM, disk writes, CPU, queue behavior and continuity. Confirm no background silent termination. Four-hour safety/transcript limits should be tested separately if relevant.
- [ ] Compare caption latency/resource use with the recording path enabled and with it disabled in a controlled development instrumentation branch (the shipped UI requires recording for the normal two-file workflow). Record first-character latency, final-text latency and network RTT separately. Do not invent numbers or claim recording has no cost.
- [ ] Inspect local logs, public assets, staged files and history with secret scanning. Manually review that screenshots and text are synthetic. Complete the README publication checklist before pushing.
