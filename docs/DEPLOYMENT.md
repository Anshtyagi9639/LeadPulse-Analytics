# Deployment guide

> **Status:** not deployed. Per the project brief, deployment waits for your approval of the locally tested build.
> This guide describes a deployment that is compatible with the temporary-session design.

## Architecture constraints that drive the hosting choice

- Report sessions live **in the memory of one Express process**, with uploads in a restricted temporary directory on
  that machine. There is deliberately no database of leads.
- Therefore the backend must run as **a single long-lived Node.js process** (one instance / one replica).
  Serverless functions (Vercel/Netlify functions, AWS Lambda) and multi-replica autoscaling are **not compatible**:
  each request could land on a different instance with a different memory and filesystem, and sessions would
  appear to vanish.
- The frontend is a static/SSR Next.js app and can be hosted anywhere (it holds no lead data).

### Recommended topology

| Part | Host | Notes |
|---|---|---|
| Frontend (Next.js) | Vercel, Netlify, or any Node host (`next start`) | Set `NEXT_PUBLIC_API_URL` to the backend's HTTPS URL **before building**. |
| Backend (Express) | One always-on container/VM: Render/Railway/Fly.io **with 1 instance**, AWS Lightsail/EC2, Azure App Service (1 instance, ARR affinity on), or a VPS behind Nginx/Caddy | Ephemeral local disk is fine. Allocate ≥ 1 GB RAM (parsing runs in a worker with `PARSE_MEMORY_MB`). |

If you later need sessions to survive restarts or to run several backend replicas, move session state and uploads to
a **temporary store with automatic expiry** (e.g. Redis with TTL for session metadata + an object-storage bucket with a
1-day lifecycle rule for uploads). It must still expire automatically and must not become a lead database. This is not
implemented today; a restart currently ends all active sessions (users see "session no longer available").

## Frontend on Vercel (monorepo)

The repository is an npm-workspaces monorepo: the Next.js app is in `frontend/`, the Express API in `backend/`.
Vercel must build **only** `frontend/`; the root `package.json` is a workspace wrapper, not a Next.js app (building the
repository root yields no pages and every URL returns `404 NOT_FOUND`).

Vercel → Project `leadpulseanalytics` → Settings:

| Setting | Value |
|---|---|
| Root Directory | `frontend` (keep "Include files outside the root directory" **on** so the workspace lockfile is used) |
| Framework Preset | Next.js |
| Build Command | default (`next build`, from `frontend/package.json`) |
| Output Directory | default (leave empty — Next.js on Vercel is not a static export) |
| Install Command | default |
| Node.js Version | 20.x or 22.x |
| Environment variable | `NEXT_PUBLIC_API_URL` = HTTPS URL of the deployed backend (Production + Preview). It is baked in at build time, so redeploy after changing it. |

No `vercel.json`, rewrites or redirects are needed. Without `NEXT_PUBLIC_API_URL` the site loads but shows a
"Reporting server not configured" banner (there is no localhost fallback in production builds).

The Express backend cannot run on Vercel Functions (it keeps sessions in memory, uses worker threads and temp files and
must be a single long-lived process). Deploy it separately (see below) with
`CORS_ORIGINS=https://leadpulseanalytics.vercel.app` and `OPENAI_API_KEY` as a server-side secret.

## Backend

```bash
cd backend
npm ci            # or `npm ci` at the repo root (workspaces)
npm run build     # tsc + copies the parse worker into dist/
NODE_ENV=production PORT=4000 CORS_ORIGINS=https://reports.example.com TRUST_PROXY=1 node dist/index.js
```

Environment variables: see `backend/.env.example`. Production checklist:

- `CORS_ORIGINS` = the exact frontend origin(s) (no `*`).
- `TRUST_PROXY=1` when behind a load balancer / reverse proxy so rate limits use the client IP.
- `TEMP_DIR` on local ephemeral disk, **not** inside any web-served directory. The API never serves files from it;
  downloads are generated on demand from memory.
- `OPENAI_API_KEY` only as a server-side secret (platform secret manager). Never in the frontend.
- Health check path: `GET /api/health` (returns `{"status":"ok",…}`).
- On `SIGTERM`/`SIGINT` the server deletes all temporary session data before exiting.
- Abandoned temp directories from crashed processes are removed at start-up and every `CLEANUP_INTERVAL_MINUTES`
  once older than `SESSION_TTL_HOURS`.

### HTTPS

Terminate TLS at the platform or a reverse proxy. Example Caddy site:

```
api.reports.example.com {
  reverse_proxy 127.0.0.1:4000
  request_body {
    max_size 320MB   # MAX_FILE_SIZE_MB × MAX_FILES_PER_SESSION, plus overhead
  }
}
```

With Nginx set `client_max_body_size` similarly and `proxy_read_timeout 300s` for large uploads.

## Frontend

```bash
cd frontend
NEXT_PUBLIC_API_URL=https://api.reports.example.com npm run build
npm run start -- -p 3000
```

On Vercel: set `NEXT_PUBLIC_API_URL` in Project → Environment Variables, root directory `frontend`, then deploy.

## Post-deployment verification

1. `curl https://api.reports.example.com/api/health` → `status: ok`.
2. Open the frontend, upload the files in `samples/`, process all, and compare the dashboard with the local run.
3. Download Excel, CSV and PDF.
4. Confirm a request from another origin is not granted CORS (`Access-Control-Allow-Origin` absent).
5. Clear the session and confirm the session directory under `TEMP_DIR` is gone.
6. If AI is enabled, run one "Summarise today" request.

## Rollback

- Keep the previous build artifact / container image tag. Roll back by redeploying that tag (backend) and promoting
  the previous deployment (Vercel/Netlify keep history).
- No data migration is involved: there is no database. Saved mapping templates (`CONFIG_DIR/mapping-templates.json`)
  are forward/backward compatible; back the file up before upgrading if you rely on templates.
- A backend restart/rollback ends active reporting sessions; schedule deployments outside reporting hours and tell
  users to download reports first.

## Known limitations

- Sessions do not survive a backend restart or move between instances (see above).
- Dates are interpreted as local wall-clock times; timezone suffixes in source data (`Z`, `+05:30`) are ignored.
- Ambiguous numeric dates (e.g. `05/06/2026` throughout a column) default to day/month/year and are flagged; users
  can override the date format per file.
- PDF output uses standard PDF fonts (Latin-1). Non-Latin characters (e.g. Devanagari campaign names) are replaced
  with `?` in the PDF only; Excel/CSV keep them.
- Status classification (qualified, contacted, applied, …) uses keyword rules documented in `KPI_DEFINITIONS.md`.
  CRM-specific status vocabularies outside those rules show up as pending/unknown rather than being guessed.
