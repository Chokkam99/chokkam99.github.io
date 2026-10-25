#!/bin/sh
# Run before every push: the commits must use the GitHub noreply address. Then shows what would go out.
set -eu
cd "$(dirname "$0")/.."
noreply="28307727+Chokkam99@users.noreply.github.com"
if [ "$(git config user.email || true)" != "$noreply" ]; then
  echo "Stop: git user.email is not the GitHub noreply address." >&2
  exit 1
fi
range=HEAD
git rev-parse -q --verify '@{u}' >/dev/null && range='@{u}..HEAD'
if git log --format='%ae%n%ce' "$range" | grep -vqx "$noreply"; then
  echo "Stop: a commit to be pushed has an author or committer other than the noreply address." >&2
  exit 1
fi
git log --stat "$range"
