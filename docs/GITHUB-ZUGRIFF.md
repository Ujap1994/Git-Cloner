# GitHub access and publishing

The canonical repository is [Ujap1994/Git-Cloner](https://github.com/Ujap1994/Git-Cloner). Development commits, CI runs and releases are visible there. Preserve unrelated local work and inspect the current remote branch before pushing.

The application needs only read access for private repositories and enabled metadata. Users can choose separate credentials for individual sources. GitHub account permissions and organization SSO approval still apply. Public repositories work without credentials, subject to lower API quotas.

Maintainer publishing needs repository and workflow permissions. CI has read-only contents permission by default; only the release publishing job receives contents write access. Publish the exact verified commit, retain artifact checksums and inspect the actual workflow result. Never place tokens in source files, screenshots, command output or settings exports.

See [Verification](VALIDIERUNG.md) for the CI/release gate and [the guide](GUIDE.md#7-several-accounts-and-sign-in) for user credentials.
