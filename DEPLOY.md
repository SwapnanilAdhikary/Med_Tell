# Deploying MedAssist (Vercel free + MongoDB Atlas)

This guide covers production deployment of the **NestJS backend** and **Vite frontend** on Vercel's free (Hobby) tier, seeding a demo MongoDB database, and **upserting** (not recreating) the two Vapi voice assistants.

## Architecture

| Component | Host | Notes |
|---|---|---|
| Frontend | Vercel project #1 (`apps/frontend`) | Static SPA; calls backend via `VITE_API_URL` |
| Backend API | Vercel project #2 (`apps/backend`) | Serverless NestJS at `/api/*` |
| Database | MongoDB Atlas M0 (free) | Connection string in `MONGO_URI` |
| Voice | Vapi | Assistants updated in-place; IDs stored in env vars |

Create **two Vercel projects** from the same Git repo, each with a different **Root Directory**.

## 0. Prerequisites

- Node 20+ (see `.nvmrc`)
- MongoDB Atlas cluster (free M0)
- Vapi account with existing assistants (or create once in dashboard)
- OpenAI API key (chat, documents, certificates)

## 1. MongoDB Atlas

1. Create a free M0 cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. Database Access → add a user with read/write on your database.
3. Network Access → allow `0.0.0.0/0` (required for Vercel serverless egress).
4. Copy the connection string, e.g.  
   `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/iem-hacks?retryWrites=true&w=majority`

## 2. Seed the database

Run locally against Atlas (do **not** commit `.env` with secrets):

```bash
# apps/backend/.env
MONGO_URI=mongodb+srv://...
JWT_SECRET=<long-random-string>
OPENAI_API_KEY=sk-...

# Base demo data (users, doctors, verification queue, field reports)
npm run seed --workspace @iem-hacks/backend

# Extra volume: ~48 geo-scattered field reports for map/list demos
npm run seed:bulk --workspace @iem-hacks/backend
```

All demo logins use password **`demo123`**:

| Role | Phone |
|---|---|
| Patient | +919876543210 |
| Doctor | +919800000001 |
| ASHA worker | +919700000001 |

The seed script also **dedupes conversations** per patient (needed before the unique index on `Conversation.patient`).

Re-running seed is safe — it only inserts missing records.

## 3. Vapi assistants (upsert, not new)

You already have assistant IDs in Vapi. Pin them in env and **patch** them — never POST duplicates.

```bash
# apps/backend/.env
VAPI_API_KEY=<private key from dashboard.vapi.ai>
VAPI_ASSISTANT_ID=<existing patient triage assistant id>
VAPI_ASHA_ASSISTANT_ID=<existing ASHA field assistant id>

# Upsert both profiles; prints IDs, does not write .env
npm run vapi:setup:prod --workspace @iem-hacks/backend
npm run vapi:setup:asha:prod --workspace @iem-hacks/backend
```

For production webhook (phone calls only — browser calls do not need this):

```bash
VAPI_WEBHOOK_URL=https://<your-backend>.vercel.app/api/calls/vapi/webhook
VAPI_WEB_SECRET=<optional signing secret>
```

Re-run setup after changing webhook URL so the assistant is patched.

Flags used in prod scripts:

| Flag | Effect |
|---|---|
| `--upsert-only` | Refuses to create a new assistant if none matches name/ID |
| `--no-write-env` | Prints `VAPI_*=` lines for copy-paste into Vercel env |

## 4. Deploy backend (Vercel project #2)

**Vercel → New Project → import repo**

| Setting | Value |
|---|---|
| Root Directory | `apps/backend` |
| Framework Preset | Other |
| Build Command | _(from vercel.json — compiles NestJS to `dist/` for the serverless function)_ |
| Output Directory | _(leave blank — API-only, no static site)_ |
| Install Command | _(from vercel.json — monorepo root install with dev deps)_ |

### Backend environment variables

Set these in Vercel → Project → Settings → Environment Variables:

```
MONGO_URI=mongodb+srv://...
JWT_SECRET=<same as seed>
JWT_EXPIRES_IN=7d
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_VISION_MODEL=gpt-4o-mini
VAPI_API_KEY=...
VAPI_ASSISTANT_ID=...
VAPI_ASHA_ASSISTANT_ID=...
VAPI_WEBHOOK_URL=https://<backend-host>/api/calls/vapi/webhook   # optional
VAPI_WEB_SECRET=...                                               # optional
CORS_ORIGIN=https://<frontend-host>.vercel.app
NODE_ENV=production
```

After deploy, verify:

```bash
curl https://<backend-host>.vercel.app/api/health
```

### Backend limitations on Vercel free

- **10 s** function timeout — long OpenAI chains may fail; chat usually fits.
- **Ephemeral disk** — signed PDFs live under `/tmp` and may not survive cold starts. Demo seeded data and in-session signing still work; do not rely on persistent PDF storage without external object storage.
- **No Docker Mongo** — use Atlas only.

## 5. Deploy frontend (Vercel project #1)

| Setting | Value |
|---|---|
| Root Directory | `apps/frontend` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `cd ../.. && npm install` |

### Frontend environment variables

```
VITE_API_URL=https://<backend-host>.vercel.app
VITE_VAPI_PUBLIC_KEY=<public key from Vapi dashboard>
VITE_MAPBOX_TOKEN=pk....   # optional, for /field/map
```

`VITE_API_URL` must match the backend origin **without** a trailing slash. In dev, leave it blank — Vite proxies `/api` to `localhost:3000`.

After deploy, open the frontend URL and log in with a seeded account.

## 6. Post-deploy checklist

- [ ] `GET /api/health` returns OK on backend URL
- [ ] Frontend login works (CORS + JWT)
- [ ] Doctor verification queue shows seeded pending tasks
- [ ] ASHA worker `/field/reports` lists seeded field reports
- [ ] Voice call button appears when `VITE_VAPI_PUBLIC_KEY` is set
- [ ] Browser voice call completes and routes to doctor queue

## 7. Useful commands (local)

```bash
npm run dev                              # both apps
npm run build                            # build all workspaces
npm run seed --workspace @iem-hacks/backend
npm run seed:bulk --workspace @iem-hacks/backend
npm run vapi:setup:prod --workspace @iem-hacks/backend
npm run vapi:setup:asha:prod --workspace @iem-hacks/backend
```

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `nest: command not found` on build | Ensure install uses `--include=dev` (see `apps/backend/vercel.json`) so `@nestjs/cli` is installed |
| No Output Directory named `public` | Set Output Directory to blank in Vercel dashboard, or rely on `"outputDirectory": null` in `vercel.json` |
| CORS error in browser | Set `CORS_ORIGIN` on backend to exact frontend URL (no path) |
| 401 on all API calls | Check `JWT_SECRET` matches between seed and deployed backend |
| Duplicate Vapi assistants | Always set `VAPI_ASSISTANT_ID` / `VAPI_ASHA_ASSISTANT_ID` before running setup; use `--upsert-only` |
| Mongo `E11000` on conversations | Re-run seed (dedupes) or manually remove duplicate `conversations` per patient |
| PDF download 404 after cold start | Expected on Vercel free — PDF was in `/tmp`. Re-sign or use local backend for PDF demos |
