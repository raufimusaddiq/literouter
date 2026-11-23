# syntax=docker/dockerfile:1.7
ARG BUN_IMAGE=oven/bun:1.4.4-alpine
ARG ALPINE_IMAGE=alpine:3.22

# Runs on the build host and cross-compiles the musl target, so arm64 needs no emulation here.
FROM --platform=$BUILDPLATFORM ${BUN_IMAGE} AS builder
ARG TARGETARCH
WORKDIR /app
ENV BUN_CONFIG_REGISTRY=https://registry.npmmirror.com

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . ./
RUN case "$TARGETARCH" in \
      amd64) target=bun-linux-x64-musl ;; \
      arm64) target=bun-linux-arm64-musl ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
  bun scripts/build.mjs --compile "$target" --outfile /out/literouter

FROM ${ALPINE_IMAGE} AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="LiteRouter"

RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories && \
  apk --no-cache upgrade && apk --no-cache add libstdc++ libgcc ca-certificates su-exec && \
  addgroup -g 1000 -S literouter && adduser -S -u 1000 -G literouter -h /home/literouter literouter

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV DATA_DIR=/app/data
ENV LITEROUTER_SYSTEM_CA=1

COPY --from=builder /out/literouter /app/literouter

RUN mkdir -p /app/data /app/data-home && chown -R literouter:literouter /app && \
  ln -sf /app/data-home /root/.9router 2>/dev/null || true

RUN printf '#!/bin/sh\nchown -R literouter:literouter /app/data /app/data-home 2>/dev/null\nexec su-exec literouter "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/app/literouter"]
