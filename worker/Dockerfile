# Worker (orchestrator) image.
#
# This is the long-running service Dokploy deploys. It receives benchmark
# jobs from jsperf.net and shells out to `docker run` for each runtime.
#
# Because the worker itself orchestrates other containers, we mount the host
# Docker socket at /var/run/docker.sock when running this image. The runtime
# images (jsperf-bench-node/deno/bun) must be built separately on the host.
FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        docker.io \
        g++ \
        make \
        python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
ENV CXXFLAGS="-std=c++20"
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js docker.js runtime-targets.js ./
COPY complexity ./complexity
COPY runtimes ./runtimes

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
