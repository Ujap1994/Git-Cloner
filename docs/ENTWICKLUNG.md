# Architecture and development

Git Cloner is a single-instance Node.js/Electron desktop application. The main process owns filesystem operations, credentials, Git subprocesses and network clients. The renderer uses a limited preload bridge; context isolation, sandboxing and web security are enabled and Node integration is disabled. IPC handlers validate the sending window/frame and accept only the local application document.

## Components

- `app/main.cjs`: application lifecycle, windows, native integration, notifications and validated IPC.
- `app/runtime.cjs`: persisted settings, provider clients, queue orchestration, scheduling, program update policies, reminders and runtime state.
- `app/core/backup.cjs`: source expansion, per-destination jobs, staged backups, integrity verification, progress and resumable queues.
- `metadata.cjs` / `hosted-metadata.cjs`: GitHub/GitLab/Forgejo metadata and release planning; `release-assets.cjs` applies OS, CPU, format and DMG-variant filters.
- `release-presence.cjs`: lightweight checks for missing/truncated physical release files during unchanged runs; full content hashing keeps its configured cadence.
- `release-downloads.cjs`, `release-transfer.cjs`, `release-reuse.cjs`: resumable downloads, validation, local reuse and bounded temporary storage.
- `program-installation.cjs`, `program-content.cjs`, `program-archives.cjs`: verified program selection, safe extraction, architecture/signature checks, staged installation and one retained rollback version.
- `physical-fs.cjs`: uses Electron's `original-fs` only for installer filesystem operations so external ASAR archives remain physical files. The app's own archive loader stays enabled.
- `integrity.cjs`, `archives.cjs`, `selective-restore.cjs`: manifests, encryption and verified recovery.
- `github.cjs`, `hosted-client.cjs`, `rate-limit.cjs`, `transport.cjs`: provider access, bounded response caches, quota waiting and shared bandwidth limits.
- `app/renderer`: bilingual UI, source management, program library and English rendering of core diagnostic messages.

## Storage and ownership

A source may have multiple independent destinations. Each managed backup has an identity marker and manifest. New content is staged and verified before replacement; an unsuccessful update leaves the last successful backup. Release files are visible in the owned `Git-Cloner-Releases` folder, or inside the encrypted archive.

Program destinations must be separate from backup destinations. A program marker identifies the source and selected files. Foreign files and running managed applications prevent unsafe replacement. The most recently replaced installation is retained separately. Rollback is explicit and prevents immediately reinstalling the reverted release.

Settings exports omit credentials. Tokens and remembered archive passwords use Electron safeStorage; an insecure Linux secret-store backend is rejected. Restores create a new destination rather than overwriting an arbitrary existing folder.

## Development workflow

Use `npm ci`, `npm run check`, and `npm run test:e2e`. Run `npm run screenshots` when changing documented UI. Use `npm run format` before committing. `.git-blame-ignore-revs` lists the formatting-only commit.

Tests use local repositories and isolated profiles. Never point a fixture or screenshot test at a real user's backup or profile. Native macOS tests compile ad-hoc signed fixtures; hardware-connected applications are not launched by installer tests.

The CI and release matrices are documented in [Verification](VALIDIERUNG.md). Release documentation is English; UI strings remain bilingual.
