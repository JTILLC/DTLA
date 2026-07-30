#!/bin/bash
# Sets the ANTHROPIC_API_KEY secret on the ccw-media Worker (POST /scan-weights).
#
# Run this in a REAL terminal (Terminal.app / iTerm), not from Claude Code's `!`
# prompt. `wrangler secret put` reads the value from a hidden prompt; with no
# interactive terminal attached it reads EOF, stores an EMPTY string, and still
# prints "Success! Uploaded secret". That failure is completely silent — which is
# exactly what happened twice — so this script refuses to run without a TTY.
set -e
cd "$(dirname "$0")/CCWISSUESGitHub/media-worker"

if [ ! -t 0 ]; then
  echo "ERROR: no interactive terminal on stdin." >&2
  echo "wrangler would store an EMPTY secret and claim success." >&2
  echo "Open Terminal.app and run:  bash $0" >&2
  exit 1
fi

npx wrangler secret put ANTHROPIC_API_KEY

# Confirm the Worker can actually see it. The cache-busting query matters —
# /health is cached at the edge and will happily serve a stale answer.
echo
echo "Verifying (allow a few seconds for the new version to roll out)…"
for i in $(seq 1 10); do
  h=$(curl -s "https://ccw-media.josh-c80.workers.dev/health?x=$RANDOM$i")
  case "$h" in
    *'"scanWeights":true'*) echo "OK — screen scanning is live."; exit 0 ;;
  esac
  sleep 5
done
echo "Still not visible to the Worker: $h" >&2
echo "The stored value is probably empty — re-run and check the paste landed." >&2
exit 1
