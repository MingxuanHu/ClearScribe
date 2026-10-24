# Project language

Use English throughout this repository. Write all new or modified documentation,
README content, code comments, identifiers, UI text, error messages, logs, tests,
and configuration descriptions in English. Do not add Chinese translations or
other non-English explanatory text to project files.

This rule applies to the entire repository. Conversation with the user may follow
the user's preferred language.

# Feature delivery and merge workflow

Use this workflow whenever the user asks to deliver, publish, or merge a feature.
That request authorizes the normal branch push, pull request, CI verification,
and merge steps below without asking for approval again at each step. An explicit
instruction to develop only, wait for user testing, or not push/create a PR/merge
takes precedence. Merely documenting this workflow does not authorize publishing
the current branch. A feature delivery does not include creating release tags,
publishing installers/packages, or deploying a hosted service unless requested.

1. Work on a `codex/` feature branch. Keep `main` as the integration branch; never
   publish a feature by pushing commits directly to `main`.
2. Update relevant documentation, including README behavior and configuration
   changes. Review the intended diff and exclude credentials, local settings,
   recordings, transcripts, and unrelated changes.
3. Run `npm ci`, `npm run check`, `npm run licenses`, and `npm run secrets` before
   delivery. `npm run check` includes TypeScript, all automated tests, and the
   frontend/backend production build. Install the verified gitleaks tool or set
   `GITLEAKS_BIN` for the secret scan. Do not report an unavailable check as passed.
   Record relevant manual acceptance results honestly; automated mocks do not
   establish real microphone quality or latency.
4. Fetch the latest remote `main`, resolve any integration conflicts on the
   feature branch, and rerun checks after integration or implementation changes.
   Preserve other work and shared history; do not force-push without explicit
   authorization. Commit the reviewed changes.
5. Push the feature branch to `origin` and create a GitHub pull request targeting
   `main` (the equivalent of a merge request). Reuse an existing PR for that branch
   rather than creating duplicates. Describe the actual behavior, validation,
   and relevant limitations. Attach each created or actively updated PR to the
   current Codex chat using the available artifact tool.
6. Verify the cloud merge gate before attempting any merge. `main` must require a
   pull request and the GitHub Actions `check` status from
   `.github/workflows/ci.yml`, with the branch up to date before merging. The
   protection must apply to administrators too, prevent force pushes/deletion,
   and have no bypass used for this delivery. Inspect both classic branch
   protection and effective repository rulesets. A workflow file or this document
   alone does not enforce GitHub branch protection. If protection is missing,
   establish it as part of an authorized delivery while preserving existing
   stronger requirements. If permissions, plan limits, or unavailable checks
   prevent enforcement, stop before merging and report the concrete blocker.
7. Wait for the PR's current revision to finish CI successfully. The existing
   `Offline checks` workflow runs on push and `pull_request`; its `check` job
   installs dependencies, runs types/tests/build, checks licenses, and scans for
   secrets. Require an actual successful `check` result for this PR revision (or
   its current GitHub test-merge commit), plus all other required checks. Missing,
   queued, running, failed, cancelled, skipped, neutral, or stale results are not
   a passing merge gate. An empty required-check list is not proof of success.
   Every new push or base update invalidates the previous merge decision: inspect
   the latest revision and wait for its checks again.
8. Fix failures on the feature branch, rerun relevant checks, push the fixes, and
   repeat the PR gate. Never disable tests, weaken protection, skip scans, use
   administrator bypass, or merge a red PR to complete delivery.
9. Merge through the GitHub PR only after successful current checks, any required
   reviews, resolved required conversations, and confirmed mergeability. Use a
   merge operation that verifies the expected PR head SHA so a later push cannot
   be merged under an earlier approval/check decision. Follow the repository's
   enabled merge strategy; do not substitute a direct push to `main`.
10. Confirm the PR is merged and verify the resulting `main` push workflow also
    succeeds. Sync local `main` only when it can be done without disturbing
    uncommitted or unrelated work. Report the PR URL, merge commit, and CI outcome;
    do not claim a release or deployment that was not performed.
