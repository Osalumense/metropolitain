# Build context is the repo root (npm workspaces monorepo) — see docker-compose.yml.
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, not read at
# runtime, so they must be passed as build args, not just container env.

FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
# --ignore-scripts: the root "prepare" script installs a git hook (lefthook) for local
# dev — this build stage has no .git directory and no git binary, so running it here
# would just fail the build for no benefit.
RUN npm ci --ignore-scripts
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_CF_BEACON_TOKEN
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_CF_BEACON_TOKEN=$NEXT_PUBLIC_CF_BEACON_TOKEN
RUN npm run build --workspace=apps/web

# Next's standalone output mirrors the monorepo path (apps/web/server.js), plus a
# pre-pruned node_modules with only what's actually traced as used — no manual pruning
# needed here, unlike the server image.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Next's standalone server.js binds to HOSTNAME if set, otherwise falls back to the
# container's own bridge-network IP rather than all interfaces — meaning 127.0.0.1
# genuinely has nothing listening from inside the container (confirmed: docker's own
# healthcheck failing with "connection refused" while external access worked fine,
# because Docker's port-mapping NATs straight to the bridge IP, sidestepping the gap).
# 0.0.0.0 fixes both the healthcheck and is the correct binding for a containerized service.
ENV HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
