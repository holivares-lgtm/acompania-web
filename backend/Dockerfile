FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm install
COPY backend/ .
RUN npm run prisma:generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --ignore-scripts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY backend/prisma ./prisma

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/main"]
