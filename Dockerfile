# syntax=docker/dockerfile:1

# ---- build ----
# The full bookworm image already includes OpenSSL (needed by Prisma's engines),
# so no apt-get is required anywhere in this build.
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY server server
COPY web web
RUN npm run build -w server && npm run build -w web && npm prune --omit=dev
# Collect OpenSSL 3 (libs + CLI, at their standard paths) for the slim runtime image.
# Prisma detects the OpenSSL version from these, so they must live where the distro puts them.
RUN mkdir -p /ssl && tar -cf - /usr/bin/openssl /usr/lib/*-linux-gnu/libssl.so.3 /usr/lib/*-linux-gnu/libcrypto.so.3 \
      /usr/lib/*-linux-gnu/ossl-modules /usr/lib/ssl | tar -xf - -C /ssl

# ---- runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production WEB_DIST=/app/web/dist STORAGE_PATH=/data
COPY --from=build /ssl/ /
RUN openssl version
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/web/dist web/dist
WORKDIR /app/server
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node ../node_modules/prisma/build/index.js migrate deploy && node dist/index.js"]
