FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodeapp && adduser -u 1001 -S -G nodeapp nodeapp

COPY --from=deps --chown=nodeapp:nodeapp /app/node_modules ./node_modules
COPY --chown=nodeapp:nodeapp package.json package-lock.json ./
COPY --chown=nodeapp:nodeapp src ./src

USER nodeapp
EXPOSE 3000

CMD ["node", "src/index.js"]