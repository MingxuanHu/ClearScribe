# Contributing

Use Node.js 22.12+ (Node 24 recommended) and npm. Run `npm ci`, then `npm run dev`. Production builds use `npm run build` and `npm start`.

Before submitting changes, run `npm run check`, `npm run licenses`, and `npm run secrets` with gitleaks installed. Tests use synthetic text/bytes and a local mock WebSocket server; no OpenAI account or key is needed. Do not add real calls, interview content, credentials or recordings to tests or issues.

Keep the app focused on English captions: no assistant responses, speaker guesses, translation, rewriting or generated audio. Add a model only after reviewing the official dedicated transcription guide, implementing its adapter and meaningful lifecycle tests, and documenting output timing and limitations. Do not accept models by name regex or SDK enum alone.

Keep filesystem writes outside all Git worktrees. Preserve bounded audio and recording queues, session isolation, incremental text saving and explicit failures. Review the checklist in `docs/MANUAL_ACCEPTANCE.md` for changes involving browser audio or lifecycle behavior.

Contributions are licensed under Apache-2.0. Include any required notices for third-party code or assets.
