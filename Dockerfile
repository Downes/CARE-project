# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:20-slim AS frontend-builder

WORKDIR /build/app
COPY app/package.json app/package-lock.json* ./
RUN npm install

COPY app/ ./
RUN npm run build


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
# node:20 (full image) needed because better-sqlite3 requires native compilation
FROM node:20 AS runtime

WORKDIR /app

# Install backend dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy server source
COPY server.js ./

# Copy built frontend from stage 1
COPY --from=frontend-builder /build/app/dist ./app/dist

# Data directory — mount a volume here for persistence
RUN mkdir -p /data
ENV DATA_DIR=/data

EXPOSE 3002

CMD ["node", "server.js"]
