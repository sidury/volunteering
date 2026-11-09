# Volunteer Planner: one container, one data volume.
#   docker build -f docker/Dockerfile -t vol-planner:dev .

FROM node:20-bookworm-slim AS ui
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
RUN npm run check && npm run build && test -f dist/index.html

FROM python:3.11-slim-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx curl \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default
COPY tools/vol_store.py tools/vol_api.py /opt/app/
COPY --from=ui /ui/dist /opt/ui
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
ENV VOL_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/health >/dev/null || exit 1
ENTRYPOINT ["/entrypoint.sh"]
