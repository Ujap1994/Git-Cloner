# Verification and release evidence

## Test layers

| Layer                | Command or workflow        | Scope                                                                                                                                                                              |
| -------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static checks        | `npm run lint`             | ESLint and Prettier for source, tests, workflows and documentation.                                                                                                                |
| Unit and integration | `npm test`                 | Real local Git repositories, manifests, encrypted archives, release repair, configuration migration, API/cache behavior, installation policies, rollback and failure recovery.     |
| Native Electron      | `npm run test:e2e`         | Sandboxed renderer, real UI persistence, English flows, German checks, layout and keyboard behavior, signed macOS DMG/ZIP installation containing ASAR archives.                   |
| Screenshots          | `npm run screenshots`      | Regenerates documentation images from isolated English test profiles. Normal tests do not write tracked screenshots.                                                               |
| Coverage measurement | `npm run test:coverage`    | Reports actual Node test coverage; a fully passing suite does not imply 100% coverage.                                                                                             |
| Published DMG        | `npm run test:release-dmg` | Downloads a pinned official Git Cloner 3.6.1 DMG, checks its expected SHA-256, installs into an isolated folder, validates signatures and skips a repeated unchanged installation. |
| Service integration  | CI private Forgejo job     | Real HTTPS service, private repositories, metadata and authenticated release transfers.                                                                                            |
| Packaging            | CI and Release             | Native package preparation, architecture-specific artifacts, checksums and publication verification.                                                                               |

The ASAR regression must run **inside Electron**, because ordinary Node does not virtualize ASAR paths. The test creates a signed fixture application with a real archive and unpacked companion file, installs it from both ZIP and DMG, compares the physical archive bytes and verifies the resulting signature.

The missing-release tests remove or truncate a previously verified file while keeping the Git revision and release unchanged. They verify repair before the next weekly check, local reuse of intact assets, successful subsequent installation and preservation of the previous backup on repair failure.

## CI platforms

[CI](https://github.com/Ujap1994/Git-Cloner/actions/workflows/ci.yml) runs Windows x64/ARM64, macOS Intel/ARM64, Linux, Node 22 compatibility and Fedora, Linux Mint, Arch and CachyOS containers. Platform-specific cases are explicitly skipped on incompatible hosts. Each native main job runs static checks, core tests, Electron tests and an application packaging check. The macOS ARM64 job also verifies the pinned published DMG.

Container-only Electron launchers may require `--no-sandbox` for the disposable test display. This does not change the normal application renderer settings: context isolation and sandbox stay enabled, with Node integration disabled.

## Release gate

[Release](https://github.com/Ujap1994/Git-Cloner/actions/workflows/release.yml) uses the exact successful main-branch CI commit. Required jobs build Windows x64/ARM64, all three macOS variants and Linux x64/ARM64 formats, including separate Snap and Flatpak jobs. The publisher creates a draft, uploads every generated artifact and verifies names, sizes and SHA-256 digests before making it public. Transient upload errors can be retried against the same draft.

The actual workflow run and release page are the evidence for a particular published version; a configured matrix alone is not a successful build. The [release page](https://github.com/Ujap1994/Git-Cloner/releases) includes packages, the checksum manifest and catalog templates derived from the actual files.

## Limits

Automated tests do not guarantee defect-free behavior or replace interactive installation/uninstallation and OS-notification checks on every physical device. Drive tests use temporary folders and controlled mount inventories; no USB hardware is driven. Wi-Fi identity and OS credential access depend on host permissions. Unknown states required by an enabled rule cause the application to wait.

macOS builds are ad-hoc signed and not notarized. Public package-store submission and publisher certificate provisioning are not performed by these workflows.

## Local release-candidate results

On November 11, 2026, the combined 3.7.0 candidate passed 302 unit/integration tests with 5 platform-specific skips and no failures on macOS ARM64. All 67 Electron E2E tests passed, including the DMG/ZIP ASAR regressions and the new settings/rollback screens. ESLint and Prettier checks passed. The complete E2E run also regenerated the English documentation screenshots through `npm run screenshots`. These counts describe that run; cross-platform results are recorded by GitHub Actions for the released commit.

The 15 affected startup, settings and update E2E cases also passed after the final Snap integration. The HTTP-interruption regression waits for the received prefix before closing its real test connection, avoiding a platform-dependent timer race without weakening byte-count assertions.
