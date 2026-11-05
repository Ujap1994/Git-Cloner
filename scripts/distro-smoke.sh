#!/usr/bin/env bash
set -euo pipefail
source /etc/os-release
if [[ -f /run/git-cloner-proxy-ca.pem ]]; then
  case "$ID" in
    fedora) install -m644 /run/git-cloner-proxy-ca.pem /etc/pki/ca-trust/source/anchors/git-cloner-session.pem; update-ca-trust;;
    arch|cachyos) install -m644 /run/git-cloner-proxy-ca.pem /etc/ca-certificates/trust-source/anchors/git-cloner-session.crt; update-ca-trust;;
    *) install -m644 /run/git-cloner-proxy-ca.pem /usr/local/share/ca-certificates/git-cloner-session.crt; update-ca-certificates;;
  esac
fi
case "$ID" in
  fedora)
    dnf install -y git git-lfs gtk3 nss libXScrnSaver alsa-lib libXtst mesa-libgbm libnotify at-spi2-core xorg-x11-server-Xvfb xorg-x11-xauth libstdc++ curl xz tar gzip findutils shadow-utils procps-ng
    ;;
  arch|cachyos)
    pacman -Syu --noconfirm
    pacman -S --noconfirm --needed git git-lfs gtk3 nss alsa-lib libxss libxtst mesa libnotify at-spi2-core xorg-server-xvfb xorg-xauth gcc-libs curl xz tar gzip shadow procps-ng
    ;;
  *)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y git git-lfs libgtk-3-0 libnss3 libxss1 libasound2t64 libxtst6 libgbm1 libnotify4 libatspi2.0-0 xvfb xauth libstdc++6 curl xz-utils tar gzip passwd procps
    ;;
esac
if [[ ! -x /opt/git-cloner-node/bin/node ]]; then
  node_version=24.22.1
  node_archive="node-v${node_version}-linux-x64.tar.xz"
  curl -fsSLo "/tmp/$node_archive" "https://nodejs.org/dist/v$node_version/$node_archive"
  curl -fsSLo /tmp/node-checksums.txt "https://nodejs.org/dist/v$node_version/SHASUMS256.txt"
  ( cd /tmp; grep " $node_archive\$" node-checksums.txt | sha256sum -c - )
  mkdir -p /opt/git-cloner-node
  tar -xJf "/tmp/$node_archive" -C /opt/git-cloner-node --strip-components=1
fi
smoke_directory="$(mktemp -d /tmp/git-cloner-distro.XXXXXX)"
tar -C /src --exclude=./.git --exclude=./node_modules --exclude=./dist --exclude=./playwright-report --exclude=./test-results --exclude='./.env*' -cf - . | tar -xf - -C "$smoke_directory"
if [[ -d /src/node_modules ]]; then ln -s /src/node_modules "$smoke_directory/node_modules"; fi
if ! id -u git-cloner-test >/dev/null 2>&1; then useradd --create-home --shell /bin/bash --uid 1000 --non-unique git-cloner-test; fi
chown -R git-cloner-test "$smoke_directory"
cat > /tmp/git-cloner-test-body.sh <<'BODY'
#!/usr/bin/env bash
set -euo pipefail
cd "$GIT_CLONER_SMOKE_DIRECTORY"
export PATH="/opt/git-cloner-node/bin:$PATH"
export NODE_USE_ENV_PROXY=1
if [[ ! -d node_modules ]]; then npm ci; fi
npm run check
Xvfb :99 -screen 0 1440x1080x24 -ac -nolisten tcp >/tmp/git-cloner-xvfb.log 2>&1 &
display_pid=$!
trap 'kill "$display_pid" 2>/dev/null || true' EXIT
export DISPLAY=:99
npx playwright test tests/e2e/app.spec.cjs tests/e2e/advanced.spec.cjs tests/e2e/workflows.spec.cjs tests/e2e/enhancements.spec.cjs tests/e2e/studio.spec.cjs tests/e2e/workspace.spec.cjs tests/e2e/release-programs.spec.cjs
BODY
chmod 755 /tmp/git-cloner-test-body.sh
set +e
runuser -u git-cloner-test -- env GIT_CLONER_SMOKE_DIRECTORY="$smoke_directory" bash /tmp/git-cloner-test-body.sh
result=$?
set -e
mkdir -p /evidence
for folder in playwright-report test-results; do if [[ -d "$smoke_directory/$folder" ]]; then cp -a "$smoke_directory/$folder" /evidence/; fi; done
cp /etc/os-release /evidence/os-release.txt
chmod -R a+rX /evidence
exit "$result"
