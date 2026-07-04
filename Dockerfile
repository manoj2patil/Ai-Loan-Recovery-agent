# Sah-Ayak Recovery Console — build from the repo root:
#   docker build -t sahayak-console .
#   docker run -p 3000:3000 -e STORE_ENCRYPTION_KEY=... -e AUTH_MODE=session -e SESSION_SECRET=... sahayak-console
# The CBS seed ships in the image for the dev store; production points DATABASE_URL at
# PostgreSQL and swaps src/lib/db.ts to Prisma (schema in 09-v2-app/prisma/schema.prisma).

FROM node:22-alpine AS build
WORKDIR /app
COPY 09-v2-app/package.json 09-v2-app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY 09-v2-app/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV SAHAYAK_SEED_PATH=/app/seed/database-backup.json
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY 02-data-and-schema/database-backup.json /app/seed/database-backup.json
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["npm", "start"]
