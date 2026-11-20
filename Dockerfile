FROM node:24-bookworm-slim AS frontend
WORKDIR /frontend
COPY Frontend/package*.json ./
RUN npm ci
COPY Frontend/src ./src
COPY Frontend/public ./public
COPY Frontend/index.html Frontend/vite.config.js ./
RUN npm run build

FROM ghcr.io/gitleaks/gitleaks:v8.30.1 AS gitleaks
FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3-venv && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/semgrep && /opt/semgrep/bin/pip install --no-cache-dir semgrep==1.182.1
ENV PATH="/opt/semgrep/bin:${PATH}"
COPY --from=gitleaks /usr/bin/gitleaks /usr/local/bin/gitleaks
ADD --chmod=755 --checksum=sha256:160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b https://github.com/google/osv-scanner/releases/download/v2.7.0/osv-scanner_linux_amd64 /usr/local/bin/osv-scanner
COPY Backend/package*.json ./
RUN npm ci --omit=dev
COPY Backend/server.js ./
COPY Backend/src ./src
COPY --from=frontend /frontend/dist ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
