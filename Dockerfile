FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="OWASP PTK Playground" \
      org.opencontainers.image.description="Deliberately vulnerable browser-security playground for authorised local testing" \
      org.opencontainers.image.source="https://github.com/ptklabs/ptk-playground" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update \
    && apt-get install --yes --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/ptk-playground

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY --chown=node:node . .

ENV NODE_ENV=production \
    PTK_PLAYGROUND_HOST=0.0.0.0 \
    PTK_PASSIVE_HTTP_PORT=3080 \
    PTK_PASSIVE_HTTPS_PORT=3443

USER node

EXPOSE 3080 3443

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3080/healthz').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "passive/server.mjs"]
