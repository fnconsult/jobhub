# Background-job runner image. Build from the repo root:
#   docker build -f apps/worker/Dockerfile .
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
RUN npm ci --workspace @jobhub/worker --include-workspace-root=false --ignore-scripts
COPY packages/shared packages/shared
COPY apps/worker apps/worker
USER node
CMD ["npm", "run", "start", "--workspace", "@jobhub/worker"]
