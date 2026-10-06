FROM node:24.21.0-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:24.21.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=frontend /build/frontend/dist /app/frontend/dist
RUN mkdir -p /var/lib/securevault && chmod 700 /var/lib/securevault && chown node:node /var/lib/securevault
USER node
EXPOSE 5000
CMD ["node","server.js"]
