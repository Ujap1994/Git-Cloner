# Run Git Cloner on macOS

## Installed application

Download the desired DMG from [GitHub Releases](https://github.com/Ujap1994/Git-Cloner/releases): ARM64 for Apple Silicon, x64 for Intel, or Universal for both. Verify `SHA256SUMS.txt`, open the image and copy Git Cloner to Applications. Git must be available on PATH; the Xcode command-line tools provide it. Install Git LFS separately if needed.

Packages use ad-hoc signing without notarization. Follow the normal macOS Privacy & Security flow only after checking the release source and checksum. Keep the installed app at its final path before configuring login startup or independent scheduling.

## Development checkout

```sh
git clone https://github.com/Ujap1994/Git-Cloner.git
cd Git-Cloner
npm ci
npm start
```

Use Node.js 22.12 or newer. `npm run test:e2e` uses separate temporary profiles; a normal `npm start` uses the normal application profile. Do not start a development app against live data merely to capture screenshots.

See the [complete guide](GUIDE.md) for sources, drive identities, schedules, release installation and recovery.
