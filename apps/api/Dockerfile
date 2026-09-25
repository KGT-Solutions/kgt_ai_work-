FROM node:20-alpine

RUN apk add --no-cache openssl postgresql-client

# Headless Chromium for the crawler's Tier-2 SPA fallback
# (src/services/shared/crawlerBrowser.js). Alpine's system package, driven
# by puppeteer-core — Puppeteer's own downloaded Chrome is glibc-only and
# won't run on Alpine (musl). Launched --no-sandbox because this container
# runs as root, which is why only the operator /scrape route may use it.
RUN apk add --no-cache chromium
ENV CRAWLER_BROWSER_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh /docker-entrypoint.sh
# Strip Windows CRLF so the shebang works on Alpine
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

RUN npx prisma generate

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
