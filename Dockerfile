FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Non-root for Kubernetes Pod Security (node user is uid 1000)
USER node
EXPOSE 3000
ENV LOG_FORMAT=json NODE_ENV=production
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:${PORT:-3000}/readyz || exit 1
# Run node directly (not `npm start`) so SIGTERM reaches the process and graceful drain runs
CMD ["node", "src/server.js"]
