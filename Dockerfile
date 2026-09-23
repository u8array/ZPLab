# syntax=docker/dockerfile:1

# Pinned to the builder's arch so the node build never runs under QEMU.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/mcp-server/package.json packages/mcp-server/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
# Self-hosters can point previews at a private Labelary or switch them off.
ARG VITE_LABELARY_API_URL
ARG VITE_THIRD_PARTY_LABELARY
# CI type-checks the same commit, so the image only needs the bundle.
RUN pnpm exec vite build

FROM nginxinc/nginx-unprivileged:1.29-alpine-slim
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# Own root so the served directory holds only the app's files.
COPY --from=build /app/dist /srv/zplab
