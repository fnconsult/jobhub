# Web app image (Next.js standalone) and the one-shot migration image.
# Build from the repo root:
#   docker build -f apps/web/Dockerfile --target web .
#   docker build -f apps/web/Dockerfile --target migrate .
# Used by deploy/compose.yml on the staging and production VPS (docs/ops/hosting.md).

FROM node:22-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ai/package.json packages/ai/
COPY packages/coach-knowledge/package.json packages/coach-knowledge/
COPY packages/help/package.json packages/help/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
RUN npm ci --workspace @jobhub/web --include-workspace-root --ignore-scripts
COPY packages packages
COPY apps/web apps/web

# Creates or upgrades the database tables (apps/web/scripts/migrate.ts), then exits.
FROM deps AS migrate
USER node
CMD ["node_modules/.bin/tsx", "apps/web/scripts/migrate.ts"]

FROM deps AS build
RUN npm run build --workspace @jobhub/web

FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
