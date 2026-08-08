# IEM HACKS - Monorepo Setup

A monorepo containing a **NestJS backend** and a **Vite + React (TypeScript) frontend**, managed with **npm workspaces**.

## Structure

```
.
├── apps/
│   ├── backend/          # NestJS 11 API (@iem-hacks/backend)
│   │   ├── src/          # modules, schemas, scripts/seed.ts
│   │   └── .env          # MONGO_URI, OPENAI_API_KEY, VAPI_* (gitignored)
│   └── frontend/         # Vite 8 + React 19 (@iem-hacks/frontend)
│       ├── src/
│       └── .env          # VITE_VAPI_PUBLIC_KEY (gitignored)
├── docker-compose.yml    # MongoDB 7 on host port 27018 (container iem-hacks-mongo)
├── package.json          # npm workspaces (apps/*) + shared scripts
├── .gitignore
└── .nvmrc                # Node 20
```

## Prerequisites

- Node.js **>= 20** (recommended: use `.nvmrc`, e.g. `nvm use`)
- npm **>= 10**
- Docker (for MongoDB)

## Installation

```bash
npm install
cp apps/backend/.env.example apps/backend/.env    # then edit MONGO_URI → port 27018
cp apps/frontend/.env.example apps/frontend/.env  # add VITE_VAPI_PUBLIC_KEY
```

Runs a single install at the root; npm hoists shared dependencies for all workspaces.

## Database

```bash
docker compose up -d        # starts iem-hacks-mongo on 127.0.0.1:27018
```

Seed demo data (doctors, patients, call-back queue, pending AI-verification tasks):

```bash
npm run seed --workspace @iem-hacks/backend
```

All demo accounts use the password **`demo123`**:

| Role     | Phone          |
| -------- | -------------- |
| Patient  | +919876543210  |
| Patient  | +919876543211  |
| Doctor   | +919800000001  |

## Configuration

- Backend env: `apps/backend/.env` — set `OPENAI_API_KEY` for real AI answers (chat, document analysis, certificate drafting). Leave blank for a placeholder that lets the server boot.
- Vapi (voice): the assistant is created/updated **automatically** — no dashboard steps needed:
  1. Put your private key in `apps/backend/.env` as `VAPI_API_KEY=` (from Vapi dashboard → Accounts).
  2. Run `npm run vapi:setup --workspace @iem-hacks/backend`. It upserts the "MedAssist AI Triage Assistant" (OpenAI + multilingual Deepgram + Vapi voice) and writes `VAPI_ASSISTANT_ID` back into `.env`.
  3. Put your public key in `apps/frontend/.env` as `VITE_VAPI_PUBLIC_KEY=`. The chat page shows a call button only when configured.
  - Phone calls (optional): set `VAPI_WEBHOOK_URL=https://<your-tunnel>/api/calls/vapi/webhook` (ngrok) and `VAPI_WEB_SECRET=`, then re-run `vapi:setup` so the webhook is attached to the assistant. Browser calls work without this.
  - The chat page's language selector (English/हिन्दी/বাংলা) is passed to voice calls automatically — the assistant speaks the selected language.

## Running the apps

### Both apps at once (development)

```bash
npm run dev
```

Starts with `concurrently`:
- Backend: `http://localhost:3000` (watch mode)
- Frontend: `http://localhost:5173` (HMR)

### Individually

```bash
npm run start:dev:backend   # NestJS watch mode on :3000
npm run start:dev:frontend  # Vite dev server on :5173
```

## Building

```bash
npm run build          # builds all workspaces
npm run build:backend  # outputs to apps/backend/dist
npm run build:frontend # outputs to apps/frontend/dist
```

## API ↔ Frontend wiring

The backend registers a global prefix: all controllers are served under `/api` (e.g. `GET http://localhost:3000/api`).

The Vite dev server proxies any `/api/*` request to the backend, so from the frontend you can simply call:

```ts
fetch('/api/health');
```

No CORS issues during development (proxy + `enableCors()` are already configured).

## Useful commands

| Command             | Description                          |
| ------------------- | ------------------------------------ |
| `npm run lint`      | Lint all workspaces (if present)     |
| `npm test`          | Run backend Jest unit tests          |
| `npm run test:e2e`  | Run backend e2e tests                |

## Adding a new package

Add a new app under `apps/` and run `npm install` from the root to register it as a workspace. Nest resources can be generated with:

```bash
cd apps/backend
npx @nestjs/cli generate resource <name>
```
