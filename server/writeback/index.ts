/**
 * IKC write-back adapter — a STUB in the skeleton. It assembles a writeback_batches
 * payload in IKC custom-attribute shape from the confirmed classifications + PII
 * verdicts. There is NO live IKC call here; the Coverage/preview surfaces show what
 * WOULD be written back.
 */
import { db } from "../db";
import { assets } from "@shared/models/schema";
import { getSetting } from "../reference-cache";
import { getLatestRunId, getResults } from "../pii-engine/results";
import { getAttributeClassifications } from "../classification-engine/read";

export interface WritebackEntry {
  ikcAssetId: string;
  assetName: string;
  columnName: string;
  customAttributes: Record<string, unknown>;
}

export interface WritebackPreview {
  status: "draft";
  generatedForRun: string | null;
  count: number;
  entries: WritebackEntry[];
}

export async function previewWriteback(): Promise<WritebackPreview> {
  const runId = await getLatestRunId();
  const results = await getResults({});
  const mergedByAttr = new Map(results.map((r) => [r.attributeId, r.merged]));

  const attrClasses = await getAttributeClassifications();
  const assetRows = await db.select().from(assets);
  const ikcById = new Map(assetRows.map((a) => [a.id, a.ikcAssetId]));
  const engineVersion = getSetting<string>("engine_version") ?? "0.1.0";

  const entries: WritebackEntry[] = attrClasses.map((c) => {
    const merged = mergedByAttr.get(c.attributeId);
    return {
      ikcAssetId: ikcById.get(c.assetId) ?? String(c.assetId),
      assetName: c.assetName,
      columnName: c.columnName,
      customAttributes: {
        "PDTC.IsPersonalData": merged ? merged.verdict === "pii" : null,
        "PDTC.Criterion": merged?.criterion ?? null,
        "PDTC.Confidentiality": c.levelCode,
        "PDTC.Confidence": merged ? Number(merged.confidence.toFixed(2)) : null,
        "PDTC.DerivedFrom": c.derivedFrom,
        "PDTC.EngineVersion": engineVersion,
      },
    };
  });

  return { status: "draft", generatedForRun: runId, count: entries.length, entries };
}
