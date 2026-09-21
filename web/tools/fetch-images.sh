#!/usr/bin/env bash
#
# Fetch the base disk images into web/images/.
#
# Why this exists at all: the page cannot fetch the images from where they live.
# v86's own host, i.copy.sh, answers 403 to any request carrying a referer from
# another origin, and GitHub release assets — the obvious fallback — send no
# CORS header at all, so a cross-origin fetch is blocked. Serving them from our
# own origin is the only thing that works, which means they have to be present
# in whatever we deploy.
#
# They are not in git: 27 MB of immutable binary would bloat every clone and
# every diff, forever. So local development and CI both call this script, and CI
# includes the result in the Pages artifact instead of committing it.
#
# Server-side there is no referer, so i.copy.sh serves them happily. Checksums
# are pinned: a truncated or swapped image would otherwise boot to a confusing
# failure rather than a clear one.
#
#   web/tools/fetch-images.sh
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dest="$here/../images"
mkdir -p "$dest"

# name sha256 url
manifest="
TinyCore-11.0.iso 778fc3788d9df3de72970827968b2b195aca827401db6f6f9cbdb737d4300bda https://i.copy.sh/TinyCore-11.0.iso
linux4.iso a8ea434ab3b177c55f01275dcc1d35f52cfbee9bd44a32e74765c975b58bcc73 https://i.copy.sh/linux4.iso
"

sha_of() { sha256sum "$1" | cut -d' ' -f1; }

status=0
while read -r name want url; do
  [ -n "${name:-}" ] || continue
  out="$dest/$name"

  if [ -f "$out" ] && [ "$(sha_of "$out")" = "$want" ]; then
    printf '  %-20s ok\n' "$name"
    continue
  fi

  printf '  %-20s fetching\n' "$name"
  tmp="$out.part"
  curl -fsSL --retry 3 -o "$tmp" "$url"

  got="$(sha_of "$tmp")"
  if [ "$got" != "$want" ]; then
    printf '  %-20s checksum mismatch: want %s, got %s\n' "$name" "$want" "$got" >&2
    rm -f "$tmp"
    status=1
    continue
  fi

  printf '  %-20s %s bytes\n' "$name" "$(wc -c < "$tmp" | tr -d ' ')"
  mv "$tmp" "$out"
done <<< "$manifest"

exit "$status"
