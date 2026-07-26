# PDTC — Personal Data Tagging & Classification Workbench

A metadata governance workbench for **Abu Dhabi Customs (ADC)** that operationalises the
ADC Personal Data Tagging Policy Framework (DGO-FM-002-01). PDTC ingests data asset and
attribute metadata exported from **IBM Knowledge Catalog (IKC)**, runs two engines over
that metadata — a **PII Detection Engine** (flags personal data and maps every flag to one
of the five policy criteria) and a **Classification Engine** (derives attribute-level
confidentiality labels and rolls them up to asset level) — routes results through a data
steward review queue, records an immutable audit trail of every decision, and prepares
confirmed tags for write-back to IKC.

> **Metadata-only guarantee.** PDTC never reads data *values*. It reasons exclusively over
> metadata (column names, descriptions, data types, asset context). The AI provider wrapper
> enforces this with `assertNoDataValues()`, which the PII engine calls before every model
> request — so no customs data leaves the ADC boundary. The AI endpoint is OpenAI-API
> compatible and intended to run against a **local / self-hosted** model (Ollama / vLLM /
> LiteLLM) for data sovereignty.

---

## Key commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Dev server — `tsx server/index.ts` with Vite middleware (HMR). App at `http://localhost:5000/pdtc/` |
| `npm run build` | `vite build` → `dist/public`, then esbuild bundles the server → `dist/index.cjs` |
| `npm start` | Run the production bundle (`node dist/index.cjs`) |
| `npm run check` | Type-check (`tsc`, no emit) |
| `npm run lint` | ESLint (flat config) |
| `npm test` | Run the Vitest suite |
| `npm run db:push` | Push the schema straight to the DB (dev convenience) |
| `npm run db:generate` | Generate SQL migrations from `shared/models/schema.ts` |
| `npm run db:migrate` | Apply migrations (used by the Docker `migrate` service) |
| `docker-compose up` | `db` (Postgres 16) + `migrate` (one-shot) + `app` (port 5000) |

The whole app — API **and** the built SPA — is served by **one Express server**. There is
no separate frontend host. In dev, Vite is attached as middleware; in prod, the server
serves `dist/public` statically. Everything lives under the base path **`/pdtc/`**.

## Getting started (local)

```bash
cp .env.example .env          # then edit as needed
npm install
docker compose up -d db       # or point DATABASE_URL at your own Postgres 16
npm run db:push               # create tables
npm run dev                   # http://localhost:5000/pdtc/
```

Default seeded admin: **`admin` / `admin123`** (change it in any real deployment).

> The server boots even with no database reachable — reference data (criteria, ISMS levels,
> prompts, rules, the starter data-class library) is held in memory and seeding is
> best-effort and idempotent. DB-backed features simply return errors until Postgres is up.

## Getting started (Docker)

```bash
cp .env.example .env
docker-compose up --build
# app: http://localhost:5000/pdtc/
```

Three services: **db** (`postgres:16-alpine`, healthchecked), **migrate** (runs
`npm run db:migrate` once against a healthy db), and **app** (waits for db healthy +
migrate completed, then serves on `:5000`).

## Environment variables (`.env.example`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres 16 connection string (`pdtc/pdtc/pdtc`) |
| `PORT` | Server port (default `5000`) |
| `NODE_ENV` | `development` \| `production` |
| `SESSION_SECRET` | express-session cookie secret |
| `OPENAI_API_KEY` | Key for the OpenAI-compatible endpoint (often unused for local models) |
| `OPENAI_MODEL` | Exact model id (e.g. `llama3.1`) |
| `OPENAI_BASE_URL` | Endpoint base, incl. `/v1` (e.g. `http://localhost:11434/v1`) |

If the AI endpoint is unset or unreachable, the PII engine's LLM layer degrades to a
skipped/`uncertain` signal rather than failing a run — layers 1–2 (class-library keyword
matching) still produce results offline.

## Architecture

```
client/    React 18 + Vite 7 SPA (Wouter, TanStack Query, Tailwind + shadcn/ui, EN/AR + RTL)
server/    Express 5 API — one server for API + SPA
  ai-provider.ts          OpenAI-compatible wrapper + assertNoDataValues() boundary guard
  ingest/                 IKC .xlsx parsing, column mapping, import runs
  pii-engine/             Engine 1: layers (ikc-class / adc-class / llm) → merge → co-occurrence
  classification-engine/  Engine 2: rule table → asset rollup → override → completion
  review/                 steward queue + decisions (writes audit_log)
  audit/                  append-only decision log (INSERT only)
  writeback/              IKC write-back preview (stub)
shared/
  lib/                    criteria.ts, classification.ts, ikc-fields.ts (defined ONCE, used everywhere)
  models/schema.ts        every Drizzle pgTable — single source of truth
migrations/               drizzle-kit generated SQL
script/                   build.ts (vite + esbuild), migrate.ts
tests/                    Vitest: rollup precedence, criteria mapping, a server route, a component, ingest mapping
```

### The five policy criteria
`DIRECT_ID`, `INDIRECT_ID`, `REGULATORY`, `CONTEXTUAL`, `SPECIAL_CATEGORY` — defined in
`shared/lib/criteria.ts`. Intrinsic criteria (`DIRECT_ID`, `SPECIAL_CATEGORY`) resolve from
the class-library layers; contextual criteria need the LLM layer and/or the co-occurrence
pass. When detection layers disagree, the item is written `uncertain` and forced into the
review queue at high priority — the engine never silently picks a winner.

### The WoG classification scale
`OPEN < CONFIDENTIAL < SENSITIVE < SECRET` (by `rank`) — the DGE Whole-of-Government Data
Classification Framework v1.0 scale, defined in `shared/lib/classification.ts`. Confidential
is the default level for all data. Assets take the **high-water-mark** (max rank) of their
attributes; a steward override always wins over a computed rollup and is re-evaluated (and
flagged, not overwritten) on the next run.

## Vertical slices in this skeleton

- **A — Ingest**: upload an IKC attribute `.xlsx` → auto-map columns against
  `shared/lib/ikc-fields.ts` → insert `assets` + `attributes` → import summary.
- **B — PII Detection**: `POST /api/pii-detection/runs` runs all three layers (1–2
  placeholder keyword logic, 3 a real `aiComplete` call with a strict `json_schema`) →
  writes `detections` → results table with criterion badges, confidence bars, and an
  evidence drawer.
- **C — Classification**: `POST /api/classification/runs` → attribute labels via the rule
  table → asset rollup → override dialog that **requires a rationale** and writes to
  `audit_log`.

## Catalog, staged engine runs & round-trip (Prompt 2)

On top of the skeleton, PDTC adds the governed workflow layer:

- **Catalog screens** — `/assets` and `/attributes` share one `CatalogScreen`: URL-synced
  filters/sort/page/search, **server-side** filter/sort/pagination (never in the browser),
  a KPI strip over the current filtered set, and **selection-by-query** (`useSelection`)
  that works across pagination — "select all N matching rows" resolves server-side inside
  the action, guarded by `max_batch_size`.
- **The governing rule** — *nothing mutates the catalog until Approve on step 3 of a
  wizard.* Every engine run writes only to the staging tables (`engine_runs`, `run_items`,
  `criterion_assessments`). `assets` / `attributes` / `detections` / `classifications` are
  written **only** by `POST /api/engine-runs/:id/approve`, which runs as a single
  transaction (a mid-commit failure rolls back completely) and writes `audit_log`. Discard
  writes nothing.
- **The EngineWizard** (PII + Classification share one component): **Setup** (read-only
  framework, scope, run params — temperature locked at 0) → **Results** (staged rows with a
  criterion-by-criterion assessment for **all five** criteria, per-row steward decisions) →
  **Review & Approve** (commit preview + diff + asset-rollup preview + mandatory
  justification).
- **Determinism** (`§7`) — `server/pii-engine/canonicalize.ts` builds the model payload
  deterministically (NFC normalisation, whitespace collapse, sorted keys, `(assetId,
  columnName)` ordering, fixed batches, null/empty sentinel); an `inputHash` (sha256 over
  the canonical payload + all version ids) keys the `llm_cache`; every finding stores full
  provenance (`modelId`, `promptVersion`, `frameworkVersion`, `inputHash`, `cached`,
  `runId`). Layers 1–2 and the rule table are pure functions.
- **Frameworks** — `/settings/pii-framework` and `/settings/classification-framework` are
  versioned: every save creates a new **immutable** `framework_versions` row; approved runs
  stay pinned to the version they used; restore creates a new version. Export/import as
  JSON. `/settings/ai` manages the provider (API key write-only, last-4 only), a
  test-connection that catches silent model substitution, and cache management.
- **Export / round-trip** — `ExportDialog` generates `.xlsx` via exceljs (frozen header,
  autofilter, hidden `_row_key` + `_export_batch_id`, locked read-only columns, unlocked
  decision columns with data-validation dropdowns, README sheet). `/import` re-uploads it,
  matches rows on `_row_key`, diffs **only** the editable columns (read-only changes are
  warned + ignored), and applies accepted changes transactionally — the AI's original
  finding is never deleted, only superseded/`overriddenByImport`.

### Prompt 2 tests
Determinism (identical output + `inputHash` across runs), canonicalisation (stable hash
under Unicode/whitespace variation), cache (zero LLM calls + equal output on hit), selection
resolution, round-trip diff, read-only enforcement, and criterion completeness run
everywhere. Staging-isolation + approval-rollback tests run against a live Postgres and
skip cleanly when none is reachable.

## Notes / limitations (skeleton)

This is a wiring skeleton, not a finished product. The ADC class library, the IKC
write-back integration, and the rule set are intentionally minimal placeholders. Sessions
use the in-memory store. The AI layers call a real endpoint but degrade gracefully when
none is configured.
