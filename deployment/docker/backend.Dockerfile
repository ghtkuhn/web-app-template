FROM node:24.19.0-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
COPY code/backend/package.json code/backend/package.json
COPY code/frontend/web/package.json code/frontend/web/package.json
RUN npm ci --ignore-scripts --omit=dev --workspace @app/backend

COPY code/backend code/backend
RUN mkdir -p /var/lib/web-app && chown -R node:node /app /var/lib/web-app

USER node
ENV NODE_ENV=production
EXPOSE 3000 3001
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "--experimental-transform-types", "code/backend/src/index.ts"]
