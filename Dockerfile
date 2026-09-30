FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --chown=node:node . .
ENV NODE_ENV=production PORT=3002
USER node
EXPOSE 3002
CMD ["node", "server.js"]
