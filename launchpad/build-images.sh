#!/usr/bin/env bash
# Builds the two rebranded images (web front end and account service) from this repository.
#
#   ./launchpad/build-images.sh
#   LAUNCHPAD_REGISTRY=ghcr.io/apptestify LAUNCHPAD_VERSION=1.0.0 ./launchpad/build-images.sh
#
# Needs Node.js 20+ and Docker, and about 8 GB of free memory for the web bundle.
set -euo pipefail

cd "$(dirname "$0")/.."

registry=${LAUNCHPAD_REGISTRY:-ghcr.io/apptestify}
version=${LAUNCHPAD_VERSION:-$(git rev-parse --short=12 HEAD)}
rush="node common/scripts/install-run-rush.js"
targets="--to @hcengineering/pod-front --to @hcengineering/pod-account"

# The web bundle does not fit in Node's default heap.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"
# Rush treats any stderr output as a warning and exits non-zero; silence the stale-data notice.
export BROWSERSLIST_IGNORE_OLD_DATA=1

# The build reads the platform and data-model version from the nearest git tag. Without one it
# falls back to 0.6.0, which the upstream services of this release refuse to work with. Create the
# tag locally (it is not pushed) when the checkout has none.
platform_version=$(tr -d '"\n ' < common/scripts/version.txt)
if ! git describe --tags --abbrev=0 >/dev/null 2>&1; then
  git tag "v$platform_version"
fi
if [ "$(git describe --tags --abbrev=0)" != "v$platform_version" ]; then
  echo "Nearest git tag $(git describe --tags --abbrev=0) does not match common/scripts/version.txt ($platform_version)" >&2
  exit 1
fi

$rush install
$rush bundle $targets
$rush package $targets

for name in front account; do
  image="$registry/launchpad-$name"
  docker build -t "$image:$version" -t "$image:latest" "pods/$name"
  echo "Built $image:$version"
done
