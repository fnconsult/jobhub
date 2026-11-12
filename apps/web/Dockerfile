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
# Only its Extension Version, which Outils shows Administrators (#920); after `npm ci`, so the extension's own
# dependencies are not installed.
COPY apps/extension/package.json apps/extension/

# Creates or upgrades the database tables (apps/web/scripts/migrate.ts), then exits.
FROM deps AS migrate
USER node
CMD ["node_modules/.bin/tsx", "apps/web/scripts/migrate.ts"]

FROM deps AS build
RUN npm run build --workspace @jobhub/web

# Both zips of the Extension Version this commit carries (#989), the public one and the beta one, as extension.yml
# builds them: Outils lets an Administrator download the one tied to the environment
# (apps/web/src/app/api/account/extension-test-build), with no access to the private repo's GitHub Releases needed.
FROM node:22-alpine AS extension
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/extension/package.json apps/extension/
RUN npm ci --workspace @jobhub/extension --include-workspace-root=false --ignore-scripts
COPY packages/shared packages/shared
COPY apps/extension apps/extension
# The Side Panel imports the design system's styles from the web app (entrypoints/sidepanel/main.ts).
COPY apps/web/src/design apps/web/src/design
RUN npm run zip --workspace @jobhub/extension && npm run zip:beta --workspace @jobhub/extension \
  && version=$(node -p 'require("./apps/extension/package.json").version') \
  && mkdir /extension \
  && cp "apps/extension/.output/jobbbox-extension-$version-chrome.zip" "apps/extension/.output/jobbbox-extension-$version-chrome-beta.zip" /extension/

FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# The commit and the target .github/workflows/deploy.yml builds for (#559); deploy/compose.yml names the target again.
ARG JOBHUB_COMMIT="" JOBHUB_TARGET=""
ENV JOBHUB_COMMIT=$JOBHUB_COMMIT JOBHUB_TARGET=$JOBHUB_TARGET
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=extension --chown=node:node /extension ./extension
ENV EXTENSION_ZIP_DIR=/app/extension
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
