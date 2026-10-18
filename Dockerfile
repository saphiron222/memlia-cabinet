FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/ui/package.json ./packages/ui/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
RUN npm ci
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
COPY docs/frontend-licensing.md docs/design-interface-provenance.json docs/interface-source-map.md docs/propel-source-rebuild.md ./docs/
COPY deploy/operations.mjs deploy/operations.d.mts ./deploy/
RUN npm run build
RUN npm prune --omit=dev

FROM postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826 AS postgres-tools
FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 libldap-2.5-0 libssl3 liblz4-1 libzstd1 zlib1g libgssapi-krb5-2 && rm -rf /var/lib/apt/lists/*
COPY --from=postgres-tools /usr/lib/*/libpq.so.5* /usr/local/lib/
RUN ldconfig
COPY --from=postgres-tools /usr/lib/postgresql/17/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=postgres-tools /usr/lib/postgresql/17/bin/pg_restore /usr/local/bin/pg_restore
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/server/dist/licenses ./apps/web/dist/licenses/server
COPY --from=postgres-tools /usr/share/doc/postgresql-17/copyright ./apps/web/dist/licenses/postgresql-17.txt
COPY --from=postgres-tools /usr/share/doc/libpq5/copyright ./apps/web/dist/licenses/libpq5.txt
COPY deploy/operations.mjs ./deploy/operations.mjs
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WEB_DIRECTORY=/app/apps/web/dist
USER node
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
