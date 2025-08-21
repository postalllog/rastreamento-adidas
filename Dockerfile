# Etapa 1 - Build
FROM node:18-alpine AS builder
WORKDIR /app

COPY rastreamento-adidas/package*.json ./
RUN npm ci

COPY rastreamento-adidas/ ./
RUN npm run build

# Etapa 2 - Runtime
FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.js ./server.js

EXPOSE 3000 3001
CMD ["npm", "run", "start:all"]
