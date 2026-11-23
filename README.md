# StudySync — Peer Code-Review & Assignment Workspace

StudySync is a full-stack, distributed web application for collaborative academic peer code reviews and assignment submissions, built for CSC436.

## Architecture Baseline

- **Frontend**: React 18 + TypeScript with Vite under `strict` mode.
- **Backend**: Node.js 22 + Express + TypeScript executed with `tsx` under `strict` mode.
- **Datastores**: PostgreSQL 16 (relational persistence, schema migrations, and append-only audit trail) and Redis 7 (rate limiting, caching, and pub/sub events).
- **Security Baseline**: `helmet`, explicit `cors` origin control, non-root processes, structured error payload.

---

## Directory Layout

```text
CSC436_Final/
├── backend/
│   ├── src/
│   │   └── server.ts          # Express baseline, /healthz route, centralized error handler
│   ├── package.json
│   └── tsconfig.json          # strict: true, noImplicitAny, etc.
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Public landing view, search/filter, loading/empty/error states
│   │   ├── index.css
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json          # strict: true
│   └── vite.config.ts         # Vite bundler config with backend proxy
├── docker-compose.yml         # Local PostgreSQL and Redis setup
├── .env.example               # Environment variables template
├── .gitignore
├── package.json               # Root workspace orchestrator
└── README.md
```

---

## Prerequisites

- **Node.js**: v20+ (tested on Node.js v22.21.0)
- **npm**: v10+ (tested on npm 11.14.1)
- **Docker & Docker Compose** (for PostgreSQL and Redis persistence)

---

## Getting Started

### 1. Install Dependencies
From the repository root:
```bash
npm install
```

### 2. Configure Environment
Copy the example environment configuration:
```bash
cp .env.example .env
```

### 3. Start Backing Infrastructure (PostgreSQL & Redis)
```bash
docker compose up -d
```

### 4. Run Development Servers
You can run the backend and frontend separately or simultaneously:

- **Start Backend** (Express on `http://localhost:4000`):
  ```bash
  npm run dev:backend
  ```
- **Start Frontend** (Vite on `http://localhost:5173`):
  ```bash
  npm run dev:frontend
  ```

---

## Verification & Health Check

- Backend health check:
  ```bash
  curl -i http://localhost:4000/healthz
  ```
- Strict type check across all workspaces:
  ```bash
  npm run typecheck
  ```

