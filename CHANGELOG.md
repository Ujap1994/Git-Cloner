# Changelog

## 3.7.0

### Added

- Global program-update policies: after exit, next check or manual installation.
- One retained program version with explicit rollback and a hold on the reverted release.
- Exact Universal, ARM64 and x64 DMG selection globally and per source.
- Pause reminders and optional automatic resume after a chosen duration.
- API quota display and proactive queue waiting.
- Daily bandwidth windows and program/version-specific notifications.
- ASAR installation tests inside Electron, English GUI coverage, explicit screenshot generation and API/cache performance checks.
- ARM64 Flatpak and Snap package targets for both Linux architectures.

### Fixed

- Missing or truncated release assets are repaired during unchanged backup checks.
- Downloaded Electron ASAR archives remain physical files when programs are extracted, copied and cleaned up.
- Remaining English E2E assertions and isolated-worker fixture paths.

### Changed

- Git Cloner's version discovery does not use the GitHub API.
- Prettier formatting is checked by lint; the formatting-only commit is excluded from blame.
- Release documentation is consolidated in the complete English guide.

## 3.6.1

- Handle Finder layout metadata when verifying signed apps from DMGs.
- Deduplicate release assets with identical SHA-256 values.
- Preserve updates when Finder adds `.DS_Store` or labels.
- Reuse release response assets and compact API cache entries.
- Resume interrupted runs at later scheduled checks.

Earlier releases and their original notes remain available in [GitHub Releases](https://github.com/Ujap1994/Git-Cloner/releases).

New profiles follow the system language (German or English fallback) and close the application with the idle window by default. Existing language and tray preferences are preserved.
