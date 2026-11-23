# ==============================================================================
# StudySync Backend Dockerfile (Requirement D4, D5)
# Multi-stage production build running Node 22 Alpine
# ==============================================================================

# Stage 1: Build & TypeScript Compilation
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace configurations and backend package manifest
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install dependencies across workspace
RUN npm ci

# Copy backend source code and tsconfig
COPY backend ./backend

# Build TypeScript to dist
WORKDIR /app/backend
RUN npm run build

# Stage 2: Minimal Production Runtime
FROM node:22-alpine AS runner

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PORT=4000

# Install curl for container healthcheck
RUN apk add --no-cache curl

# Copy root package manifests and built artifacts
COPY package*.json /app/
COPY backend/package*.json /app/backend/
COPY frontend/package*.json /app/frontend/

WORKDIR /app
RUN npm ci --omit=dev

WORKDIR /app/backend
COPY --from=builder /app/backend/dist ./dist

# Create persistent storage directory for PGlite database
RUN mkdir -p /app/backend/data/postgres && chown -R node:node /app

USER node

EXPOSE 4000

# Healthcheck gated on /healthz (Requirement D4)
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/healthz || exit 1

CMD ["node", "dist/server.js"]

