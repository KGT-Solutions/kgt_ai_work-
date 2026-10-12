# Playwright runner: browsers come with the base image (its version must
# match @playwright/test in package.json). Dependencies are installed at
# build time; the tests run on docker-compose.e2e.yml's offline network.
FROM mcr.microsoft.com/playwright:v1.64.0-noble

WORKDIR /e2e
COPY package.json package-lock.json ./
RUN npm ci
COPY playwright.config.js ./
COPY support ./support
COPY fixtures ./fixtures
COPY tests ./tests

CMD ["npx", "playwright", "test"]
