<p align="center"><img src="build/icon.svg" width="80" alt="Git Cloner branch icon"></p>
<h1 align="center">Git Cloner 3.7</h1>
<p align="center">Your repositories. Your drive. Your schedule.</p>
<p align="center"><a href="https://github.com/Ujap1994/Git-Cloner/actions/workflows/ci.yml"><img src="https://github.com/Ujap1994/Git-Cloner/actions/workflows/ci.yml/badge.svg" alt="CI"></a> · <a href="https://github.com/Ujap1994/Git-Cloner/releases">Downloads</a> · <a href="docs/GUIDE.md">Complete user guide</a> · <a href="docs/RELEASE-NOTES.md">Release notes</a></p>

Git Cloner is a Node.js and Electron desktop application for macOS, Windows and Linux. Back up GitHub accounts, GitLab groups, Forgejo accounts or individual repositories to your own drives, and optionally install programs from their verified release files. **A new profile has no preset sources or credentials.** The interface supports German and English, light and dark themes, large text and high contrast.

![Empty overview in the English interface](docs/screenshots/overview.png)

## New in 3.7.0

| Feature                                | Behavior                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program update policy                  | Install automatically after a running program quits, wait until the next check, or notify and require **Install now**.                                                                          |
| Previous program version               | Retain the most recently replaced managed installation and restore it from the overview. The reverted release stays held until a newer release appears or installation is explicitly requested. |
| DMG variant selection                  | Choose compatible variants, Universal, Apple Silicon ARM64 or Intel x64 globally or per repository.                                                                                             |
| Reliable Electron program installation | Copy `app.asar` as an unchanged physical file, including its unpacked companions. Signature and architecture verification remain enabled.                                                       |
| Missing release repair                 | Detect missing or truncated files even when the Git commit and release are unchanged, then repair through a verified staged replacement.                                                        |
| Pause reminders                        | Do nothing, remind once, or automatically resume after the configured duration of a user-selected pause.                                                                                        |
| API quota                              | Show remaining quota and reset times per account and defer a repository before its request budget is exhausted.                                                                                 |
| Lightweight version checks             | Discover Git Cloner's newest official release without spending a GitHub API request.                                                                                                            |
| Bandwidth window                       | Apply a separate shared download limit during a daily time window, including windows across midnight.                                                                                           |
| Clear notifications                    | Name installed or waiting programs and their versions, while respecting notification rules and quiet hours.                                                                                     |
| Maintainer checks                      | Prettier formatting, API/cache performance regression tests, English GUI tests, German checks and explicit screenshot generation.                                                               |

![Program update policy](docs/screenshots/program-updates.png)
![DMG variant selection](docs/screenshots/dmg-variants.png)

See the [complete illustrated guide](docs/GUIDE.md) for every setting and the [release repair explanation](docs/RELEASE-REPAIR.md) for the installation fixes.

## Backup and restore

- Shallow snapshots of the default branch or full Git mirrors with all refs; optional Git LFS payloads and recursive HTTPS submodules for snapshots.
- Optional issues, pull/merge requests, releases with downloadable assets and wiki mirrors. Provider-specific limitations are documented in the guide.
- Per-source filters, credentials, backup content, schedules and up to ten destinations. Individual repository rules override matching account rules.
- Managed drive identities, free-space reserves, file manifests and Git verification. A replacement becomes active only after verification succeeds.
- AES-256-GCM archives with scrypt, optional secure OS password storage, password rotation and full or selective recovery to a new destination.
- One successful backup per repository and destination; Git mirror history is retained, but separate historical backup generations are not implemented.
- Configurable check times, pause/resume across restarts, optional drive reconnection checks, resource rules and independent OS scheduling in native installed packages.
- Searchable history, groups, favorites, repository selection, bulk-edit previews, measured download history and cleanup of owned temporary downloads.

## Install

Download from [GitHub Releases](https://github.com/Ujap1994/Git-Cloner/releases) and verify the selected file against `SHA256SUMS.txt`.

| System  | Architectures                             | Release formats                                           |
| ------- | ----------------------------------------- | --------------------------------------------------------- |
| Windows | x64, ARM64                                | NSIS installer, portable EXE                              |
| macOS   | Intel x64, Apple Silicon ARM64, Universal | DMG and ZIP                                               |
| Linux   | x64, ARM64                                | AppImage, DEB, RPM, Pacman/Arch, TAR.GZ, Snap and Flatpak |

The release workflow builds these targets on the corresponding runners. Publication waits for all required package jobs and verifies the uploaded asset names, sizes and SHA-256 digests. The [Release workflow](https://github.com/Ujap1994/Git-Cloner/actions/workflows/release.yml) shows the actual result for each version.

On macOS, open the DMG and drag Git Cloner into Applications. Install Git, for example through the Xcode command-line tools. On Windows, install Git for Windows with PATH integration. Native Linux packages declare Git as a dependency; portable packages need Git on PATH. Install Git LFS when enabling LFS. Flatpak and Snap bundle Git and Git LFS. See [installation instructions](docs/GUIDE.md#1-installation) for sandboxed-package permissions and commands.

Git Cloner's packages have no verified publisher certificate; macOS packages are ad-hoc signed and are not notarized. The app's own version checker provides a notice and download link; it does not automatically replace Git Cloner. Automatic installation of programs from explicitly configured source repositories is a separate feature.

## Quick start

1. Choose an existing backup folder on your drive.
2. Under **Sources**, enter an account or `owner/repository`, or use **Repositories → Select**. Public sources work without a token; private sources require a read credential.
3. Select **Check now**, review the resulting backup, and configure the schedule.
4. For program installation, edit an individual repository, enable release downloads and automatic program installation, then choose a program destination separate from all backup folders.
5. Choose a DMG variant in that source's backup options when needed. Source-specific options take precedence over global defaults.
6. Use **Restore** to create a verified working copy in a new folder. Do not develop inside a managed backup.

## Development and verification

Requires Node.js 22.12 or newer (Node 24 is used for release builds), Git and npm.

```sh
npm ci
npm start
npm run check
npm run test:e2e
npm run screenshots
npm run build:dir
```

`npm run lint` checks ESLint and Prettier. Normal tests leave tracked documentation screenshots unchanged; `npm run screenshots` regenerates them using isolated English test profiles. `npm run test:coverage` measures code coverage; passing the complete suite is not a claim of 100% code coverage or absence of defects.

CI covers Windows x64/ARM64, macOS Intel/ARM64, Linux, Node 22 compatibility, private Forgejo over HTTPS and Fedora/Mint/Arch/CachyOS containers. macOS tests exercise real signed DMGs and ZIPs inside Electron, including ASAR archives. [Verification details](docs/VALIDIERUNG.md) explain the test layers and their limits.

## Documentation

- [Complete user guide](docs/GUIDE.md)
- [Changelog](CHANGELOG.md) and [release notes](docs/RELEASE-NOTES.md)
- [Architecture and development](docs/ENTWICKLUNG.md)
- [Verification and CI](docs/VALIDIERUNG.md)
- [Package catalog templates](docs/PAKETVERZEICHNISSE.md)
- [Proposed future features](docs/ROADMAP.md)

The documentation, changelog and release notes are maintained in English. The app remains bilingual. This project is provided under the [MIT license](LICENSE), without a warranty. Keep independent backups and test recovery with non-critical data before relying on a backup workflow.
