# Frontend implementation location

Codex: create `frontend/package.json` and `frontend/package-lock.json`, `src/app/layout.tsx`, `src/app/page.tsx`, assets, full modular components, state, tests. Start from selected design `../references/design/taskflow-ui-reference.png`.

Use Next.js static export and client-side routing/selection for user-created project IDs. All runtime API requests go to FastAPI `/api/*`. No Next.js server actions or runtime API routes.

For development on localhost:3000 use public non-secret `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` (never use this for API keys). Production build default empty `NEXT_PUBLIC_API_BASE_URL` for same-origin relative `/api/*`.

Do not claim Docker build works until package lock and full UI exist and real commands pass.
