#!/usr/bin/env bash
# Build all runtime benchmark images locally on the worker host.
# Run this once on first deploy and again whenever a Dockerfile changes.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Building jsperf-bench-node:latest..."
docker build -t jsperf-bench-node:latest -f images/Dockerfile.node images

echo "Building jsperf-bench-deno:latest..."
docker build -t jsperf-bench-deno:latest -f images/Dockerfile.deno images

echo "Building jsperf-bench-bun:latest..."
docker build -t jsperf-bench-bun:latest -f images/Dockerfile.bun images

echo
echo "Images:"
docker images | grep '^jsperf-bench-'
