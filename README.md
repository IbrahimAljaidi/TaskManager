# TaskFlow

TaskFlow is a browser-owned project and task workspace with a FastAPI OpenRouter copilot. It has no account or server task database. Projects, tasks, draft proposals, theme and chat history persist in localStorage on the current device.

## Local development

Requirements: Node 22, Python 3.12+, uv. In separate terminals:

```powershell
cd backend
uv sync --frozen
$env:TASKFLOW_DEV_CORS="true"
$env:OPENROUTER_API_KEY="<your local key>"  # optional for non-AI features
uv run uvicorn app.main:app --reload --port 8000
```

```powershell
cd frontend
npm ci
$env:NEXT_PUBLIC_API_BASE_URL="http://localhost:8000"
npm run dev
```

Open http://localhost:3000. A key is required only for live copilot requests. Never put it in a `NEXT_PUBLIC_` variable. Task context and conversation excerpts are sent to OpenRouter when you use the copilot.

## Features

- Multiple local projects, selected project scope, separate project dashboard and analytics.
- Shared task store for Kanban and list, with task details, checklist, notes, dates, labels, priority, search, filter, sort and drag/drop.
- Dark and light modes, mobile layout, keyboard accessible controls.
- Copilot uses OpenRouter tool calls. FastAPI asks the model for calls and sends signed, short-lived continuation state to the browser. The browser validates and executes calls in its task store and returns results for model continuation. Bulk/deletion requests require explicit approval. AI project proposals open an editable approval screen and create projects atomically.

## Checks

```powershell
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test
cd ../backend
uv run ruff check .
uv run pytest
cd ..
uv run --with pypdf python scripts/check_company_integrity.py
docker build -t taskflow:local .
docker run -d --env-file .env --name taskflow-local -p 8080:8080 taskflow:local
```

## Single-container runtime

The production image builds Next.js as a static export, then runs one non-root FastAPI process. FastAPI serves `/`, `/_next/*`, and `/api/*` on the same socket. The image defaults to port 8080; uvicorn and the Docker health check both follow the runtime `PORT` variable. Production frontend calls use same-origin `/api` because the build sets `NEXT_PUBLIC_API_BASE_URL` to an empty string.

```powershell
docker build -t taskflow:local .
docker run -d --env-file .env --name taskflow-local -p 8080:8080 taskflow:local
# In another terminal:
Invoke-RestMethod http://localhost:8080/api/health
Invoke-WebRequest http://localhost:8080/ -UseBasicParsing
```

Docker does not read the root `.env` automatically for `docker run`; `--env-file .env` injects it when the container is created. If you edit `.env`, recreate only `taskflow-local` to apply the new values; `docker start` retains the previous environment. The file is excluded by `.gitignore` and `.dockerignore`, while `.env.example` is allowed as a template. Runtime variables are not baked into the image or frontend, though users with Docker daemon access can inspect a container's environment. Restrict access to your local Docker installation.

For a different ingress port, set and publish the same value, for example `docker run -d --env-file .env -e PORT=8090 -p 8090:8090 taskflow:local`. Cloud Run supplies `PORT` to the ingress container (default 8080); this image listens on `0.0.0.0:$PORT`. Keep `TASKFLOW_DEV_CORS` unset in production. Configure `OPENROUTER_API_KEY` and a stable `TASKFLOW_SIGNING_KEY` as backend-only secrets. `OPENROUTER_MODEL` is optional. The Docker `HEALTHCHECK` probes `/api/health`; configuring a Cloud Run HTTP startup/liveness probe is a separate service configuration step.

## Security and deployment boundary

The anonymous LLM API has request and rate limits, but these are not strong per-user protection and an exposed public endpoint can incur provider costs. The signing key defaults to a per-process random value; set `TASKFLOW_SIGNING_KEY` consistently for a multi-instance runtime. Browser-executed results are reported by the client and cannot be independently verified by a server without authoritative server storage.

The five original company workflow/Terraform files are preserved exactly. **Do not publish this repository with those workflows enabled.** The original deployment triggers on every branch push and has unsafe secret handling and automatic destroy behavior. See [deployment compatibility](docs/DEPLOYMENT-COMPATIBILITY.md) for the required separate review and proposed patch. No GitHub or GCP setup is performed here.
