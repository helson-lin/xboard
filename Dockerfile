# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS frontend
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    XBOARD_DATA_DIR=/var/lib/xboard \
    XBOARD_CONFIG_DIR=/etc/xboard \
    PORT=8765
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 xboard \
    && useradd --uid 10001 --gid xboard --create-home xboard
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py migrate_r2.py ./
COPY core/ ./core/
COPY config/tag_rules.json ./defaults/tag_rules.json
COPY --from=frontend /build/web/dist/ ./static/
COPY docker/entrypoint.sh /usr/local/bin/xboard-entrypoint
RUN chmod 755 /usr/local/bin/xboard-entrypoint \
    && mkdir -p /var/lib/xboard /etc/xboard \
    && chown -R xboard:xboard /var/lib/xboard /etc/xboard
USER 10001:10001
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8765')+'/healthz',timeout=3)" || exit 1
ENTRYPOINT ["xboard-entrypoint"]
CMD ["serve"]
