# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS deps
WORKDIR /repo
RUN npm i -g pnpm@8.15.4
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm fetch
RUN pnpm install --frozen-lockfile --offline

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @tas/shared-types run build
RUN pnpm --filter @tas/web run build

FROM node:22-alpine AS runtime
WORKDIR /app
# Copy the full pnpm virtual store and per-package node_modules to preserve
# all dependencies (avoids --prod filtering surprises in the monorepo).
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=build /repo/apps/web/package.json apps/web/
COPY --from=build /repo/packages/shared-types/package.json packages/shared-types/
COPY --from=build /repo/apps/web/.next apps/web/.next
COPY --from=build /repo/apps/web/next.config.mjs apps/web/
COPY --from=build /repo/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /repo/apps/web/node_modules apps/web/node_modules
COPY --from=build /repo/packages/shared-types/node_modules packages/shared-types/node_modules
EXPOSE 3001
WORKDIR /app/apps/web
CMD ["node_modules/.bin/next", "start", "--port", "3001"]
