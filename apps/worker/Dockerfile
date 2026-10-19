# Background-job runner image. Build from the repo root:
#   docker build -f apps/worker/Dockerfile .
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ai/package.json packages/ai/
COPY packages/coach-knowledge/package.json packages/coach-knowledge/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
RUN npm ci --workspace @jobhub/worker --include-workspace-root=false --ignore-scripts
COPY packages/shared packages/shared
COPY packages/ai packages/ai
# The AI Coach's Playbooks, read by the web app's modules below.
COPY packages/coach-knowledge packages/coach-knowledge
# Job discovery stores Job Offers and reads Profiles through the web app's modules.
COPY apps/web/src apps/web/src
COPY apps/worker apps/worker
USER node
CMD ["npm", "run", "start", "--workspace", "@jobhub/worker"]
