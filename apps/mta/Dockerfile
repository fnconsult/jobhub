# Email intake's MTA (#580): Haraka, built from the repo root (docker build -f apps/mta/Dockerfile .).
# Only the plugins it runs are installed, at fixed versions; no app code is in the image.
FROM node:22-alpine
RUN apk add --no-cache openssl tini
WORKDIR /haraka
RUN printf '{"name":"jobbbox-mta","private":true}\n' > package.json \
  && npm install --omit=optional --omit=dev --no-audit --no-fund \
    Haraka@3.3.5 haraka-plugin-spf@1.3.0 haraka-plugin-dkim@1.3.1 \
  && npm cache clean --force
COPY apps/mta/config ./config
COPY apps/mta/src/intake.js ./src/intake.js
COPY apps/mta/plugins ./plugins
COPY apps/mta/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Haraka creates its (unused) outbound queue directory at start.
RUN mkdir -p /haraka/queue /run/haraka-tls && chown node:node /haraka/queue /run/haraka-tls
USER node
EXPOSE 2525
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
