# ==============================================================================
# StudySync Frontend Dockerfile (Requirement D4, D5)
# Multi-stage production build: Node 22 Vite build -> Nginx Alpine
# ==============================================================================

# Stage 1: Build React + TypeScript bundle
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace configurations and frontend manifests
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/

# Install dependencies across workspace
RUN npm ci

# Copy frontend source code
COPY frontend ./frontend

# Build optimized production bundle
WORKDIR /app/frontend
RUN npm run build

# Stage 2: Production Nginx Server
FROM nginx:alpine

# Copy built frontend assets
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# Copy custom Nginx configuration with CDN caching & security headers
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

