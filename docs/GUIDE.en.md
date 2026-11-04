# Git Cloner 3 — anonymized guide

All account names, repository names and drive paths below are neutral placeholders. **The application starts with no configured sources.** Replace examples with your own details. Screenshots use isolated local test profiles without credentials.

## Install

Use the [official GitHub releases](https://github.com/Ujap1994/Git-Cloner/releases) and check `SHA256SUMS.txt`. Packaged applications do not require Node.js. Install Git and, if you enable LFS, Git LFS. Flatpak includes both.

- **macOS:** choose Universal, Apple Silicon ARM64 or Intel x64. Drag the app from the DMG to Applications. Install Git using `xcode-select --install` if needed.
- **Windows:** install Git for Windows with PATH integration, then choose the x64/ARM64 installer or Portable executable.
- **Ubuntu/Mint:** install Git and use `sudo apt install ./PACKAGE.deb`.
- **Fedora:** use `sudo dnf install git ./PACKAGE.rpm`.
- **Arch/CachyOS:** use `sudo pacman -U ./PACKAGE.pkg.tar.zst`.
- **AppImage:** install Git, make the file executable and run it. FUSE may be required; extraction with `--appimage-extract` is an alternative.
- **Flatpak:** install the bundle using `flatpak install --user ./PACKAGE.flatpak`, then run `flatpak run io.github.Ujap1994.GitCloner`. Flathub must be configured for the runtime. A bundle does not imply a published Flathub listing.

Packages do not have a verified publisher signature. macOS builds use a technical ad-hoc signature and are not notarized. macOS Privacy & Security or Windows SmartScreen may require approval after checking the source and checksum. Certificate setup, automatic update downloads and automatic installation are excluded.

Keep Portable/AppImage files at a permanent location before enabling login startup or OS scheduling. Reconfigure those options after moving the executable. Portable still stores settings in the regular user profile.

## Add your sources

Connect your external drive and create a writable folder, for example `/Volumes/BackupDisk/GitHub`, `E:\GitHub-Backups` or `/media/backup-disk/GitHub`. The app records a random identity in `.git-cloner-volume.json`; keep this file. Missing drives are never replaced with a newly created local folder.

Open **Sources → Add source**. Enter one account, organization or repository per line:

```text
example-account
another-account/tool
```

GitHub HTTPS URLs also work. An account source selects that account's own repositories visible to the chosen credentials. Pick an existing destination. Files are stored at `Destination/Owner/Repository`. An explicit repository rule takes priority over an overlapping account rule.

Expand the advanced section to select credentials, exclude forks or archived repositories, use include/exclude patterns (`*` and `?`), and add up to nine additional destinations. Each target is an independent backup. Exclusions take priority over includes.

Select **Check now** for the first run. The previous successful backup is replaced only after the new copy has passed verification. Failed or deleted remote sources do not automatically delete existing backups. Search, status filtering and pages of up to 75 rows keep large lists usable.

## Backup options

Under **Settings → Backup**, choose a shallow snapshot of the current default branch or a full bare mirror containing all branches, tags and Git history. Mirrors use incremental fetch. Enable actual LFS downloads if needed. Recursive submodules are supported for snapshots using HTTPS; they cannot be combined with mirror mode.

Optional metadata exports include issues/comments, pull requests/reviews/comments/file changes, releases/assets and a Wiki mirror. They are local exports, not an automatic GitHub reimport. Missing or inaccessible Wikis produce an explicit message; a later Wiki fetch failure preserves an existing backup that already contains its Wiki.

New backups have Git checks and SHA256 manifests. Existing backups are checked weekly by default; always/manual policies are available. A detected damaged managed backup is rebuilt during the next run only if a valid replacement can be obtained. Free-space checks include a reserve, but GitHub's size estimate may not cover large LFS and release assets.

There is **one successful version per repository and destination**, without historical folder rotation. During replacement, both the old and new version need space. A mirror's internal Git history belongs to that single backup. Do not develop inside managed backup folders.

## Encryption and restore

Set an archive password of at least twelve characters under **Settings → Backup**, optionally remember it in the secure OS vault, enable encryption and save. Backups then contain `backup.gcb` and a management marker. AES-256-GCM and scrypt protect archive contents; surrounding owner/repository paths and status markers remain visible.

**A lost password cannot be recovered.** Keep an independent copy. After changing it, backups not yet successfully replaced still need the old password. A session-only password must be re-entered after restart. An independent encrypted worker requires a saved password and an accessible secure OS vault.

Private plaintext temporary files exist on the internal drive during processing and are removed afterwards; removal is not forensic secure erasure. Regular encrypted checks validate the archive hash. Manual verification also decrypts and checks Git plus every file. Authentication finishes before extraction.

Open **Restore**, select a known backup or a `.gcb` file, choose an existing parent directory and a **new folder name**. Existing folders are never overwritten. The result is verified before becoming the final destination. No GitHub login is needed for local recovery. Restored mirrors remain bare; create a working copy using `git clone /PATH/TO/MIRROR /NEW/WORKING/FOLDER`.

## Schedule and drives

Choose 1–24 daily checks under **Schedule** and set a separate time for each. All times use the local system timezone. Background mode keeps the app running in the tray/menu bar. Login startup is available for installed applications.

Optional independent OS scheduling creates a user LaunchAgent on macOS, a Windows task or a systemd user timer on Linux. A windowless worker can then run with the GUI closed. App and worker share a process lock. Flatpak and development builds use the in-app scheduler instead.

The computer must be **powered on, awake and in the signed-in user context**. The app does not wake it. The in-app scheduler catches up the latest missed check of the current day once. Drive-reconnection checks poll configured paths approximately every 30 seconds while the app is running, including tray mode; they cannot start a fully closed app.

## Accounts and privacy

Public sources require no token. Under **Settings → Accounts**, create named credentials and select them per source. Personal Access Tokens need read access to repository contents; optional metadata needs the relevant issues/pull-request permissions. Organization approval or SSO may be required.

Device Flow is supported but requires the public client ID of a GitHub OAuth app with Device Flow enabled. This project does not supply a shared OAuth app. No client secret is required. PATs and public access remain available without registering an OAuth application.

Tokens and optionally the archive password use Electron `safeStorage`. The unsafe Linux `basic_text` fallback is rejected. Secrets are never returned with UI state, stored in Git remote URLs or included in settings exports. There is no telemetry or proprietary backup server.

Settings export/import excludes tokens and passwords, **but includes source names and paths**. Review before sharing. The diagnostic export removes names, paths, commit IDs and raw error messages. Never share `secrets.enc` or assume raw settings/state/history files are anonymous.

## Update notices and appearance

Startup and six-hourly checks compare the running app against the latest official stable GitHub release. A newer version shows a banner linking to its release page, with one system notification if enabled. **Skip this version** persists across restarts; the same or lower release stays hidden. Only a higher version triggers a new notice. Reset the skipped version under **Settings → General** if needed.

No update is downloaded or installed automatically. Download the appropriate official package and install it yourself after active backups have finished.

Under **Settings → Appearance**, choose English/German, system/light/dark and one of three text sizes. Controls retain matching heights and the choice persists.

![English application in dark mode](screenshots/dark-english.png)

## Version 3: setup, preview and queue

The empty overview offers **Start setup**: enter your own sources, choose an existing folder, then configure daily check times. No source is prefilled. **Dry run** shows matching/excluded repositories, planned paths and estimated space without creating backups or drive identities. API requests still count toward GitHub limits; LFS and release assets may exceed the size estimate.

During a run, **Pause after active repos** stops dispatching new work after already active repositories finish. **Resume** skips completed targets, including after restarting the application. **Discard queue** removes only the remaining run, preserving existing backups. Sources and backup content remain fixed while a queue waits; performance rules, appearance and future schedule times can be changed. A hard crash may repeat recent checks whose checkpoint had not yet been written.

## Performance and network rules

Under **Settings → Performance & rules**, configure 1–4 concurrent small tasks (default 2), the small-repository threshold (default 50 MiB), network retries (default 2), and a shared download limit in KiB/s (0 means unlimited). At most two small tasks run per detected volume. Mirrors, LFS, submodules, metadata and encryption run exclusively.

The download limit includes Git/LFS and release assets plus transport overhead. API JSON, uploads and other applications are excluded. A local opaque HTTPS tunnel preserves TLS verification and supports an inherited HTTP/HTTPS proxy. Unsupported proxy protocols fail explicitly. Transient network failures use bounded backoff; permission and disk failures are not retried automatically. Nested retries do not multiply the attempt budget.

Optional AC-only and exact Wi-Fi-name rules apply before the first repository lookup. Unknown required states keep the queue waiting. Rule pauses resume automatically while the app is running, approximately every 30 seconds; user pauses and interrupted runs require explicit Resume. Independent workers retry policy queues on later launches. macOS may hide SSIDs for privacy reasons; Linux uses NetworkManager's `nmcli`, which may be unavailable in Flatpak. Leave the optional Wi-Fi list empty to allow all networks. There is no universal cellular-plan detection.

## Source-specific backup options

Expand **Backup content for this source** in the source editor and enable its own options. Choose Git mode, LFS/submodules, metadata, integrity and encryption independently of the global defaults. The disk reserve is copied when enabling source options. All destinations belonging to that source use the same content rules. Disable the override to inherit global settings again.

## Selective recovery

Choose a backup/archive under **Restore**, enter its archive password if needed, then choose **Selected files or folders** and **Choose files**. Browse directories and mark individual entries or whole folders. Select a new output folder as usual. Relative paths are preserved and overlapping selections do not duplicate files. Mirrors show files from HEAD and resolve available LFS objects to real content; full bare-mirror recovery remains available.

Version 3 backups include a separate manifest hash. Browsing checks that manifest, and recovery verifies each selected file. Intact files can therefore be rescued even if unrelated files are damaged. Older backups without that manifest hash use the existing full verification first. Windows-incompatible names are rejected explicitly.

Encrypted archives must first be fully authenticated and extracted to private local temporary storage. Browsing expires five minutes after the last interaction. Closing the browser, leaving Restore or quitting normally removes plaintext; an active restore keeps its session alive until completion. Hard process termination may leave OS temporary files. Removal is not forensic secure erasure.

## Dashboard and accessibility

The overview adds elapsed time, approximate remaining time, measured downloads, tracked backup size, free space and a seven-local-day chart. It flags errors and backups not checked for over 48 hours. Older records may lack byte counts. Empty first-run profiles concentrate on setup.

**High contrast** is available under Appearance. Tabs support arrows/Home/End, a skip link leads to main content, and state changes have accessible announcements. This is not a claim of external accessibility certification.

| Shortcut | Action |
| --- | --- |
| Cmd/Ctrl + K | Open the overview and existing search field. |
| Cmd/Ctrl + N | Add a source when no queue is active/waiting. |
| Cmd/Ctrl + B | Start a check with configured sources. |
| Cmd/Ctrl + Shift + P | Request pause or resume. |
| Cmd/Ctrl + comma | Open settings. |
| F1 | Show shortcuts. |
| Escape | Close a dialog. |

## Troubleshooting

| Issue | Action |
| --- | --- |
| Git not found | Install Git, check PATH and restart. Finder-started macOS apps may have a different environment from the terminal. |
| Drive missing/identity mismatch | Connect the original drive or deliberately configure a new destination. |
| Existing foreign folder | Choose a new target or move your own data safely. The app will not overwrite it. |
| GitHub 401/403 | Check token validity, permissions, organization SSO and rate limits. |
| Missing LFS | Install Git LFS or disable the option. The previous successful backup stays intact. |
| Password error | Enter this archive's original password, including the old password after a recent change if applicable. |
| No automatic check | Confirm enabled sources, saved times, awake computer, running app or enabled native worker. |

For deeper setup, additional screenshots and OS details, see the [German guide](ANLEITUNG.md). [Architecture](ENTWICKLUNG.md), [distribution catalogs](PAKETVERZEICHNISSE.md) and [validation results](VALIDIERUNG.md) describe technical details and outstanding external publication/hardware steps.


## New in 3.1: schedules, releases and previews

**Per-source schedules:** open Sources → Edit source → Check times for this source. Enable custom times, choose 1–24 checks and enter each local time. “Manual only” disables scheduled runs for that source. Without an override, the general schedule applies. The global schedule pause also pauses custom source schedules. Each source has its own persisted checkpoint; manual checks still process all enabled sources. Native OS scheduling combines the enabled sources’ times.

**Release assets:** under Settings → Backup, enable releases with downloadable assets, then choose all operating systems or the automatically detected Windows, macOS or Linux. The filter includes all architectures of that OS. Unknown package names are excluded in OS mode; shared checksums and documentation remain included. Choose all systems when a required asset has an unrecognized name. The latest official stable release’s assets are kept in the single current backup; older release metadata can remain in JSON exports. Automatic GitHub source archives are not downloaded separately. Git data follows your snapshot/mirror choice.

Release downloads are checked against declared sizes and available GitHub SHA256 digests. A failed download keeps the previous successful backup. Use the overview’s “Restore release assets” action to select individual packages and copy them into a new folder. Encrypted backups and mirrors are supported. Programs are never installed or executed automatically.

![Release filter and automatic OS detection](screenshots/release-filter.png)

**Change preview:** choose “Review changes” on an existing backup. Search the added, modified and deleted files, then select a file to load a text diff. Text previews are limited to 256 KiB per version. Large files and submodules are listed; binary and LFS files have no text preview. A truncated GitHub tree can prevent a complete preview while regular backups remain available. The saved backup is unchanged and no project code runs. Backups wait while the dialog is open; closing or expiry releases the session. “Check all enabled sources” starts the regular run after closing.

![Real Git text changes before backup](screenshots/change-preview.png)

**Moved drives:** enable automatic path reassignment under Schedule or search connected drives from Sources. The saved folder marker and relative path identify known destinations. Only unique matches are applied; copied markers require manual selection. Current records and paused queues are updated without repeating completed work. No replacement directory is created at a missing old path. Folder markers are not physical hardware serial numbers.

**Notifications:** Settings → Notifications offers all completed checks, errors only, changes and errors, or no backup notices. Version notices have a separate setting. Daily quiet hours can span midnight. Backup notices are not queued; a pending version notice can appear after quiet hours while the app is active. In-app status remains available. Skipped versions stay hidden until a higher official version is released.

## New in 3.2: GitLab and Forgejo

In **Sources → Add source**, choose GitHub, GitLab or Forgejo and the matching HTTPS server. No repositories are preconfigured. GitLab supports subgroup paths: explicitly select **Account / organization / group** for `example-group/subgroup`; use **Individual repository** for `example-group/subgroup/project`. Group discovery includes subgroups and excludes externally shared projects. Forgejo accepts accounts/organizations and `owner/project`.

![Provider and server settings](screenshots/provider-source.png)

For private sources, add an account under **Settings → Accounts** with the same provider and exact server, then assign it to the source. Forgejo also needs your username. GitLab tokens need suitable API/repository read access; Forgejo scopes depend on selected data. Tokens require a secure OS key store. **Public · no token** never borrows the default GitHub token for another provider. Device sign-in remains specific to GitHub. Other providers receive a stable server-specific parent folder, preventing identical repository names on different hosts from colliding.

Snapshots, mirrors, LFS, HTTPS submodules, encryption and restoration apply to all three providers. GitLab metadata includes issues/notes, merge requests/notes/diffs, releases/assets and wiki. Forgejo includes issues/comments, pull requests/reviews/files, releases/assets and wiki. Server permissions and API truncation still apply. This is not an export of every CI, registry or administration resource. Forgejo 17.0.1 is tested with a real private HTTPS service; GitLab uses controlled API scenarios and real public API checks. Private SSO/proxy installations need their normal server permissions.

## Search and export history

Open **History**, search repositories, filter errors/changes and choose inclusive dates in local time. **Details** retains the repository search and pages through results. Select runs and export them anonymously; without a selection, export all matching saved runs. An individual export includes the complete retained run. Repository names become neutral IDs; private paths, credentials and raw errors are removed. Retention remains 100 completed runs and at most 500 detail results per run; truncation is displayed.

![History search](screenshots/history-search.png)

## Wait for space and troubleshoot

A full drive pauses the persistent queue, retaining successful backups and completed jobs. While the app runs, free space is checked about every 30 seconds without repeating Git/API requests. Once every blocked destination meets its saved requirement, the queue resumes. With the app closed, a configured native worker or a later app start performs the next check; sleeping computers are not woken. A deliberate user pause remains manual. No existing backups are deleted to create space.

![Waiting for space](screenshots/space-wait.png)

**Troubleshoot** in the overview, history details or an error toast provides targeted steps for credentials, network, API limits, drive identity, permissions, space, Git/LFS and archive passwords. It changes no system settings. A redacted diagnostic export can accompany an issue report.

![Contextual troubleshooting](screenshots/error-help.png)

## Change archive passwords

Under **Settings → Backup → Password change assistant**, select available encrypted backups. The inventory pages through 100 archives; up to 1000 can be changed per run. Enter an old password if needed, a new password of at least 12 characters and its confirmation. Known saved keys may make the old field unnecessary. The app authenticates an archive before adopting the new active password.

![Password change assistant](screenshots/password-rotation.png)

Remembering passwords is optional and retains older required keys in the secure OS key store. Without remembering, old/new passwords must be re-entered after restart; the management file stores identifiers only. Each archive is decrypted privately, verified, re-encrypted and then exchanged. A persisted transaction can complete or recover an interrupted swap. Missing/unselected drives keep their previous passwords. **Stop after current archive** finishes the active archive and stops between items. External GCB copies outside the managed selection are unchanged.

The process requires space for old/new ciphertext and authenticated/extracted temporary data. Regular cleanup removes temporary plaintext; a hard termination can leave OS temporary files. Lost passwords cannot be recovered, and deletion is not forensic erasure. The ordinary unlock action authenticates an available archive rather than silently changing its password; use the assistant for a change.

## Recommend LFS and submodule options

Use **Recommend content** for a saved source. For an account/group, enter one repository belonging to it. The app reads Git trees and small attribute files without cloning or executing project code. It reports LFS rules, submodule links and local Git LFS availability. Incomplete inspections cannot establish absence. Review the checkboxes, then explicitly **Apply selection to this source**. Global options stay unchanged. Group choices affect all repositories in that source; submodules require snapshot mode. Closing without applying changes nothing.

![Content recommendations](screenshots/content-recommendations.png)
