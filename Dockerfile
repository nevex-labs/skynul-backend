# syntax = docker/dockerfile:1

# =============================================================================
# Skynul Backend - Production Dockerfile
# Multi-stage build optimized for size and security
# =============================================================================

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=20.18.0
FROM node:${NODE_VERSION}-alpine AS base

LABEL maintainer="Skynul Team"
LABEL description="Skynul Backend API - AI Agent Platform"

# Install security updates and dumb-init for proper signal handling
RUN apk update && \
    apk upgrade && \
    apk add --no-cache dumb-init && \
    rm -rf /var/cache/apk/*

# Create app directory
WORKDIR /app

# Install pnpm
ARG PNPM_VERSION=10.18.2
RUN npm install -g pnpm@$PNPM_VERSION

# Set production environment
ENV NODE_ENV=production
ENV MIGRATIONS_FOLDER=/app/migrations

# =============================================================================
# Build Stage
# =============================================================================
FROM base AS build

RUN apk add --no-cache \
    python3 \
    make \
    g++

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy application code
COPY . .

# Build TypeScript
RUN pnpm build

# =============================================================================
# Production Stage
# =============================================================================
FROM base AS production

# Create non-root user for security
RUN addgroup -g 1001 -S skynul && \
    adduser -S skynul -u 1001

# Copy production dependencies and built app
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/src/infrastructure/db/migrations /app/migrations

# Create data directory for persistence (SQLite, logs, etc.)
RUN mkdir -p /app/data /app/logs && \
    chown -R skynul:skynul /app

# Switch to non-root user
USER skynul

# Expose application port
EXPOSE 3141

# Health check - verify API is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "const http=require('http');const o={hostname:'localhost',port:process.env.PORT||3141,path:'/health',method:'GET',timeout:5000};const r=http.request(o,res=>process.exit(res.statusCode===200?0:1));r.on('error',()=>process.exit(1));r.on('timeout',()=>process.exit(1));r.end();"

# Use dumb-init to handle signals properly (PID 1 problem)
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]
