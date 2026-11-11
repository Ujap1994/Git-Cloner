#!/usr/bin/env bash
set -euo pipefail
# Run inside the installed package's actual confinement and environment.
snap run --shell git-cloner <<'SNAP_CHECK'
set -eu
git --version
git-lfs version
test -x "$GIT_EXEC_PATH/git-remote-https"
probe_directory="$(mktemp -d "$SNAP_USER_COMMON/verification.XXXXXX")"
trap 'rm -rf "$probe_directory"' EXIT
git init -b main "$probe_directory/source"
git -C "$probe_directory/source" -c user.name="Package test" -c user.email=tests@example.invalid commit --allow-empty -m "Package verification"
git clone --mirror "$probe_directory/source" "$probe_directory/mirror.git"
git --git-dir="$probe_directory/mirror.git" fsck --full
git -C "$probe_directory/source" ls-remote --exit-code https://github.com/Ujap1994/Git-Cloner.git HEAD
ldd "$SNAP/app/git-cloner" > "$probe_directory/libraries.txt"
cat "$probe_directory/libraries.txt"
if grep -q 'not found' "$probe_directory/libraries.txt"; then exit 1; fi
SNAP_CHECK
