# Build context is the repo root (npm workspaces monorepo) — see docker-compose.yml.
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, not read at
# runtime, so they must be passed as build args, not just container env.

FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN npm run build --workspace=apps/web

# Next's standalone output mirrors the monorepo path (apps/web/server.js), plus a
# pre-pruned node_modules with only what's actually traced as used — no manual pruning
# needed here, unlike the server image.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
