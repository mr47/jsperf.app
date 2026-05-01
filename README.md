# jsPerf

Modern JavaScript and TypeScript performance benchmarking for the web.

`jsperf.net` is a Next.js rewrite of jsPerf. It lets users create, run, save, and share benchmark cases, then inspect browser results alongside deeper server-side analysis from QuickJS-WASM, V8 in Vercel Sandbox, and an optional worker for QuickJS donor mode, complexity estimates, Node, Deno, and Bun.

## Features

- Create shareable JavaScript and TypeScript benchmark pages.
- Run browser benchmarks in an isolated iframe sandbox using `tinybench`.
- Save revisions and latest runs in MongoDB.
- Cache analysis and rate-limit expensive paths with Upstash Redis.
- Analyze snippets through QuickJS-WASM and V8 microVM runs.
- Compare Node.js, Deno, and Bun through the optional Docker-based worker.
- Let donors move QuickJS-WASM plus worker-safe Deep Analysis phases to the worker while V8 stays on Vercel Sandbox.
- Generate donor-only presentation reports.
- Support GitHub sign-in, donor verification, and donor-tier rate limits.

## Tech Stack

- Next.js Pages Router
- React
- TypeScript
- Tailwind CSS
- MongoDB
- Upstash Redis and rate limiting
- NextAuth with GitHub
- Vercel Sandbox
- QuickJS-WASI
- Vitest

## Project Structure

```text
components/         TSX UI components, benchmark editor, reports, and charts
lib/                TypeScript benchmark preparation, engines, prediction, persistence, and auth helpers
pages/              Next.js TSX pages and TypeScript API routes
styles/             Global styles
tests/              TypeScript app test suite
utils/              TypeScript browser, URL, highlighting, and sandbox helpers
worker/             Optional TypeScript multi-runtime benchmark worker
```

## Requirements

- Node.js 24.x for the main app
- npm 11.x
- MongoDB database
- Upstash Redis database
- Docker, if you want to run the multi-runtime worker locally

## Getting Started

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
touch .env.local
```

Add the required variables:

```bash
MONGODB_URI=
MONGODB_COLLECTION=
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

Start the development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Required for the app:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string. |
| `MONGODB_COLLECTION` | Collection used for benchmark pages. |
| `KV_REST_API_URL` | Upstash Redis REST URL. |
| `KV_REST_API_TOKEN` | Upstash Redis REST token. |

Optional integrations:

| Variable | Purpose |
| --- | --- |
| `NEXTAUTH_SECRET` | Signs NextAuth JWT sessions. Required for GitHub sessions and donor email matching. |
| `GITHUB_ID` | GitHub OAuth app client ID. |
| `GITHUB_SECRET` | GitHub OAuth app client secret. |
| `DONATELLO_TOKEN` | Enables donor verification through the Donatello API. |
| `REVALIDATE_SECRET` | Protects the `/api/revalidate` endpoint. |
| `NEXT_PUBLIC_GA_ID` | Google Analytics measurement ID. |
| `BENCHMARK_WORKER_URL` | URL for the optional Deep Analysis worker. Enables Node/Deno/Bun analysis, remote complexity estimates, and donor worker-side QuickJS. |
| `BENCHMARK_WORKER_SECRET` | Bearer token shared with the Deep Analysis worker. |
| `VERCEL_TOKEN` | Optional Vercel token for local Vercel Sandbox access and cleanup. |
| `VERCEL_OIDC_TOKEN` | Optional OIDC token for Vercel Sandbox access and cleanup. |
| `VERCEL_TEAM_ID` | Vercel team scope for Sandbox operations. |
| `VERCEL_PROJECT_ID` | Vercel project scope for Sandbox operations. |

## Scripts

```bash
npm run dev        # Start Next.js in development mode
npm run build      # Build the production app
npm run start      # Start the production server
npm run test       # Run Vitest once
npm run test:watch # Run Vitest in watch mode
npm run typecheck  # Run TypeScript without emitting files
npm run check      # Run typecheck, tests, and production build
```

## TypeScript

The app source, tests, shared libraries, Next.js pages, API routes, and worker source are TypeScript/TSX. `typescript` is a runtime dependency because the app compiles user-submitted TypeScript benchmark snippets in `lib/benchmark/source.ts`.

Most JavaScript files are now intentional exceptions: config files, generated coverage assets, local scripts, or Mongo shell schema scripts. See `TYPESCRIPT_MIGRATION.md` for the current exception list and migration notes.

## Optional Deep Analysis Worker

The `worker/` package runs benchmark snippets in Node.js, Deno, and Bun inside resource-limited Docker containers, estimates static complexity, and can run QuickJS-WASM profiles for donor worker-side analysis. The main app uses it asynchronously when `BENCHMARK_WORKER_URL` is configured.

## Deep Analysis Data Flow

Deep Analysis is split across small API routes so slow phases do not block one Vercel request. The browser is the orchestrator and chooses the free or donor path from `/api/benchmark/analyze/start`:

```text
Browser
  │
  ├─ POST /api/benchmark/analyze/start
  │    validate, rate-limit, prepare JS/TS sources, create Redis session,
  │    check base-analysis cache
  │
  ├─ free/non-donor cache miss: parallel route fan-out
  │    ├─ POST /api/benchmark/analyze/quickjs  -> QuickJS-WASM profiles
  │    ├─ POST /api/benchmark/analyze/v8       -> V8 in Vercel Sandbox
  │    └─ POST /api/benchmark/analyze/worker   -> complexity + worker job IDs
  │
  ├─ POST /api/benchmark/analyze/finalize
  │    merge QuickJS/V8/complexity, build prediction + Benchmark Doctor,
  │    persist MongoDB snapshot and Redis cache
  │
  ├─ donor cache miss: polling route
  │    └─ POST /api/benchmark/analyze/donor-job
  │       resumes a Redis-backed job one chunk at a time: worker enqueue,
  │       QuickJS per test, V8 per test, then final persistence
  │       donor toggle: POST /api/analysis/jobs on the worker returns
  │       QuickJS profiles + complexity + worker job IDs before V8 chunks
  │
  └─ EventSource /api/benchmark/multi-runtime/events
       server-side proxy polls worker jobs, emits per-test SSE updates,
       persists completed Node/Deno/Bun results by multi-runtime cache key
```

The 60 second Vercel route limit applies to each route invocation, not to the whole donor workflow. Free runs still use one parallel fan-out with a 60 second envelope. Donor runs get a longer Redis session window and poll `/api/benchmark/analyze/donor-job`, which advances QuickJS/V8 in per-test chunks so a full deep analysis can outlive one request. If a donor enables worker-side QuickJS in the setup modal, `/api/benchmark/analyze/donor-job` fills QuickJS profiles from the worker composite endpoint and then continues with V8 on Vercel Sandbox. Multi-runtime worker jobs can also run longer: `/api/benchmark/analyze/worker` and the donor job only enqueue jobs and return their deadlines, while `/api/benchmark/multi-runtime/events` keeps a lightweight server-sent-events connection open and streams updates until the worker finishes or its advertised deadline expires.

The legacy `/api/benchmark/analyze` route remains for compatibility, but the UI uses the split route flow above.

Local worker setup:

```bash
cd worker
cp .env.example .env
npm install
npm run build-images
npm run dev
```

Then set these variables in the main app:

```bash
BENCHMARK_WORKER_URL=http://localhost:8080
BENCHMARK_WORKER_SECRET=<same value as worker/.env>
```

See `worker/README.md` for deployment, health checks, security notes, and worker API details.

Worker scripts:

```bash
npm run dev       # Run worker source through tsx in watch mode
npm run build     # Compile worker TypeScript to dist/
npm run start     # Start the compiled worker from dist/server.js
npm run typecheck # Run worker TypeScript without emitting files
npm run check     # Run worker typecheck, tests, and build
```

## Testing

Run the app test suite:

```bash
npm run test
npm run typecheck
```

Run the worker test suite:

```bash
cd worker
npm run test
npm run typecheck
```

## Deployment Notes

The app is designed for Vercel. The deep-analysis path uses Vercel Sandbox for isolated V8 runs, MongoDB for saved pages and analysis snapshots, and Upstash Redis for caching, donor sessions, and rate limits.

The multi-runtime worker is optional and should be deployed separately on a trusted Docker host because it orchestrates containers through the Docker socket.
