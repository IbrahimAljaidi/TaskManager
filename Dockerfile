# syntax=docker/dockerfile:1.7
# TaskFlow single-image plan: one Cloud Run container runs FastAPI, serving Next static export.
# Original company GitHub workflow remains UNCHANGED and calls `docker build .` at repo root.
# Lockfiles are included for reproducible frontend and backend builds.

FROM node:22-bookworm-slim AS frontend-deps
WORKDIR /workspace/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /workspace/frontend
ENV NEXT_TELEMETRY_DISABLED=1
# Keep production API same-origin, never bake developer localhost into static JS.
ENV NEXT_PUBLIC_API_BASE_URL=""
COPY --from=frontend-deps /workspace/frontend/node_modules ./node_modules
COPY frontend/ ./
RUN npm run build && test -f out/index.html

FROM python:3.12-slim AS python-deps
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
ENV UV_PYTHON_DOWNLOADS=0 UV_LINK_MODE=copy
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080 \
    PATH="/app/backend/.venv/bin:$PATH" \
    TASKFLOW_STATIC_DIR=/app/frontend/out
WORKDIR /app
RUN groupadd --system taskflow && useradd --system --gid taskflow --uid 10001 --create-home taskflow
COPY --from=python-deps --chown=taskflow:taskflow /app/backend/.venv /app/backend/.venv
COPY --chown=taskflow:taskflow backend/app /app/backend/app
COPY --from=frontend-build --chown=taskflow:taskflow /workspace/frontend/out /app/frontend/out
WORKDIR /app/backend
USER taskflow
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8080') + '/api/health', timeout=3)" || exit 1
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
