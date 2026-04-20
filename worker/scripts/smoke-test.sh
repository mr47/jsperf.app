#!/usr/bin/env bash
# End-to-end smoke test for a deployed jsperf-worker.
#
# Usage:
#   ./scripts/smoke-test.sh [WORKER_URL] [BEARER_TOKEN]
#
# Defaults to http://localhost:8080 and reads BENCHMARK_WORKER_SECRET from
# the environment if no token is passed. Exits non-zero on any failure
# so it can be used in CI.
set -euo pipefail

WORKER_URL="${1:-${BENCHMARK_WORKER_URL:-http://localhost:8080}}"
TOKEN="${2:-${BENCHMARK_WORKER_SECRET:-}}"

WORKER_URL="${WORKER_URL%/}"

auth_header=()
if [ -n "$TOKEN" ]; then
  auth_header=(-H "Authorization: Bearer $TOKEN")
fi

echo "[1/4] Hitting $WORKER_URL/health"
health=$(curl -sf "$WORKER_URL/health")
echo "$health" | sed 's/^/      /'

# All three runtime images must be present, otherwise runs will silently
# error per-runtime instead of failing fast.
for runtime in node deno bun; do
  if ! echo "$health" | grep -q "\"$runtime\":true"; then
    echo "ERROR: image for '$runtime' is missing on the worker host." >&2
    echo "       Run: ./scripts/build-images.sh" >&2
    exit 1
  fi
done

echo "[2/4] POST /api/run with a trivial benchmark (single profile)"
payload='{
  "code": "Math.sqrt(Math.random() * 1000)",
  "timeMs": 500,
  "runtimes": ["node", "deno", "bun"],
  "profiles": [{"label":"1x","resourceLevel":1,"cpus":0.5,"memMb":256}]
}'

# Stream the NDJSON response and capture it for inspection.
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

curl -sN -X POST "$WORKER_URL/api/run" \
  -H 'Content-Type: application/json' \
  "${auth_header[@]}" \
  -d "$payload" \
  | tee "$tmp" \
  | sed 's/^/      /' >&2

echo
echo "[3/4] Verifying /api/run response"

# Must contain a result line for each runtime.
for runtime in node deno bun; do
  if ! grep -q "\"runtime\":\"$runtime\"" "$tmp"; then
    echo "ERROR: no result line for '$runtime' in worker response." >&2
    exit 1
  fi
done

# Must end with a {"type":"done"} line.
if ! tail -n 5 "$tmp" | grep -q '"type":"done"'; then
  echo "ERROR: response did not finish with a 'done' line — worker likely errored mid-stream." >&2
  exit 1
fi

# At least one runtime must have produced ops/sec > 0.
if ! grep -qE '"opsPerSec":[1-9][0-9]*' "$tmp"; then
  echo "ERROR: every runtime returned opsPerSec=0. Check container logs." >&2
  exit 1
fi

echo "[4/4] POST /api/jobs (async) and poll until done"
job_resp=$(curl -sf -X POST "$WORKER_URL/api/jobs" \
  -H 'Content-Type: application/json' \
  "${auth_header[@]}" \
  -d "$payload")
echo "$job_resp" | sed 's/^/      /'

job_id=$(echo "$job_resp" | sed -n 's/.*"jobId":"\([^"]*\)".*/\1/p')
if [ -z "$job_id" ]; then
  echo "ERROR: /api/jobs did not return a jobId." >&2
  exit 1
fi

# Poll up to 60s. Worker default deadline is 30s + headroom for startup.
for i in $(seq 1 40); do
  sleep 1.5
  status=$(curl -sf "$WORKER_URL/api/jobs/$job_id" "${auth_header[@]}")
  state=$(echo "$status" | sed -n 's/.*"state":"\([^"]*\)".*/\1/p')
  printf '      poll #%-2d  state=%s\n' "$i" "$state"
  case "$state" in
    done) break ;;
    errored)
      echo "ERROR: async job errored — $status" >&2
      exit 1
      ;;
  esac
done

if [ "$state" != "done" ]; then
  echo "ERROR: async job did not complete within polling window." >&2
  exit 1
fi

if ! echo "$status" | grep -q '"runtimes"'; then
  echo "ERROR: completed job is missing runtimes payload." >&2
  exit 1
fi

echo "OK — worker is healthy, sync and async paths both return results."
