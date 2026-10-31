FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/lib/analysis.mjs ./src/lib/analysis.mjs
COPY src/lib/backtest.mjs src/lib/shock-data.mjs ./src/lib/
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
CMD ["node", "server/index.mjs"]
