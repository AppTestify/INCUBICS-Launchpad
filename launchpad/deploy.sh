#!/usr/bin/env bash
# One-step deployment of LaunchPad-INCUBICS. Run on the server, as root:
#
#   curl -fsSL https://raw.githubusercontent.com/AppTestify/INCUBICS-Launchpad/claude/confident-planck-6wfn3n/launchpad/deploy.sh | bash
#
# What it does:
#   1. Installs Docker only if the server has none. An existing Docker is never upgraded or restarted.
#   2. Downloads the stack files into /opt/launchpad.
#   3. Runs install.sh, which starts LaunchPad in its own compose project ("launchpad") with its
#      own network, volumes and nginx. No other container or service is stopped or changed.
#
# Safe to run again: it updates the files and images and keeps existing data and secrets.
set -euo pipefail

BRANCH=${LAUNCHPAD_BRANCH:-claude/confident-planck-6wfn3n}
BASE="https://raw.githubusercontent.com/AppTestify/INCUBICS-Launchpad/$BRANCH/launchpad/server"
DIR=/opt/launchpad

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || die "Run this on the Linux server (after: ssh root@<server>), not on your own computer."
[ "$(id -u)" = 0 ] || die "Run as root."

if command -v docker >/dev/null 2>&1; then
  say "Docker is already installed ($(docker --version)); leaving it untouched."
  docker compose version >/dev/null 2>&1 || die "Docker is installed but the compose plugin is missing. Install the docker-compose-plugin package, then run this again."
else
  say "Docker not found: installing it."
  curl -fsSL https://get.docker.com | sh
fi

say "Downloading LaunchPad files to $DIR"
mkdir -p "$DIR/nginx"
for f in compose.yml compose.edge.yml install.sh nginx/routes.inc; do
  curl -fsSL "$BASE/$f" -o "$DIR/$f.new"
  mv "$DIR/$f.new" "$DIR/$f"
done
chmod +x "$DIR/install.sh"

cd "$DIR"
./install.sh
