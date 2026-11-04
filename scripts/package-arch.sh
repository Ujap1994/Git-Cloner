#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version="$(node -p 'require("./package.json").version')"
arch="${1:-x86_64}"
case "$arch" in x86_64) electron_arch=x64;; aarch64) electron_arch=arm64;; *) exit 1;; esac
source_archive="dist/Git-Cloner-${version}-linux-${electron_arch}.tar.gz"
test -f "$source_archive"
stage_dir="$(mktemp -d)"
trap 'rm -rf "$stage_dir"' EXIT
mkdir -p "$stage_dir/opt/git-cloner" "$stage_dir/usr/bin" "$stage_dir/usr/share/applications" "$stage_dir/usr/share/icons/hicolor/512x512/apps" "$stage_dir/usr/share/licenses/git-cloner"
tar -xzf "$source_archive" -C "$stage_dir/opt/git-cloner" --no-same-owner --strip-components=1
test -x "$stage_dir/opt/git-cloner/git-cloner"
ln -s /opt/git-cloner/git-cloner "$stage_dir/usr/bin/git-cloner"
cp build/io.github.Ujap1994.GitCloner.desktop "$stage_dir/usr/share/applications/"
cp build/icon.png "$stage_dir/usr/share/icons/hicolor/512x512/apps/io.github.Ujap1994.GitCloner.png"
cp LICENSE "$stage_dir/usr/share/licenses/git-cloner/"
find "$stage_dir" -type d -exec chmod 0755 {} +
find "$stage_dir" -type f ! -perm /111 -exec chmod 0644 {} +
find "$stage_dir" -type f -perm /111 -exec chmod 0755 {} +
installed_size="$(du -sb "$stage_dir" | cut -f1)"
cat > "$stage_dir/.PKGINFO" <<EOF
pkgname = git-cloner
pkgbase = git-cloner
pkgver = ${version}-1
pkgdesc = Geplante GitHub-Sicherungen auf deinem Laufwerk
url = https://github.com/Ujap1994/Git-Cloner
builddate = $(date +%s)
packager = Ujap1994
size = ${installed_size}
arch = ${arch}
license = MIT
depend = git
depend = gtk3
depend = nss
depend = alsa-lib
depend = libxss
depend = libnotify
depend = libxtst
depend = xdg-utils
depend = at-spi2-core
depend = libdrm
depend = mesa
EOF
tar --zstd --owner=0 --group=0 -cf "dist/git-cloner-${version}-1-${arch}.pkg.tar.zst" -C "$stage_dir" .PKGINFO opt usr
