# Build context is the repo root (npm workspaces monorepo) — see docker-compose.yml.

FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
# --ignore-scripts: the root "prepare" script installs a git hook (lefthook) for local
# dev — this build stage has no .git directory and no git binary, so running it here
# would just fail the build for no benefit.
RUN npm ci --ignore-scripts
COPY apps/server apps/server
RUN npm run build --workspace=apps/server
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
COPY apps/server/data ./data
EXPOSE 4001
CMD ["node", "dist/index.js"]
