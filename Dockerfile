FROM python:3.13-alpine AS base
# Pull patched Alpine packages (zlib, expat, musl, sqlite, libxml2, ...) on top of
# the base image so the image does not wait for an upstream base rebuild.
RUN apk upgrade --no-cache
WORKDIR /opt/hyperglass
ENV HYPERGLASS_APP_PATH=/etc/hyperglass
ENV HYPERGLASS_HOST=0.0.0.0
ENV HYPERGLASS_PORT=8001
ENV HYPERGLASS_DEBUG=false
ENV HYPERGLASS_DEV_MODE=false
ENV HYPERGLASS_REDIS_HOST=redis
ENV HYPERGLASS_DISABLE_UI=false
ENV HYPERGLASS_CONTAINER=true
# Python dependencies live in a virtual environment so the final stage can copy
# them without the compilers used to build them.
ENV VIRTUAL_ENV=/opt/venv
ENV PATH=/opt/venv/bin:$PATH

# Build stage: install the UI's node_modules. npm and pnpm stay in this stage.
FROM base AS ui
WORKDIR /opt/hyperglass/hyperglass/ui
# hyperglass/ui/.npmrc pins store-dir to /opt/hyperglass/.pnpm-store.
ENV PNPM_CONFIG_STORE_DIR=/opt/hyperglass/.pnpm-store
COPY hyperglass/ui/package.json hyperglass/ui/pnpm-lock.yaml hyperglass/ui/pnpm-workspace.yaml hyperglass/ui/.npmrc ./
RUN apk add --no-cache nodejs npm \
  && npm install -g pnpm@11.28.11 \
  && pnpm install --frozen-lockfile

# Build stage: install the pinned Python dependency set from the lockfile (the
# single source of truth). The lock includes the UI extra required by this full
# application image. Packages without a musl wheel compile here.
FROM base AS python
COPY requirements.lock ./
# Rye includes the editable project itself; it is installed in the final stage.
RUN apk add --no-cache build-base pkgconfig cairo-dev \
  && python3 -m venv "$VIRTUAL_ENV" \
  && sed '/^-e file:\.$/d' requirements.lock > /tmp/hyperglass-dependencies.lock \
  && pip3 install --no-cache-dir --no-deps -r /tmp/hyperglass-dependencies.lock \
  && rm /tmp/hyperglass-dependencies.lock

FROM base AS hyperglass
# Runtime libraries only. The UI is built on first start with `next build`,
# which needs Node.js but not npm, pnpm or a compiler: node_modules is installed
# at image build time and linked into the build workspace, and sharp's build
# script is disabled (hyperglass/ui/pnpm-workspace.yaml). CairoSVG loads the
# cairo shared library at runtime through cairocffi.
RUN apk add --no-cache nodejs cairo \
  && addgroup -S -g 10001 hyperglass \
  && adduser -S -D -u 10001 -G hyperglass -h /home/hyperglass -s /sbin/nologin hyperglass \
  && mkdir -p /etc/hyperglass \
  && chown hyperglass:hyperglass /etc/hyperglass
COPY --from=python /opt/venv /opt/venv
COPY --from=ui /opt/hyperglass/hyperglass/ui/node_modules /opt/hyperglass/hyperglass/ui/node_modules

# Application edits do not invalidate either dependency installation layer.
COPY . .
# Nothing installs packages at runtime, so pip goes after the editable install.
# User plugins are copied into hyperglass/plugins/external when they load, so
# that directory belongs to the runtime user. The rest of /opt stays root-owned.
RUN pip3 install --no-cache-dir -e . --no-deps \
  && rm -rf /root/.cache/pip \
    /opt/venv/lib/python3.13/site-packages/pip \
    /opt/venv/lib/python3.13/site-packages/pip-*.dist-info \
    /opt/venv/bin/pip /opt/venv/bin/pip3 /opt/venv/bin/pip3.13 \
    /usr/local/lib/python3.13/site-packages/pip \
    /usr/local/lib/python3.13/site-packages/pip-*.dist-info \
    /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.13 \
  && chown hyperglass:hyperglass /opt/hyperglass/hyperglass/plugins/external

# A fixed UID/GID lets operators chown a bind-mounted /etc/hyperglass to match.
USER 10001:10001
EXPOSE ${HYPERGLASS_PORT}
# GET /api/health on the configured listen address: Redis, configuration state
# and the built UI. The UI is built on first start, before the server listens,
# which can take several minutes; failures during the start period do not count.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10m --retries=3 \
  CMD ["python3", "-m", "hyperglass.console", "healthcheck"]
CMD ["python3", "-m", "hyperglass.console", "start"]
