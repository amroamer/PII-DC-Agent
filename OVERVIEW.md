# Personal Data Tagging & Classification Workbench (PDTC)

## What it is

**PDTC** is a metadata-governance workbench built for **Abu Dhabi Customs (ADC)** that
operationalises the ADC *Personal Data Tagging Policy Framework* (DGO-FM-002-01). It
ingests data-asset and attribute metadata exported from **IBM Knowledge Catalog (IKC)**,
runs two analysis engines over that metadata, routes the results through a data-steward
review queue, records an immutable audit trail of every decision, and prepares confirmed
tags for write-back to IKC.

Its defining constraint is a **metadata-only guarantee**: the application never reads data
*values*. It reasons exclusively over column names, descriptions, data types, and asset
context, and a runtime guard (`assertNoDataValues`) blocks any non-metadata field from ever
reaching the model — so no customs data leaves the ADC boundary. The AI layer is
deliberately OpenAI-API-compatible so it can run against a **local / self-hosted model**
(Ollama, vLLM, LiteLLM) for full data sovereignty.

## What it does

- **Ingest** — upload IKC asset/attribute `.xlsx` exports, auto-map columns to canonical
  fields, and import into the catalog.
- **PII Detection Engine** — a three-layer pipeline (IKC class library → ADC class library
  → LLM semantic inference) that decides whether each attribute is personal data and maps
  every verdict to one of the five policy criteria, with a bilingual, auditable rationale
  and a per-criterion assessment.
- **Classification Engine** — a deterministic rule table turns verdicts into ADC ISMS
  confidentiality labels (Public → Internal → Confidential → Secret), then rolls them up to
  asset level using high-water-mark precedence.
- **Catalog** — `/assets` and `/attributes` screens with server-side filtering / sorting /
  pagination over ~35 declarative filters, clickable KPI cards with distribution charts,
  selection-by-query that works across pagination, and saved views.
- **The governing rule** — *nothing mutates the catalog until a steward presses Approve.*
  Every engine run writes only to **staging tables**; the catalog is changed exclusively by
  a single **transactional approval** that also writes the audit log. Runs stream progress
  and can be cancelled.
- **Determinism** — canonicalised (NFC-normalised, sorted, sentinel-padded) model inputs, a
  `sha256` provenance hash over payload + all version identifiers, a result cache,
  self-consistency sampling, and full provenance on every finding — so any tag can be traced
  to the exact inputs that produced it and reproduced.
- **Frameworks** — versioned, immutable, editable PII and Classification frameworks;
  approved runs are pinned to the version they used.
- **Round-trip** — export to a protected `.xlsx` (locked read-only columns, unlocked
  steward-decision columns with dropdowns, hidden row keys, bilingual reasoning, RTL) and
  re-import with a diff-review that only ever applies the editable columns.
- **Bilingual / RTL** — full English/Arabic UI with `dir="rtl"` and logical CSS properties;
  engine rationales are generated in both languages.

## Full technology stack

| Layer | Technologies |
|---|---|
| **Language / module system** | TypeScript 5.6 (strict), ESM throughout, Node 20 |
| **Frontend** | React 18.3, Vite 7, Wouter 3.3 (routing), TanStack React Query 5 (server state), Tailwind CSS 3.4, shadcn/ui on Radix UI primitives, lucide-react, react-hook-form + Zod + `@hookform/resolvers`, Recharts (charts), Framer Motion, date-fns, `clsx` / `tailwind-merge` / `class-variance-authority` |
| **Backend** | Express 5, `tsx` (TS execution), `express-session` + Passport (local strategy, scrypt password hashing), `multer` (uploads) |
| **Database** | PostgreSQL 16, Drizzle ORM 0.39 (+ `drizzle-kit` migrations, `drizzle-zod` validation), `pg` connection pool |
| **AI** | Provider-agnostic wrapper around an OpenAI-compatible Chat Completions API — env-driven model/key/base URL, strict `json_schema` structured output, `temperature 0` / `top_p 1` / fixed `seed`, defensive JSON extraction, and a metadata-boundary guard |
| **File processing** | `xlsx` + `exceljs` (Excel), `pdf-parse`, `mammoth`, `sharp`, `jszip` |
| **Validation & shared contracts** | Zod schemas shared by client and server; criterion codes, ISMS levels, and IKC field names defined once in `shared/lib` |
| **Tooling / QA** | ESLint 9 (flat config) + typescript-eslint + jsx-a11y, Vitest 4 + Testing Library + jsdom, Playwright (visual), Husky + lint-staged |
| **Build & deploy** | One Express server serves both API and SPA (Vite middleware in dev, static `dist/public` in prod); `esbuild` bundles the server to a single CJS file; multi-stage Docker image; `docker-compose` orchestrates Postgres + a one-shot migration service + the app |

## Architecture

- **Monorepo, three source roots** — `client/` (React SPA), `server/` (Express API),
  `shared/` (Drizzle schema + policy contracts used by both), wired together with `@/*` and
  `@shared/*` path aliases that resolve identically across `tsc`, `tsx`, `esbuild`, Vite,
  and Vitest.
- **One-server model** — a single Node process owns the HTTP port; in development Vite is
  mounted as connect middleware (HMR), and in production the built SPA is served statically
  under the base path `/pdtc/`. Reference data is seeded idempotently on boot and the server
  degrades gracefully to in-memory reference data if the database is unreachable.
- **Data model** — a normalised schema of ~26 tables: reference/seeded data, ingested
  metadata, engine output (`detections`, `classifications`, `cooccurrence_findings`),
  **staging** (`engine_runs`, `run_items`, `criterion_assessments`), a deterministic
  `llm_cache`, versioned `frameworks` / `framework_versions`, `saved_views`, and the
  export/import round-trip tables — plus an **append-only** `audit_log` (no UPDATE/DELETE
  path anywhere).
- **Governance & security** — role-based access (admin/steward/viewer) with admin-gated
  settings and framework mutations; rationale requirements enforced at the Zod layer, not
  just the UI; every classification write and review resolution audited with
  before/after/rationale/source; immutable framework versions; and the transactional
  approval boundary that keeps abandoned or failed runs byte-identical to before.
- **Deployment** — `npm run dev` for local HMR; `npm run build` produces `dist/public`
  (client) + `dist/index.cjs` (server); `docker-compose up` brings up Postgres → migrations
  → the app with healthchecks and named volumes.

## Quality / verification

The codebase type-checks clean, builds cleanly, and ships a Vitest suite covering the
load-bearing guarantees — determinism (identical output + input hash across runs),
canonicalisation stability, cache behaviour, rollup precedence, the export→import round-trip
diff, read-only enforcement, criterion completeness, and — against a live Postgres — staging
isolation and transactional-approval rollback.
