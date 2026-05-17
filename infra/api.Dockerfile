# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS deps
WORKDIR /repo
RUN npm i -g pnpm@8.15.4
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ari-client/package.json packages/ari-client/
RUN pnpm fetch
RUN pnpm install --frozen-lockfile --offline

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @tas/db run build
RUN pnpm --filter @tas/shared-types run build
RUN pnpm --filter @tas/ari-client run build
RUN pnpm --filter @tas/api run build

FROM node:22-alpine AS runtime
WORKDIR /app
# Copy the full node_modules (built in deps stage) to avoid re-installing.
# Preserves misclassified runtime deps (e.g. jsonwebtoken in devDependencies).
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=build /repo/apps/api/package.json apps/api/
COPY --from=build /repo/packages/db/package.json packages/db/
COPY --from=build /repo/packages/shared-types/package.json packages/shared-types/
COPY --from=build /repo/packages/ari-client/package.json packages/ari-client/
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/packages/db/dist packages/db/dist
COPY --from=build /repo/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /repo/packages/ari-client/dist packages/ari-client/dist
# Symlinks for workspace packages inside node_modules/.pnpm point back to /repo paths;
# re-create the workspace node_modules symlinks under /app.
COPY --from=build /repo/apps/api/node_modules apps/api/node_modules
COPY --from=build /repo/packages/db/node_modules packages/db/node_modules
COPY --from=build /repo/packages/shared-types/node_modules packages/shared-types/node_modules
COPY --from=build /repo/packages/ari-client/node_modules packages/ari-client/node_modules
# ari-client npm pkg is a direct dep of @tas/ari-client but is dynamically
# required from apps/api/dist/src/ari/ari.module.js at runtime. Under pnpm
# strict isolation it is not hoisted into apps/api/node_modules, so we
# add the symlink manually to satisfy Node's module resolution from that path.
RUN ln -s ../../../packages/ari-client/node_modules/ari-client apps/api/node_modules/ari-client
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "dist/src/main.js"]
