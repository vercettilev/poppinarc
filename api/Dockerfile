# Poppin on Arc API. Built from the REPO ROOT as context (Railway's default),
# so every path below starts with arc/api/.
FROM node:22-slim AS build
WORKDIR /app
COPY arc/api/package.json arc/api/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY arc/api/tsconfig.json arc/api/tsconfig.build.json ./
COPY arc/api/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY arc/api/package.json ./
CMD ["node", "dist/main.js"]
