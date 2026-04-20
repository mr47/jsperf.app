# jsperf.app Multi-Runtime Benchmark Worker

A long-running HTTP service that benchmarks JavaScript snippets in **Node.js**, **Deno**, and **Bun** inside resource-isolated Docker containers, then streams results back to `jsperf.app` as NDJSON.

This is the optional Phase 4 of the Deep Analysis pipeline. The rest of the analysis (QuickJS-WASM, V8 sandbox, prediction model) runs unchanged whether or not this worker is reachable.

## What it does

For every benchmark request:

1. Receives a code snippet, setup, teardown, time budget, runtime list, and resource profile list.
2. Spawns a fresh container per `(runtime, profile)` pair with strict CPU/memory/PID limits and no network access.
3. Wraps the runtime invocation with `perf stat` (when the host allows it) to capture hardware counters: `instructions`, `cycles`, `cache-misses`, `branch-misses`, `page-faults`, `context-switches`.
4. Streams a JSON line per finished run via NDJSON (`type: "result"`), interleaved with `type: "progress"` events.

## Architecture

```
jsperf.app (Vercel)               Hostinger KVM 2 + Dokploy
─────────────────────             ──────────────────────────────
runner.js (Phase 4) ──HTTP──▶ jsperf-worker (this service)
                                         │
                                         │  docker run --rm ...
                                         ▼
                              ┌────────────────────┐
                              │ jsperf-bench-node  │
                              │ jsperf-bench-deno  │
                              │ jsperf-bench-bun   │
                              └────────────────────┘
```

The worker is a thin orchestrator. It does not persist any state; benchmark scripts are written to a per-run tmpdir, mounted read-write into one container, then deleted. Cold-start cost per run is dominated by container creation (~150–400ms on a KVM 2 box).

## Project layout

```
worker/
├── server.js              # Hono HTTP entrypoint (POST /api/run, GET /health)
├── docker.js              # Container lifecycle: spawn, wait, parse stdout + perf
├── runtimes/
│   ├── common.js          # Shared benchmark loop (matches v8sandbox.js shape)
│   ├── node.js            # Builds a Node.js benchmark script
│   ├── deno.js            # Builds a Deno benchmark script
│   └── bun.js             # Builds a Bun benchmark script
├── images/
│   ├── Dockerfile.node    # node:24-bookworm-slim + linux-perf
│   ├── Dockerfile.deno    # denoland/deno:debian-2.5.0 + linux-perf
│   └── Dockerfile.bun     # oven/bun:1.3-debian + linux-perf
├── scripts/
│   └── build-images.sh    # Build all three runtime images
├── Dockerfile             # The orchestrator image (deployed via Dokploy)
├── .dockerignore
└── package.json
```

## Local development

Requires Docker + Node 20+.

```bash
cd worker
cp .env.example .env  # then edit BENCHMARK_WORKER_SECRET
npm install
./scripts/build-images.sh
BENCHMARK_WORKER_SECRET=$(grep ^BENCHMARK_WORKER_SECRET .env | cut -d= -f2) node server.js
```

In a second terminal, run the smoke test:

```bash
./scripts/smoke-test.sh http://localhost:8080 "$BENCHMARK_WORKER_SECRET"
```

It hits `/health`, posts a tiny benchmark to `/api/run`, and asserts that all three runtimes returned a result line. Exit code is non-zero on any failure, so it's CI-friendly.

For ad-hoc requests:

```bash
curl -sN http://localhost:8080/api/run \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BENCHMARK_WORKER_SECRET" \
  -d '{
    "code": "Math.sqrt(Math.random() * 1000)",
    "timeMs": 1000,
    "runtimes": ["node", "deno", "bun"]
  }'
```

You should see one `{ "type": "progress", ... }` and one `{ "type": "result", ... }` line per `(runtime, profile)` pair, then a final `{ "type": "done" }`.

## Deploy on Hostinger via Dokploy

### 1. SSH to the host and build the runtime images

The runtime images are built **on the host**, not by Dokploy. Dokploy only deploys the orchestrator service.

```bash
ssh root@<your-host>
cd /opt
git clone https://github.com/<your-user>/jsperf.app.git
cd jsperf.app/worker
./scripts/build-images.sh
docker images | grep jsperf-bench-
```

### 2. Add a Compose service in Dokploy

A ready-to-use `worker/docker-compose.yml` ships in this repo. In Dokploy:

1. Create a new **Compose** application.
2. Source: this git repo, branch `main` (or whatever you deploy from).
3. **Compose Path**: `worker/docker-compose.yml`.
4. Configure Dokploy's Traefik integration to route `https://worker.your-domain.tld` → container port 8080.

The compose file already declares the Docker socket bind-mount, the `SYS_PTRACE` + `PERFMON` capabilities, and a `/health` healthcheck.

### 3. Set environment variables

In **Dokploy → Environment**:

| Variable | Required | Description |
| --- | --- | --- |
| `BENCHMARK_WORKER_SECRET` | yes | Shared bearer token. Use `openssl rand -hex 32`. |
| `COLLECT_PERF` | no | `1` (default) to wrap runtime invocations with `perf stat`. Set to `0` if your kernel rejects it. |
| `PORT` | no | Defaults to `8080`. |

### 4. Wire up jsperf.app on Vercel

In **Vercel → Project → Settings → Environment Variables** add:

| Variable | Value |
| --- | --- |
| `BENCHMARK_WORKER_URL` | `https://worker.your-domain.tld` |
| `BENCHMARK_WORKER_SECRET` | (the same token you set on the worker) |

Re-deploy. The Deep Analysis pipeline will now invoke the worker as Phase 4. If the worker is offline or returns an error the rest of the analysis still completes — the multi-runtime panel just shows a small "worker unreachable" notice.

## Health check

`GET /health` returns:

```json
{ "status": "ok", "images": { "node": true, "deno": true, "bun": true }, "perf": true }
```

If any image is `false`, run `./scripts/build-images.sh` again on the host.

You can also run the full smoke test against a live deploy:

```bash
./scripts/smoke-test.sh https://worker.your-domain.tld "$BENCHMARK_WORKER_SECRET"
```

## Resource profiles

The worker runs each runtime against four profiles, mirroring the existing 1x/2x/4x/8x scale used by QuickJS and the V8 sandbox so analysis reports line up:

| Label | CPUs | Memory |
| --- | --- | --- |
| `1x` | 0.5 | 256 MB |
| `2x` | 1.0 | 512 MB |
| `4x` | 1.5 | 1024 MB |
| `8x` | 2.0 | 2048 MB |

A KVM 2 host (2 vCPU / 8 GB RAM) can comfortably run the largest profile in isolation. Profiles run sequentially, never in parallel, to avoid noisy-neighbor measurement artifacts.

## Security model

- Each container runs with `--network none`, `--read-only`, `--pids-limit 256`, `--security-opt no-new-privileges`, and a strict CPU + memory budget.
- No persistent storage; the per-run tmpdir is deleted on completion.
- The worker requires a bearer token. Without `BENCHMARK_WORKER_SECRET` set, it logs a warning and serves unauthenticated — only suitable for purely-private development.
- The Docker socket is mounted into the orchestrator container. This is a privileged operation; only deploy this image inside a trusted environment.

## Known limitations

- `perf stat` may return `<not supported>` for some events on virtualized hosts. Those counters render as `—` in the UI; the rest of the data is unaffected.
- Bun does not expose a `--expose-gc`-style flag; we use `Bun.gc(true)` from inside the script instead.
- Deno and Node both run on V8 but with different built-ins, async schedulers, and TLA semantics. Comparing them tells you about the runtime overhead, not the engine itself.
