FROM node:22.23.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY code/backend/package.json code/backend/package.json
COPY code/frontend/web/package.json code/frontend/web/package.json
RUN npm ci --workspace @app/web
COPY code/backend/openapi code/backend/openapi
COPY code/frontend/web code/frontend/web
RUN npm run build --workspace @app/web

FROM nginx:1.29-alpine
RUN apk add --no-cache jq
COPY --from=build /app/code/frontend/web/dist /usr/share/nginx/html
COPY deployment/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY deployment/docker/frontend-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD ["wget", "-q", "-O", "-", "http://127.0.0.1/healthz"]
