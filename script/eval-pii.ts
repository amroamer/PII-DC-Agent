/**
 * PII detection eval harness. Runs the engine over the hand-labeled gold set
 * (eval/gold-set.json) and scores it: verdict precision/recall, per-type accuracy,
 * special-category recall, and the description-trust (#3) columns — then lists every
 * mismatch. Turns "the results look good" into a number you can track across changes.
 *
 *   npx tsx script/eval-pii.ts        (needs the app running on :5080 and DATABASE_URL)
 */
import fs from "node:fs";
import { Pool } from "pg";

// Load .env (DATABASE_URL) without adding a dependency.
if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const BASE = process.env.EVAL_BASE ?? "http://localhost:5080";
const PRECEDENCE = ["DIRECT_ID", "SPECIAL_CATEGORY", "INDIRECT_ID", "REGULATORY", "CONTEXTUAL"] as const;

interface Gold { table: string; column: string; verdict: "pii" | "not_pii"; type?: string; note?: string }

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
  const gold: Gold[] = JSON.parse(fs.readFileSync("eval/gold-set.json", "utf8")).columns;
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

  // 2. Run a fresh detection over exactly those columns.
  const cookie = await login();
  const runRes = await fetch(`${BASE}/api/engine-runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ engineType: "pii", screen: "attributes", selection: { mode: "include", ids, excluded: [] }, params: { forceFresh: true } }),
  });
  const run = (await runRes.json()) as { id: number };
  process.stdout.write(`Run ${run.id} `);
  for (;;) {
    const s = (await (await fetch(`${BASE}/api/engine-runs/${run.id}`, { headers: { Cookie: cookie } })).json()) as { status: string; processedItems: number; totalItems: number };
    process.stdout.write(".");
    if (s.status === "completed" || s.status === "failed") { console.log(` ${s.status} (${s.processedItems}/${s.totalItems})`); break; }
    await sleep(4000);
  }

  // 3. Read results (verdict + confidence + which criteria applied).
  const items = (await pool.query<{ id: number; target_id: number; verdict: string; confidence: number }>(
    "SELECT id, target_id, verdict, confidence FROM run_items WHERE run_id = $1", [run.id],
  )).rows;
  const byTarget = new Map(items.map((i) => [i.target_id, i]));
  const applied = (await pool.query<{ run_item_id: number; criterion_code: string }>(
    "SELECT run_item_id, criterion_code FROM criterion_assessments WHERE applies AND run_item_id = ANY($1)", [items.map((i) => i.id)],
  )).rows;
  const appliesByItem = new Map<number, Set<string>>();
  for (const a of applied) (appliesByItem.get(a.run_item_id) ?? appliesByItem.set(a.run_item_id, new Set()).get(a.run_item_id)!).add(a.criterion_code);
  const primaryType = (itemId: number): string | null => PRECEDENCE.find((c) => appliesByItem.get(itemId)?.has(c)) ?? null;

  // 4. Score.
  let hit = 0, falsePos = 0, falseNeg = 0, reviewPii = 0, overCautious = 0;
  let typeChecked = 0, typeCorrect = 0, specialExpected = 0, specialCaught = 0;
  const mismatches: string[] = [];
  const dq: string[] = [];

  for (const g of resolved) {
    const it = byTarget.get(g.id);
    if (!it) { mismatches.push(`NO RESULT  ${g.table}.${g.column}`); continue; }
    const type = it.verdict === "pii" ? primaryType(it.id) : null;
    const line = `${g.table}.${g.column}  exp=${g.verdict}${g.type ? "/" + g.type : ""}  got=${it.verdict}${type ? "/" + type : ""} (${Number(it.confidence).toFixed(2)})`;

    if (g.verdict === "pii") {
      if (it.verdict === "pii") hit++;
      else if (it.verdict === "uncertain") { reviewPii++; mismatches.push("REVIEW    " + line); }
      else { falseNeg++; mismatches.push("FALSE-NEG " + line); }
      if (g.type === "SPECIAL_CATEGORY") { specialExpected++; if (type === "SPECIAL_CATEGORY") specialCaught++; }
      if (g.type && it.verdict === "pii") { typeChecked++; if (type === g.type) typeCorrect++; else mismatches.push("WRONG-TYPE " + line); }
    } else {
      if (it.verdict === "not_pii") hit++;
      else if (it.verdict === "pii") { falsePos++; mismatches.push("FALSE-POS " + line); }
      else overCautious++;
    }
    if (g.note) dq.push(`${it.verdict === "pii" ? "STILL PII" : "handled  "}  ${line}`);
  }

  const expPii = resolved.filter((g) => g.verdict === "pii").length;
  const predPii = resolved.filter((g) => byTarget.get(g.id)?.verdict === "pii").length;
  const piiCaught = resolved.filter((g) => g.verdict === "pii" && byTarget.get(g.id)?.verdict === "pii").length;
  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(0) + "%" : "n/a");

  console.log("\n================ PII EVAL ================");
  console.log(`Scored:            ${resolved.length} columns`);
  console.log(`Verdict correct:   ${hit}  (${pct(hit, resolved.length)})`);
  console.log(`Recall (PII):      ${pct(piiCaught, expPii)}  — caught ${piiCaught}/${expPii} real PII (+${reviewPii} held for review)`);
  console.log(`Precision (PII):   ${pct(piiCaught, predPii)}  (${falsePos} false positives)`);
  console.log(`Type accuracy:     ${pct(typeCorrect, typeChecked)}  (${typeCorrect}/${typeChecked})`);
  console.log(`Special-cat recall:${pct(specialCaught, specialExpected)}  (${specialCaught}/${specialExpected})`);
  console.log(`False negatives:   ${falseNeg}   Held-for-review(PII): ${reviewPii}   Over-cautious: ${overCautious}`);
  console.log("\n--- Description-trust (#3) columns ---");
  dq.forEach((d) => console.log("  " + d));
  console.log("\n--- Mismatches ---");
  if (mismatches.length === 0) console.log("  (none)");
  else mismatches.forEach((m) => console.log("  " + m));
  console.log("=========================================");

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
