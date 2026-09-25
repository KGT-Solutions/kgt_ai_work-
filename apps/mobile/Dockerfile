FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG EXPO_PUBLIC_API_URL=http://localhost:4000
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
ENV CI=1
ENV EXPO_NO_TELEMETRY=1

EXPOSE 8081

CMD ["npx", "expo", "start", "--web", "--port", "8081", "--host", "lan"]
