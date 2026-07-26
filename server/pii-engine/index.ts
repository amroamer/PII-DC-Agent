/**
 * PII Detection Engine orchestrator. For every ingested attribute it runs the
 * three layers, writes one detections row per contributing layer signal, then runs
 * the asset-scoped co-occurrence pass. The fused per-attribute verdict is computed
 * on read via mergeSignals(), so no information is lost when layers disagree.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { assets, attributes, detections, type NewDetection } from "@shared/models/schema";
import { joinFacet } from "@shared/lib/facets";
import { getSetting } from "../reference-cache";
import type { DetectionInput, DetectionSignal, EngineContext } from "./types";
import { runIkcClassLayer } from "./layers/ikc-class";
import { runAdcClassLayer } from "./layers/adc-class";
import { runLlmLayer } from "./layers/llm";
import { mergeSignals } from "./merge";
import { runCooccurrence } from "./cooccurrence";

export interface DetectionRunResult {
  runId: string;
  engineVersion: string;
  attributesProcessed: number;
  detectionsWritten: number;
  llmSignals: number;
  llmSkipped: number;
  cooccurrenceFindings: number;
  conflicts: number;
  piiCount: number;
}

export async function runDetection(opts: {
  runId?: string;
  useLlmLayer?: boolean;
}): Promise<DetectionRunResult> {
  const engineVersion = getSetting<string>("engine_version") ?? "0.1.0";
  const threshold = getSetting<number>("confidence_review_threshold") ?? 0.6;
  const runId = opts.runId ?? `det-${randomUUID().slice(0, 8)}`;
  const ctx: EngineContext = {
    runId,
    engineVersion,
    useLlmLayer: opts.useLlmLayer ?? true,
    confidenceReviewThreshold: threshold,
  };

  const attrRows = await db.select().from(attributes);
  const assetRows = await db.select().from(assets);
  const assetMap = new Map(assetRows.map((a) => [a.id, a]));

  const siblingsByAsset = new Map<number, string[]>();
  for (const attr of attrRows) {
    const list = siblingsByAsset.get(attr.assetId) ?? [];
    list.push(attr.columnName);
    siblingsByAsset.set(attr.assetId, list);
  }

  const toInsert: NewDetection[] = [];
  let llmSignals = 0;
  let llmSkipped = 0;
  let conflicts = 0;
  let piiCount = 0;

  for (const attr of attrRows) {
    const asset = assetMap.get(attr.assetId);
    if (!asset) continue;

    const siblings = (siblingsByAsset.get(attr.assetId) ?? []).filter(
      (name) => name !== attr.columnName,
    );

    const input: DetectionInput = {
      attribute: attr,
      asset: {
        id: asset.id,
        name: asset.name,
        assetType: asset.assetType,
        businessDomain: joinFacet(asset.businessDomain),
        subjectArea: joinFacet(asset.subjectArea),
      },
      siblingColumnNames: siblings,
    };

    const signals: DetectionSignal[] = [];
    const s1 = runIkcClassLayer(input, ctx);
    if (s1) signals.push(s1);
    const s2 = runAdcClassLayer(input, ctx);
    if (s2) signals.push(s2);

    const s3 = await runLlmLayer(input, ctx);
    if (s3) {
      signals.push(s3);
      llmSignals++;
    } else if (ctx.useLlmLayer) {
      llmSkipped++;
    }

    for (const sig of signals) {
      toInsert.push({
        attributeId: attr.id,
        layer: sig.layer,
        criterionCode: sig.criterion,
        verdict: sig.verdict,
        dataClassCode: sig.dataClassCode,
        confidence: sig.confidence,
        rationaleEn: sig.rationaleEn,
        rationaleAr: sig.rationaleAr,
        evidence: { ...sig.evidence, signals: sig.signals },
        engineVersion,
        runId,
      });
    }

    const merged = mergeSignals(signals, threshold);
    if (merged.conflict) conflicts++;
    if (merged.verdict === "pii") piiCount++;
  }

  if (toInsert.length > 0) {
    // Chunked insert keeps the parameter count well under pg's limit.
    for (let i = 0; i < toInsert.length; i += 500) {
      await db.insert(detections).values(toInsert.slice(i, i + 500));
    }
  }

  const cooccurrenceCount = await runCooccurrence(runId);

  return {
    runId,
    engineVersion,
    attributesProcessed: attrRows.length,
    detectionsWritten: toInsert.length,
    llmSignals,
    llmSkipped,
    cooccurrenceFindings: cooccurrenceCount,
    conflicts,
    piiCount,
  };
}
