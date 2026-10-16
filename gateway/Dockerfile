FROM node:20-bookworm-slim
WORKDIR /app/gateway
COPY gateway/package.json gateway/package-lock.json ./
RUN npm ci --omit=dev
COPY gateway/ ./
COPY preview/ /app/preview/
ENV PORT=8991 WM_PREVIEW=/app/preview
CMD ["node", "src/server.js"]
