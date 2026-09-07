# jsperf.net Deep Analysis Worker

A long-running HTTP service that benchmarks JavaScript snippets in **Node.js**, **Deno**, and **Bun** inside resource-isolated Docker containers, estimates static complexity, and can run **QuickJS-WASM** profiles for donor worker-side Deep Analysis.

This is the optional worker layer of the Deep Analysis pipeline. By default it provides Node/Deno/Bun runtime jobs and complexity estimates. Donors use a default-on priority worker lane: the app asks this service for QuickJS profiles before continuing with V8 Sandbox and final persistence on Vercel.

`jsperf.net` uses the **async job API** (`POST /api/jobs` + `GET /api/jobs/:id`) so its serverless functions return inside Vercel's 60s ceiling regardless of how long the worker takes to finish. The browser subscribes to a Vercel-side SSE proxy, `/api/benchmark/multi-runtime/events`, which performs the worker status checks server-side and pushes realtime updates to the UI. The streaming `/api/run` endpoint is kept for local development and ad-hoc curl-driven debugging.

## What it does

For every benchmark request:

1. Receives a code snippet, setup, teardown, time budget, runtime list, and resource profile list.
2. Spawns a fresh container per `(runtime, profile)` pair with strict CPU/memory/PID limits and no network access.
3. Wraps the runtime invocation with `perf stat` (when the host allows it and the selected image includes `perf`) to capture hardware counters: `instructions`, `cycles`, `cache-misses`, `branch-misses`, `page-faults`, `context-switches`.
4. Returns the result either by streaming NDJSON (`/api/run`) or by storing it in an in-memory job map for the caller to poll (`/api/jobs`).

For donor worker-side Deep Analysis, `POST /api/analysis/jobs` also runs QuickJS-WASM profiles and static complexity in the worker process, then enqueues the same Node/Deno/Bun jobs used by the existing SSE flow.

## Endpoints

| Method | Path | Purpose | Used by |
| --- | --- | --- | --- |
| `GET`    | `/health`        | Image + perf availability + active job count | smoke tests, monitoring |
| `POST`   | `/api/run`       | Synchronous, NDJSON-streamed benchmark run | local dev, curl |
| `POST`   | `/api/jobs`      | Async; enqueue + return `{ jobId }` (HTTP 202) | `jsperf.net` |
| `GET`    | `/api/jobs/:id`  | Poll job status; returns `{ state, partial?, result?, error? }` | `jsperf.net` |
| `DELETE` | `/api/jobs/:id`  | Cancel a pending/running job | manual ops |
| `POST`   | `/api/complexity` | Static complexity estimate for a batch of tests | `jsperf.net` |
| `POST`   | `/api/analysis/jobs` | Donor composite: QuickJS profiles + complexity + runtime job IDs | `jsperf.net` |

`state` ∈ `{ pending, running, done, errored }`. Completed jobs are evicted from memory after `JOB_RESULT_TTL_MS` (10 minutes). The per-job hard deadline defaults to `JOB_DEADLINE_MS` (30 seconds) and is configurable via the env var of the same name.

## Architecture

```
jsperf.net (Vercel)                                   Hostinger KVM 2 + Dokploy
─────────────────────                                 ──────────────────────────────

POST /api/benchmark/analyze/start
  │
  ├─ POST /api/benchmark/analyze/quickjs
  ├─ POST /api/benchmark/analyze/v8
  └─ POST /api/benchmark/analyze/worker ── POST /api/jobs ──▶ jsperf-worker
                                            (returns 202)          │
                                                                   ▼
                                                           ┌────────────────────┐
EventSource /api/benchmark/multi-runtime/events           │ jsperf-bench-node  │
  │                                                        │ jsperf-bench-deno  │
  └─ SSE proxy checks GET /api/jobs/:id ─────────────────▶ │ jsperf-bench-bun   │
                                                           └────────────────────┘

Donor priority worker lane:

POST /api/benchmark/analyze/donor-job ── POST /api/analysis/jobs ──▶ QuickJS-WASM
       │                                                          ├─ complexity
       ├─ app continues with V8 Sandbox on Vercel                 └─ POST /api/jobs
       └─ app finalizes prediction, cache, and persistence
```

`/api/benchmark/analyze/worker` enqueues the multi-runtime job while the browser runs the QuickJS and V8 routes in parallel. Base analysis can finish and render while the worker continues. The SSE proxy keeps pushing per-test updates until each Node/Deno/Bun comparison is done, then completed results are persisted by multi-runtime cache key for future visits.

When the donor priority lane is enabled (the UI default for donors), `/api/benchmark/analyze/donor-job` calls `/api/analysis/jobs` instead of running QuickJS on the Vercel app. The worker returns the same `quickjsProfiles` shape consumed by the existing prediction model, plus `complexities` and multi-runtime `jobs`. V8 Firecracker, auth, rate limits, cache writes, Mongo persistence, and final prediction still stay in the Vercel app.

The worker is a thin orchestrator. It does not persist any state; benchmark scripts are written to a per-run tmpdir, mounted read-write into one container, then deleted. Cold-start cost per run is dominated by container creation (~150–400ms on a KVM 2 box).

## Project layout

```
worker/
├── server.js              # Hono HTTP entrypoint
├── docker.js              # Container lifecycle: spawn, wait, parse stdout + perf
├── runtimes/
│   ├── common.js          # Shared benchmark loop (matches v8sandbox.js shape)
│   ├── node.js            # Builds a Node.js benchmark script
│   ├── deno.js            # Builds a Deno benchmark script
│   ├── bun.js             # Builds a Bun benchmark script
│   └── quickjs.js         # Runs QuickJS-WASM profiles for donor composite mode
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
| `BENCHMARK_WORKER_SECRET` | yes | Shared bearer token. Use `openssl rand -hex 32`. The worker refuses to start without it. |
| `WORKER_ALLOW_UNAUTHENTICATED` | no | Set to `1` to run without a secret. Local development only — the worker executes untrusted code. |
| `MAX_CONCURRENT_JOBS` | no | Docker-backed jobs allowed to run at once. Defaults to `2`. |
| `MAX_QUEUED_JOBS` | no | Jobs allowed to wait for a slot before new ones get `503`. Defaults to `12`. |
| `MAX_CONCURRENT_SYNC_REQUESTS` | no | In-process requests (`/api/run`, QuickJS in `/api/analysis/jobs`) allowed at once. Defaults to `4`. |
| `COLLECT_PERF` | no | `1` (default) to wrap runtime invocations with `perf stat`. Set to `0` if your kernel rejects it. Perf runs execute as root inside the container (with all other capabilities dropped) because Docker does not grant `--cap-add` capabilities to non-root users. |
| `RUNTIME_CONTAINER_USER` | no | `uid:gid` the runtime containers run as when perf is not collected. Defaults to `65534:65534` (nobody). |
| `JOB_DEADLINE_MS` | no | Hard ceiling for a single async job. Defaults to `30000` (30 s). Increase if you need wider profile sweeps. |
| `REAPER_INTERVAL_MS` | no | How often the cleanup sweep runs. Defaults to `60000`. |
| `ORPHAN_CONTAINER_MAX_AGE_MS` | no | Labeled runtime containers older than this are force-removed. Defaults to per-run timeout + 90 s (`120000`). |
| `STALE_WORK_DIR_MAX_AGE_MS` | no | Per-run script directories older than this are deleted. Defaults to `900000` (15 min). |
| `IMAGE_RETENTION_HOURS` | no | Versioned runtime images (`node:22-bookworm-slim`, …) unused for this long are removed. Defaults to `168` (7 days). The locally built `jsperf-bench-*` images are never pruned. |
| `PORT` | no | Defaults to `8080`. |

When the worker is at capacity it answers `503` with a `Retry-After` header; jsperf.net treats that as "multi-runtime unavailable" for that request rather than failing the whole analysis.

### 4. Wire up jsperf.net on Vercel

In **Vercel → Project → Settings → Environment Variables** add:

| Variable | Value |
| --- | --- |
| `BENCHMARK_WORKER_URL` | `https://worker.your-domain.tld` |
| `BENCHMARK_WORKER_SECRET` | (the same token you set on the worker) |

Re-deploy. The Deep Analysis pipeline will now enqueue async jobs on the worker and stream updates to the browser through `/api/benchmark/multi-runtime/events`. Donors will also get the priority worker lane by default, which moves QuickJS-WASM, complexity, and worker job enqueueing to `/api/analysis/jobs`. If the worker is offline, returns an error, or the SSE proxy reaches the worker deadline, the rest of the analysis still completes for the standard path — the multi-runtime panel shows the worker error while base results render normally. The JSON polling endpoint `/api/benchmark/multi-runtime/[jobId]` remains available as a compatibility fallback.

## Health check

`GET /health` returns:

```json
{
  "status": "ok",
  "images": { "node": true, "deno": true, "bun": true },
  "perf": true,
  "jobs": { "running": 0, "pending": 0, "queued": 0, "active": 0, "total": 0, "maxConcurrent": 2, "maxQueued": 12 },
  "sync": { "inFlight": 0, "max": 4 },
  "reaper": { "sweeps": 12, "trackedImages": 1, "lastSweepAt": 1757084400000, "lastSweep": { "durationMs": 40, "containersScanned": 0, "containersRemoved": 0, "workDirsRemoved": 0, "imagesRemoved": 0, "error": null } }
}
```

If any image is `false`, run `./scripts/build-images.sh` again on the host. A non-null `reaper.lastSweep.error` means the worker could not talk to the Docker daemon during cleanup.

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

Each runtime container is isolated at several independent layers, so a hostile or runaway snippet cannot exfiltrate data, exhaust the host, or run past its budget. The exact `docker run` argument vector is built by `buildDockerRunArgs()` in `docker.ts` and pinned by `tests/worker/docker.test.ts`.

**Network isolation** — `--network none` gives the container only a loopback interface. No DNS, no outbound TCP/UDP, no access to the host or sibling containers. `--ipc none` removes shared memory too. User code physically cannot make a network call.

**Wall-clock ceilings** (defense in depth — any one of these alone would stop a runaway):

| Layer | Default | Behavior on expiry |
| --- | --- | --- |
| Script-level `TIME_LIMIT` | request `timeMs`, capped at 5 s | Loop exits cleanly, partial result emitted |
| Per-container `timeoutMs` | **30 s** (`PER_RUN_TIMEOUT_MS` in `server.ts`) | SIGKILL on the docker child + `docker rm -f <name>` (kills *and* removes, since killing the CLI alone does not stop the container) |
| Per-job `JOB_DEADLINE_MS` | **30 s** (env-configurable) | `AbortController` aborts; propagates through all queued container runs |
| Cgroup CPU + memory budget | per profile | OOM-kill on memory exhaustion; CPU throttled |
| Reaper `ORPHAN_CONTAINER_MAX_AGE_MS` | **120 s** | Any `jsperf.worker=1` container older than this is force-removed, even if the orchestrator that started it is gone |

The script-level limit alone is not sufficient: code like `while(true){}` *inside* the benchmark function never returns control to the loop, so the elapsed-time check never fires. The per-container 30 s ceiling is the safety net for that case, and the reaper is the safety net for the safety net.

**Resource caps** — `--pids-limit 256` (fork-bomb proof), `--ulimit nofile=256:256` (no FD-leak DOS against the host), `--memory-swap == --memory` (no host swap thrash).

**No writable host path** — the rootfs is `--read-only`, the generated script is bind-mounted **read-only** at `/work`, and the only writable filesystem is a 64 MB tmpfs at `/tmp`. Nothing running inside the container can write to the host disk, so a snippet cannot fill it. Perf counters come back over stderr (`perf stat` CSV) and JIT diagnostics over stdout; the orchestrator keeps only bounded tails/heads of both streams (256 KB / 64 KB, 4 MB for JIT captures), so flooding stdout cannot grow the worker's heap either.

**Privilege containment** — `--cap-drop ALL` removes every capability; perf runs add back only `PERFMON` and `SYS_PTRACE`. `--security-opt no-new-privileges` blocks setuid/setgid and file-capability escalation. Containers run as an unprivileged uid (`RUNTIME_CONTAINER_USER`, default `65534:65534`) except when perf counters are collected: Docker does not apply `--cap-add` to non-root users and `no-new-privileges` blocks the file-capability workaround, so perf runs execute as root with everything except the two perf capabilities dropped. Note the runtime images themselves (`images/Dockerfile.*`) default to root; the `--user` flag is what enforces this, not the image.

**Image allowlist** — versioned targets can only resolve to `node:*`, `denoland/deno:*` and `oven/bun:*` tags; the tag is validated against `[A-Za-z0-9._-]` so a request cannot name an arbitrary repository or digest.

**Operational** — no persistent storage. `docker run --rm` removes each container on exit and the per-run script directory is deleted in a `finally`; after a kill or non-zero exit the worker additionally issues `docker rm -f`. A background reaper (`reaper.ts`, every `REAPER_INTERVAL_MS`) force-removes labeled containers older than `ORPHAN_CONTAINER_MAX_AGE_MS`, deletes `bench-*` work directories older than `STALE_WORK_DIR_MAX_AGE_MS`, and removes versioned runtime images unused for `IMAGE_RETENTION_HOURS`. On `SIGTERM`/`SIGINT` (compose stop, redeploy) the worker aborts every in-flight run and sweeps all labeled containers before exiting, so redeploys do not leave runtime containers behind. The worker requires a bearer token via `BENCHMARK_WORKER_SECRET` and refuses to start without one (see `WORKER_ALLOW_UNAUTHENTICATED` for local dev). The Docker socket is mounted into the orchestrator container — this is root-equivalent on the host; deploy this image only inside a trusted environment, and consider fronting the socket with a proxy that only permits the container/image endpoints the worker uses.

## Known limitations

- Versioned runtime targets use official runtime images and do not include `linux-perf`; they skip hardware counters unless you build your own perf-enabled image path.
- `perf stat` may return `<not supported>` for some events on virtualized hosts. Those counters render as `—` in the UI; the rest of the data is unaffected.
- Bun does not expose a `--expose-gc`-style flag; we use `Bun.gc(true)` from inside the script instead.
- Deno and Node both run on V8 but with different built-ins, async schedulers, and TLA semantics. Comparing them tells you about the runtime overhead, not the engine itself.
