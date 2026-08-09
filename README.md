# MedAssist

AI-agentic telemedicine monorepo: NestJS backend + Vite/React frontend, serving three roles — patient, doctor, and ASHA/ANM field health worker.

## Prerequisites

- Node.js >= 20
- Docker (for MongoDB) — or a local `mongod` on port 27017
- An OpenAI API key (chat + vision)
- Optional: a Vapi account (voice calls), a Mapbox token (worker report map)

## 1. Install dependencies

```bash
npm install
```

This installs both workspaces (`apps/backend`, `apps/frontend`) via npm workspaces.

## 2. Start MongoDB

```bash
docker compose up -d
```

This runs Mongo 7 on `localhost:27018` (mapped from the container's `27017`).

## 3. Configure environment variables

Copy the example env files and fill them in:

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

**`apps/backend/.env`** — required:
- `MONGO_URI` — defaults to `mongodb://127.0.0.1:27018/iem-hacks`, matching `docker-compose.yml`
- `JWT_SECRET` — change from the placeholder
- `OPENAI_API_KEY` — required for chat, vision, and AI-council prescription drafting
- `OPENAI_MODEL` / `OPENAI_VISION_MODEL` — default to `gpt-4o-mini`

Optional (voice / maps):
- `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_ASHA_ASSISTANT_ID`, `VAPI_WEB_SECRET` — only needed for voice calls
- `VITE_VAPI_PUBLIC_KEY` (frontend) — pairs with the backend Vapi assistant
- `VITE_MAPBOX_TOKEN` (frontend) — powers `/field/map`; left blank it just shows a "not configured" card

**`apps/frontend/.env`** — `VITE_API_URL` can be left blank in dev (the frontend proxies to the backend automatically).

## 4. Seed demo data

```bash
npm run seed
```

Creates demo patients, doctors, an ASHA worker, and facilities (Murshidabad, WB). **All seeded accounts use the password `demo123`.**

Key demo logins:

| Role | Name | Phone |
|---|---|---|
| Doctor | Ananya Banerjee | `+919800000001` |
| Doctor | Rohan Mehta | `+919800000002` |
| Doctor | Sneha Iyer | `+919800000003` |
| Doctor | Kavita Ghosh | `+919800000004` |
| ASHA worker | Anjali Roy | `+919700000001` |
| Patient | Priya Sharma | `+919876543210` |

## 5. Run the app

```bash
npm run dev
```

Runs backend (`http://localhost:3000`, API prefixed `/api`) and frontend (Vite dev server) concurrently. Or run them separately:

```bash
npm run start:dev:backend
npm run start:dev:frontend
```

## Optional: voice setup (Vapi)

```bash
npm run vapi:setup --workspace @iem-hacks/backend         # patient voice assistant
npm run vapi:setup:asha --workspace @iem-hacks/backend    # ASHA field-report assistant
```

Writes the created assistant ID back into `apps/backend/.env`. Phone-in calls additionally need a public webhook URL (`VAPI_WEBHOOK_URL`, e.g. via ngrok in dev).

## Tests

```bash
npm test --workspace @iem-hacks/backend
```
Prod Link - https://med-tell-frontend.vercel.app
