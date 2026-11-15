# syntax=docker/dockerfile:1
#
# One image, one process: the Go API also serves the built frontend, so there is
# no nginx/Caddy sidecar to wire up.
#
#   docker build -t virtual-office .
#   docker run --rm -p 8080:8080 -v ~/.hermes:/hermes:ro -e HERMES_HOME=/hermes virtual-office
#
# Build args: VERSION stamps /api/health and the X-Office-Commit header.

FROM golang:1.23-alpine AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath \
      -ldflags "-s -w -X officeapi/internal/api.BuildCommit=${VERSION}" \
      -o /out/office-api ./cmd/office-api

FROM node:20-alpine AS web
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM alpine:3.20
# ca-certificates: OFFICE_SOURCE=remote talks HTTPS. The IANA tz database is
# embedded in the binary (time/tzdata), so OFFICE_TZ works without tzdata.
RUN apk add --no-cache ca-certificates \
 && adduser -D -H -u 10001 office

COPY --from=api /out/office-api /usr/local/bin/office-api
COPY --from=web /src/dist /app/web

ENV HERMES_HOME=/hermes \
    PORT=8080 \
    BIND=0.0.0.0 \
    WEB_DIR=/app/web \
    OFFICE_SOURCE=local

USER office
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/office-api"]
