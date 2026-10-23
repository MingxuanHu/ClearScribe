# Security

ClearScribe is a local, single-user application. It is not a remotely deployable transcription proxy.

## Keys and trust boundaries

- Put `OPENAI_API_KEY` only in the backend environment or a local `.env`. Never use `VITE_*`, browser storage, public configuration, URLs, screenshots, or issue text for a key.
- The browser receives a random, process-local session token, not the OpenAI key. The backend uses a fixed transcription endpoint and builds upstream messages itself.
- Both servers bind to `127.0.0.1`. HTTP and WebSocket requests validate Host/Origin. Control requests require a CSRF token and a SameSite, HttpOnly cookie; WebSocket upgrades also require the process token. No wildcard CORS is provided.
- Trust the local OS account, browser, dependencies and other software executing under that account. A malicious local process, browser extension, compromised same-origin page or filesystem attacker can exceed these protections. Do not tunnel, reverse proxy or expose the port to a network.
- Only one live browser connection/upstream is allowed. Audio/messages have size limits, bounded queues and explicit failure behavior. Recording and PCM use independent transports.
- Only the production `dist/` directory is publicly served. Downloads select the current call by kind; there is no general filesystem read/write API. Native folder selection retains paths on the backend; real paths and Git ancestors are validated on selection and Start.

## Local and remote data

Recognition audio goes to OpenAI; this is not offline speech recognition. Encoded microphone recording chunks and TXT snapshots go directly to the selected external folder. No audio is sent to another service. Logs exclude key values, transcripts, audio and full local paths. TXT and audio are private files created with mode `0600` (platform/filesystem permission behavior may vary).

Stop normally waits for final results. Closing/reloading disconnects the upstream and attempts a bounded final drain. Browser recording finalization cannot be guaranteed on unload, crash, disk failure or power loss. Keep recoverable `.part` and `.tmp` files private. Delete files in Finder when no longer needed; ClearScribe has no disk-delete API.

## Reporting a vulnerability

Do not post secrets, recordings, real transcripts, exploit credentials, or sensitive paths in public issues. If the published repository has GitHub private vulnerability reporting enabled, use its **Security → Report a vulnerability** flow. Otherwise, request a private reporting channel from the maintainer without disclosing sensitive details publicly. No contact address is configured in this starter repository.

If a real key is exposed, revoke it and create a replacement first. Inspect files and Git history, coordinate any necessary history cleanup, then scan again. Do not assume `.gitignore` removes previously committed data. Do not rewrite shared history without coordination.

Run `npm run secrets` with the official gitleaks tool before publication. A passing scan is evidence, not a guarantee of safety.
