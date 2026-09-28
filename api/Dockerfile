# Poppin on Arc API. The Railway service's root directory is api, so the
# build context is this folder alone: its own package.json and lockfile, and
# nothing from the rest of the monorepo.
FROM node:22-slim AS build
WORKDIR /app
# The lockfile was written by npm 11; node:22's bundled npm reads its
# optional peer entries differently and refuses `npm ci` ("Missing:
# utf-8-validate from lock file", first Railway build, 2026-09-28).
RUN npm install -g npm@11.13.0 --no-audit --no-fund
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
CMD ["node", "dist/main.js"]
