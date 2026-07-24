# syntax=docker/dockerfile:1

# ---------- Stage 1: builder ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Install full deps (incl. dev) for the build + the migrate service.
COPY package.json package-lock.json* ./
RUN npm install

# Build the client (vite -> dist/public) then bundle the server (esbuild -> dist/index.cjs).
COPY . .
RUN npm run build

# ---------- Stage 2: runner ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Only production deps are needed at runtime (native deps stay external to the bundle).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Ship the built artefacts + the migration set.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations

# Uploaded IKC exports land here (also a named volume in docker-compose).
RUN mkdir -p /app/uploads

EXPOSE 5000
CMD ["node", "./dist/index.cjs"]
