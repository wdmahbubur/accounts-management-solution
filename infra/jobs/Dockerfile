# Official Node.js image resolved 24 October 2026. Refresh through a tested PR.
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
WORKDIR /app
RUN npm install --global npm@11.19.0 --ignore-scripts
COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY apps/web/server/ ./apps/web/server/
COPY scripts/background-jobs/ ./scripts/background-jobs/
COPY scripts/run-background-jobs.mjs scripts/check-background-health.mjs ./scripts/
USER node
ENV NODE_ENV=production
ENTRYPOINT ["node","--conditions=react-server","--env-file=/run/secrets/worker_env","scripts/run-background-jobs.mjs"]
