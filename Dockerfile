# syntax=docker/dockerfile:1.7

# deps/build produce arch-independent JS (all deps are pure JS), so run them
# natively on the build host instead of under QEMU for each target platform.
FROM --platform=$BUILDPLATFORM node:22-alpine AS base
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# corepack resolves the pnpm version from package.json's "packageManager" field
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV="production"
ENV MCP_TRANSPORT="http"
ENV MCP_HTTP_HOST="0.0.0.0"
ENV MCP_HTTP_ALLOWED_HOSTS="localhost,127.0.0.1,[::1]"
ENV MCP_HTTP_ALLOWED_ORIGINS="localhost,127.0.0.1,[::1]"

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 3000
CMD ["node", "dist/cli.js"]
