# syntax=docker/dockerfile:1.7

# Run the native TypeScript compiler on the build platform. The emitted JS
# and production dependencies can be copied to either runtime architecture.
FROM --platform=$BUILDPLATFORM dhi.io/node:26.13.1-debian13-dev AS base
WORKDIR /app
ENV PNPM_HOME="/pnpm"
COPY package.json ./
RUN npm install --global --ignore-scripts --registry=https://npm.flatt.tech/ \
    "$(node -p 'require("./package.json").packageManager')"

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts

FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

FROM dhi.io/node:26.13.1-debian13 AS runtime
WORKDIR /app

ENV NODE_ENV="production"
ENV MCP_TRANSPORT="http"
ENV MCP_HTTP_HOST="0.0.0.0"
ENV MCP_HTTP_ALLOWED_HOSTS="localhost,127.0.0.1,[::1]"
ENV MCP_HTTP_ALLOWED_ORIGINS="localhost,127.0.0.1,[::1]"

COPY --from=prod-deps --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/dist ./dist
COPY --from=build --chown=1000:1000 /app/package.json ./package.json

USER 1000:1000
EXPOSE 3000
CMD ["node", "dist/cli.js"]
