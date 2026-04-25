# jsperf.net Multi-Runtime Benchmark Worker

A long-running HTTP service that benchmarks JavaScript snippets in **Node.js**, **Deno**, and **Bun** inside resource-isolated Docker containers and exposes both a streaming sync API and a polling-based async job API.

This is the optional multi-runtime layer of the Deep Analysis pipeline. The rest of the analysis (QuickJS-WASM, V8 sandbox, prediction model) runs unchanged whether or not this worker is reachable.

`jsperf.net` uses the **async job API** (`POST /api/jobs` + polling) so its serverless function returns inside Vercel's 60s ceiling regardless of how long the worker takes to finish. The streaming `/api/run` endpoint is kept for local development and ad-hoc curl-driven debugging.

## What it does

For every benchmark request:

1. Receives a code snippet, setup, teardown, time budget, runtime list, and resource profile list.
2. Spawns a fresh container per `(runtime, profile)` pair with strict CPU/memory/PID limits and no network access.
3. Wraps the runtime invocation with `perf stat` (when the host allows it and the selected image includes `perf`) to capture hardware counters: `instructions`, `cycles`, `cache-misses`, `branch-misses`, `page-faults`, `context-switches`.
4. Returns the result either by streaming NDJSON (`/api/run`) or by storing it in an in-memory job map for the caller to poll (`/api/jobs`).

## Endpoints

| Method | Path | Purpose | Used by |
| --- | --- | --- | --- |
| `GET`    | `/health`        | Image + perf availability + active job count | smoke tests, monitoring |
| `POST`   | `/api/run`       | Synchronous, NDJSON-streamed benchmark run | local dev, curl |
| `POST`   | `/api/jobs`      | Async; enqueue + return `{ jobId }` (HTTP 202) | `jsperf.net` |
| `GET`    | `/api/jobs/:id`  | Poll job status; returns `{ state, partial?, result?, error? }` | `jsperf.net` |
| `DELETE` | `/api/jobs/:id`  | Cancel a pending/running job | manual ops |

`state` ∈ `{ pending, running, done, errored }`. Completed jobs are evicted from memory after `JOB_RESULT_TTL_MS` (10 minutes). The per-job hard deadline defaults to `JOB_DEADLINE_MS` (30 seconds) and is configurable via the env var of the same name.

## Architecture

```
jsperf.net (Vercel)                                   Hostinger KVM 2 + Dokploy
─────────────────────                                 ──────────────────────────────

POST /api/benchmark/analyze ─┬─ POST  /api/jobs ──▶ jsperf-worker
                             │                          │
   QuickJS + V8 + prediction │   (returns 202           │  docker run --rm ...
   run synchronously here    │    immediately)          ▼
                             │                  ┌────────────────────┐
   returns multiRuntime jobIds                  │ jsperf-bench-node  │
                                                │ jsperf-bench-deno  │
browser polls ──▶ GET /api/benchmark/           │ jsperf-bench-bun   │
                  multi-runtime/:jobId          └────────────────────┘
                       │
                       └─ proxies ──▶ GET /api/jobs/:id
```

`/api/benchmark/analyze` enqueues the multi-runtime job **before** running QuickJS+V8 so the worker runs concurrently with the synchronous phases. By the time base analysis finishes (~30s), the worker is usually already done — the browser's first poll typically returns the result.

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

For ad-hoc streaming requests:

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

To compare runtime versions without rebuilding local images, pass versioned runtime targets:

```bash
curl -sN http://localhost:8080/api/run \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BENCHMARK_WORKER_SECRET" \
  -d '{
    "code": "Math.sqrt(Math.random() * 1000)",
    "timeMs": 1000,
    "runtimes": ["node@20", "node@22", "node@24", "deno@2.5.0", {"runtime":"bun","version":"1.3.0"}]
  }'
```

Unversioned `node`, `deno`, and `bun` keep using the local `jsperf-bench-*` images built by `./scripts/build-images.sh`. Versioned targets resolve to official images (`node:<version>-bookworm-slim`, `denoland/deno:debian-<version>`, `oven/bun:<version>-debian`) and Docker pulls them on first use. Because those official images do not include `linux-perf`, versioned runs skip hardware counters and still return throughput, latency, and memory metrics.

For ad-hoc async (matches what `jsperf.net` actually does):

```bash
job_id=$(curl -s http://localhost:8080/api/jobs \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BENCHMARK_WORKER_SECRET" \
  -d '{"code": "Math.sqrt(Math.random()*1000)", "timeMs": 1000}' \
  | jq -r .jobId)

# Poll until done
while :; do
  s=$(curl -s -H "Authorization: Bearer $BENCHMARK_WORKER_SECRET" \
       "http://localhost:8080/api/jobs/$job_id")
  state=$(echo "$s" | jq -r .state)
  echo "state=$state"
  [[ "$state" == "done" || "$state" == "errored" ]] && echo "$s" | jq && break
  sleep 1
done
```

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
| `JOB_DEADLINE_MS` | no | Hard ceiling for a single async job. Defaults to `30000` (30 s). Increase if you need wider profile sweeps. |
| `PORT` | no | Defaults to `8080`. |

### 4. Wire up jsperf.net on Vercel

In **Vercel → Project → Settings → Environment Variables** add:

| Variable | Value |
| --- | --- |
| `BENCHMARK_WORKER_URL` | `https://worker.your-domain.tld` |
| `BENCHMARK_WORKER_SECRET` | (the same token you set on the worker) |

Re-deploy. The Deep Analysis pipeline will now enqueue an async job on the worker for every analyze request and the browser will poll `/api/benchmark/multi-runtime/[jobId]` for the result. If the worker is offline, returns an error, or polling times out, the rest of the analysis still completes — the multi-runtime panel just shows a small "worker unreachable" notice and base results render normally.

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

`jsperf.net` only sends a **single** `1x` profile (1 cpu, 512 MB) per multi-runtime job by default — the cross-runtime comparison is the interesting signal here, and per-runtime scaling is already covered by the QuickJS and V8 phases. This keeps wall time per job to ~5 s.

| Label | CPUs | Memory |
| --- | --- | --- |
| `1x` | 1.0 | 512 MB |

Callers (or curl) can override `profiles` in the request body to run a wider sweep. Profiles run sequentially, never in parallel, to avoid noisy-neighbor measurement artifacts. A KVM 2 host (2 vCPU / 8 GB RAM) can comfortably run a 2.0-cpu / 2 GB profile in isolation.

## Security model

Each runtime container is isolated at four independent layers, so a hostile or runaway snippet cannot exfiltrate data, exhaust the host, or run past its budget.

**Network isolation** — `--network none` gives the container only a loopback interface. No DNS, no outbound TCP/UDP, no access to the host or sibling containers. User code physically cannot make a network call.

**Wall-clock ceilings** (defense in depth — any one of these alone would stop a runaway):

| Layer | Default | Behavior on expiry |
| --- | --- | --- |
| Script-level `TIME_LIMIT` | request `timeMs`, capped at 5 s | Loop exits cleanly, partial result emitted |
| Per-container `timeoutMs` | **30 s** (`PER_RUN_TIMEOUT_MS` in `server.js`) | `docker kill <name>` + SIGKILL on the docker child |
| Per-job `JOB_DEADLINE_MS` | **30 s** (env-configurable) | `AbortController` aborts; propagates through all queued container runs |
| Cgroup CPU + memory budget | per profile | OOM-kill on memory exhaustion; CPU throttled |

The script-level limit alone is not sufficient: code like `while(true){}` *inside* the benchmark function never returns control to the loop, so the elapsed-time check never fires. The per-container 30 s ceiling is the safety net for that case.

**Resource caps** — `--pids-limit 256` (fork-bomb proof), `--ulimit nofile=256:256` (no FD-leak DOS against the host), `--read-only` rootfs, size-bounded `/tmp` and `/work` tmpfs/bind mounts only.

**Privilege containment** — `--security-opt no-new-privileges` blocks setuid/setgid escalation. Containers run as their image's default user (non-root in the official `node`/`deno`/`bun` images).

**Operational** — no persistent storage; per-run tmpdir is deleted on completion. The worker requires a bearer token via `BENCHMARK_WORKER_SECRET`; without it the worker logs a warning and serves unauthenticated, suitable only for private dev. The Docker socket is mounted into the orchestrator container — this is a privileged operation; deploy this image only inside a trusted environment.

## Known limitations

- Versioned runtime targets use official runtime images and do not include `linux-perf`; they skip hardware counters unless you build your own perf-enabled image path.
- `perf stat` may return `<not supported>` for some events on virtualized hosts. Those counters render as `—` in the UI; the rest of the data is unaffected.
- Bun does not expose a `--expose-gc`-style flag; we use `Bun.gc(true)` from inside the script instead.
- Deno and Node both run on V8 but with different built-ins, async schedulers, and TLA semantics. Comparing them tells you about the runtime overhead, not the engine itself.
