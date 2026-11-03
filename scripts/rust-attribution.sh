#!/usr/bin/env bash
# Regenerates src-tauri/THIRD-PARTY-LICENSES-RUST.md with the one cargo-about version every caller shares,
# so the CI gate, the Dependabot regeneration and a local run produce the same bytes. --check diffs instead.
set -euo pipefail
cd "$(dirname "$0")/../src-tauri"

VERSION=0.9.1
if command -v cargo-about > /dev/null && [ "$(cargo-about --version)" = "cargo-about $VERSION" ]; then
  about=cargo-about
else
  curl -fsSL "https://github.com/EmbarkStudios/cargo-about/releases/download/$VERSION/cargo-about-$VERSION-x86_64-unknown-linux-musl.tar.gz" \
    | tar xz --strip-components=1 -C /tmp
  about=/tmp/cargo-about
fi

cargo fetch --locked
"$about" generate about.hbs -o THIRD-PARTY-LICENSES-RUST.md
if [ "${1:-}" = "--check" ]; then
  git diff --exit-code -- THIRD-PARTY-LICENSES-RUST.md
fi
