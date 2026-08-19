# Build and run the API. Two stages so the runtime image carries no compiler,
# no dev dependencies and no TypeScript sources.
FROM node:22-alpine AS build
WORKDIR /app

# --legacy-peer-deps: eslint-config-airbnb-extended declares a peer of eslint 9
# while this repo runs eslint 10. Pre-existing, unrelated to the runtime.
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

COPY --from=build /app/dist ./dist

# Run as the image's own unprivileged user rather than root.
USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]
