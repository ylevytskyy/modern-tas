# syntax=docker/dockerfile:1.7
# node:22-slim (Debian-based) is required because @temporalio/core-bridge ships
# a prebuilt glibc binary; Alpine/musl is incompatible with that binary.
FROM node:22-slim AS deps
WORKDIR /repo
RUN npm i -g pnpm@8.15.4
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/temporal-worker/package.json apps/temporal-worker/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm fetch
RUN pnpm install --frozen-lockfile --offline

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/temporal-worker apps/temporal-worker
RUN pnpm --filter @tas/db run build
RUN pnpm --filter @tas/shared-types run build
RUN pnpm --filter @tas/temporal-worker run build

FROM node:22-slim AS runtime
WORKDIR /app
# Copy the full pnpm virtual store and per-package node_modules to preserve
# all dependencies (avoids --prod filtering surprises in the monorepo).
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=build /repo/apps/temporal-worker/package.json apps/temporal-worker/
COPY --from=build /repo/packages/db/package.json packages/db/
COPY --from=build /repo/packages/shared-types/package.json packages/shared-types/
COPY --from=build /repo/apps/temporal-worker/dist apps/temporal-worker/dist
COPY --from=build /repo/packages/db/dist packages/db/dist
COPY --from=build /repo/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /repo/apps/temporal-worker/node_modules apps/temporal-worker/node_modules
COPY --from=build /repo/packages/db/node_modules packages/db/node_modules
COPY --from=build /repo/packages/shared-types/node_modules packages/shared-types/node_modules
WORKDIR /app/apps/temporal-worker
CMD ["node", "dist/src/worker.js"]
