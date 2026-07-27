/**
 * Classification eval harness — the confidentiality analogue of script/eval-pii.ts.
 * Runs the classification engine over the hand-labeled gold set
 * (eval/classification-gold-set.json) and scores it: exact-level accuracy, SECRET and
 * SENSITIVE recall, over-/under-classification counts (predicted rank vs expected rank),
 * and lists every mismatch. Turns "the levels look right" into a number you can track.
 *
 *   npx tsx script/eval-classification.ts   (needs the app running on :5080 and DATABASE_URL)
 */
import fs from "node:fs";
import { Pool } from "pg";
import { levelRank, type ClassificationCode } from "../shared/lib/classification";

// Load .env (DATABASE_URL) without adding a dependency.
if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const BASE = process.env.EVAL_BASE ?? "http://localhost:5080";

interface Gold { table: string; column: string; level: ClassificationCode; note?: string }

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const set = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  return set.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const gold: Gold[] = JSON.parse(fs.readFileSync("eval/classification-gold-set.json", "utf8")).columns;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // 1. Resolve gold columns -> attribute ids.
  const resolved: Array<Gold & { id: number }> = [];
  for (const g of gold) {
    const r = await pool.query<{ id: number }>(
      "SELECT at.id FROM attributes at JOIN assets a ON a.id = at.asset_id WHERE a.name = $1 AND at.column_name = $2 LIMIT 1",
      [g.table, g.column],
    );
    if (r.rows[0]) resolved.push({ ...g, id: r.rows[0].id });
    else console.warn(`  (skip — not found: ${g.table}.${g.column})`);
  }
  const ids = resolved.map((r) => r.id);
  console.log(`Resolved ${ids.length}/${gold.length} gold columns.`);

  // 2. Run a fresh classification over exactly those columns.
  const cookie = await login();
  const runRes = await fetch(`${BASE}/api/engine-runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ engineType: "classification", screen: "attributes", selection: { mode: "include", ids, excluded: [] }, params: { forceFresh: true } }),
  });
  const run = (await runRes.json()) as { id: number };
  process.stdout.write(`Run ${run.id} `);
  for (;;) {
    const s = (await (await fetch(`${BASE}/api/engine-runs/${run.id}`, { headers: { Cookie: cookie } })).json()) as { status: string; processedItems: number; totalItems: number };
    process.stdout.write(".");
    if (s.status === "completed" || s.status === "failed") { console.log(` ${s.status} (${s.processedItems}/${s.totalItems})`); break; }
    await sleep(4000);
  }

  // 3. Read the staged suggested levels.
  const items = (await pool.query<{ target_id: number; suggested_level_code: string | null; confidence: number }>(
    "SELECT target_id, suggested_level_code, confidence FROM run_items WHERE run_id = $1", [run.id],
  )).rows;
  const byTarget = new Map(items.map((i) => [i.target_id, i]));

  // 4. Score.
  let hit = 0, over = 0, under = 0, noResult = 0;
  let secretExp = 0, secretCaught = 0, sensitiveExp = 0, sensitiveCaught = 0;
  const mismatches: string[] = [];

  for (const g of resolved) {
    const it = byTarget.get(g.id);
    if (!it || !it.suggested_level_code) { noResult++; mismatches.push(`NO RESULT  ${g.table}.${g.column}`); continue; }
    const got = it.suggested_level_code as ClassificationCode;
    const line = `${g.table}.${g.column}  exp=${g.level}  got=${got} (${Number(it.confidence).toFixed(2)})`;

    if (got === g.level) hit++;
    else if (levelRank(got) > levelRank(g.level)) { over++; mismatches.push("OVER      " + line); }
    else { under++; mismatches.push("UNDER     " + line); }

    if (g.level === "SECRET") { secretExp++; if (got === "SECRET") secretCaught++; }
    if (g.level === "SENSITIVE") { sensitiveExp++; if (got === "SENSITIVE") sensitiveCaught++; }
  }

  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(0) + "%" : "n/a");

  console.log("\n============ CLASSIFICATION EVAL ============");
  console.log(`Scored:              ${resolved.length} columns`);
  console.log(`Exact-level correct: ${hit}  (${pct(hit, resolved.length)})`);
  console.log(`Secret recall:       ${pct(secretCaught, secretExp)}  (${secretCaught}/${secretExp})`);
  console.log(`Sensitive recall:    ${pct(sensitiveCaught, sensitiveExp)}  (${sensitiveCaught}/${sensitiveExp})`);
  console.log(`Over-classified:     ${over}   Under-classified: ${under}   No result: ${noResult}`);
  console.log("\n--- Mismatches ---");
  if (mismatches.length === 0) console.log("  (none)");
  else mismatches.forEach((m) => console.log("  " + m));
  console.log("=============================================");

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
