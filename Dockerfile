# syntax=docker/dockerfile:1

# Pinned to the builder's arch so the node build never runs under QEMU.
FROM --platform=$BUILDPLATFORM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/headless/package.json packages/headless/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/server/package.json packages/server/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .

FROM deps AS build
# Self-hosters can point previews at a private Labelary or switch them off.
ARG VITE_LABELARY_API_URL
ARG VITE_THIRD_PARTY_LABELARY
# CI type-checks the same commit, so the image only needs the bundle.
RUN pnpm exec vite build

FROM deps AS server-bundle
RUN pnpm --filter @zplab/server build:bundle

FROM node:24-alpine AS server
WORKDIR /app
COPY --from=server-bundle /app/packages/server/dist-sea/zplab-server.cjs ./zplab-server.cjs
COPY --from=server-bundle /app/LICENSE /app/THIRD-PARTY-LICENSES.md ./
ENV ZPLAB_HOST=0.0.0.0 ZPLAB_PORT=8787
EXPOSE 8787
USER node
# A one-second start does not need the default 30 s probe interval.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD wget -qO- "http://127.0.0.1:${ZPLAB_PORT}/api/v1/health"
CMD ["node", "zplab-server.cjs"]

# Last stage, so a build without --target still yields the designer.
FROM nginxinc/nginx-unprivileged:1.31-alpine-slim AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# Own root so the served directory holds only the app's files.
COPY --from=build /app/dist /srv/zplab
