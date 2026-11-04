#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
flatpak install --user --noninteractive dist/*.flatpak
application=io.github.Ujap1994.GitCloner
flatpak run --command=git "$application" --version
flatpak run --command=git-lfs "$application" version
flatpak run --command=sh "$application" -ec '
  check_directory="$(mktemp -d)"
  trap '\''rm -rf "$check_directory"'\'' EXIT
  git init -b main "$check_directory/source"
  git -C "$check_directory/source" -c user.name="Package test" -c user.email=tests@example.invalid commit --allow-empty -m "Package verification"
  git clone --mirror "$check_directory/source" "$check_directory/mirror.git"
  git --git-dir="$check_directory/mirror.git" fsck --full
  test -x "$(git --exec-path)/git-remote-https"
  git -C "$check_directory" ls-remote --exit-code https://github.com/Ujap1994/Git-Cloner.git HEAD
'
