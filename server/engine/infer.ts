/**
 * PII inference for a single attribute: deterministic layers 1–2 + optional cached
 * LLM, producing a verdict plus one assessment PER active criterion (Prompt 2 §6.2).
 * The LLM caller is injectable (`deps.infer`) so tests can stub it and assert
 * determinism + zero network calls on a cache hit.
 */
import type { CriterionCode } from "@shared/lib/criteria";
import { CRITERION_CODES } from "@shared/lib/criteria";
import type { DetectionVerdict } from "@shared/models/schema";
import {
  aiComplete,
  assertNoDataValues,
  extractJson,
  isAiConfigured,
  AiUnavailableError,
  type JsonSchemaSpec,
} from "../ai-provider";
import { getDataClasses } from "../reference-cache";
import type { DetectionInput } from "../pii-engine/types";
import { runIkcClassLayer } from "../pii-engine/layers/ikc-class";
import { runAdcClassLayer } from "../pii-engine/layers/adc-class";
import { mergeSignals } from "../pii-engine/merge";
import { canonicalizeAttribute, computeInputHash, type CanonicalAttribute } from "../pii-engine/canonicalize";
import { getCached, putCache } from "./cache";

export const PII_SCHEMA_VERSION = "pii-assess-v1";

export interface CriterionAssessmentOut {
  criterionCode: CriterionCode;
  applies: boolean;
  rationaleEn: string;
  rationaleAr: string;
  confidence: number;
  signals: string[];
}

export interface PiiInferenceOut {
  verdict: DetectionVerdict;
  suggestedClassCode: string | null;
  confidence: number;
  rationaleEn: string;
  rationaleAr: string;
  sourceLayers: string[];
  conflict: boolean;
  assessments: CriterionAssessmentOut[];
  inputHash: string;
  cached: boolean;
}

export interface PiiAssessment {
  verdict: DetectionVerdict;
  suggestedDataClass: string | null;
  overallConfidence: number;
  rationaleEn: string;
  rationaleAr: string;
  criteria: Array<{
    code: CriterionCode;
    applies: boolean;
    rationaleEn: string;
    rationaleAr: string;
    confidence: number;
  }>;
}

export interface InferContext {
  modelId: string;
  promptVersion: string;
  frameworkVersion: string;
  frameworkVersionId: number | null;
  engineVersion: string;
  activeCriteria: CriterionCode[];
  useCache: boolean;
  forceFresh: boolean;
  systemPrompt: string;
  threshold: number;
  /** Fixed seed sent to the model for reproducibility (Prompt 2 §7.1). */
  seed: number;
  /** N>1 runs N samples with varied seeds; disagreement -> uncertain (§7.4). */
  selfConsistencySamples: number;
  /** Verdicts below this confidence are forced to 'uncertain' (§6.1 Panel C). */
  confidenceFloor: number;
  /** When false, Arabic rationales are suppressed. */
  includeArabic: boolean;
}

export interface InferDeps {
  infer?: (payload: CanonicalAttribute, systemPrompt: string, seed?: number) => Promise<PiiAssessment | null>;
  // Injectable cache (defaults to the DB-backed llm_cache) — lets tests run DB-free.
  getCached?: (hash: string) => Promise<Record<string, unknown> | undefined>;
  putCache?: (hash: string, response: Record<string, unknown>) => Promise<void>;
}

const PII_ASSESS_SCHEMA: JsonSchemaSpec = {
  name: "pii_assessment",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "suggestedDataClass", "overallConfidence", "rationaleEn", "rationaleAr", "criteria"],
    properties: {
      verdict: { type: "string", enum: ["pii", "not_pii", "uncertain"] },
      suggestedDataClass: { type: ["string", "null"] },
      overallConfidence: { type: "number", minimum: 0, maximum: 1 },
      rationaleEn: { type: "string" },
      rationaleAr: { type: "string" },
      criteria: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["code", "applies", "rationaleEn", "rationaleAr", "confidence"],
          properties: {
            code: { type: "string", enum: [...CRITERION_CODES] },
            applies: { type: "boolean" },
            rationaleEn: { type: "string" },
            rationaleAr: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    },
  },
};

/** Default LLM caller (used when no stub is injected and the AI endpoint is configured). */
export function defaultInfer(): InferDeps["infer"] {
  return async (payload, systemPrompt, seed) => {
    assertNoDataValues(payload as unknown as Record<string, unknown>);
    const prompt = `Assess the following attribute against all five criteria using ONLY this metadata:\n${JSON.stringify(payload, null, 2)}`;
    try {
      const raw = await aiComplete({
        system: systemPrompt,
        prompt,
        schema: PII_ASSESS_SCHEMA,
        temperature: 0,
        topP: 1,
        seed,
      });
      return extractJson<PiiAssessment>(raw);
    } catch (err) {
      if (err instanceof AiUnavailableError) return null;
      throw err;
    }
  };
}

function specialCategoryHit(dataClassCode: string | null): boolean {
  if (!dataClassCode) return false;
  const dc = getDataClasses().find((c) => c.code === dataClassCode);
  return Boolean(dc?.isSpecialCategory);
}

export async function inferPiiForAttribute(
  input: DetectionInput,
  ctx: InferContext,
  deps: InferDeps,
): Promise<PiiInferenceOut> {
  const canonical = canonicalizeAttribute(input.attribute, {
    name: input.asset.name,
    businessDomain: input.asset.businessDomain,
    subjectArea: input.asset.subjectArea,
  }, input.siblingColumnNames);

  const inputHash = computeInputHash({
    payload: canonical,
    promptVersion: ctx.promptVersion,
    frameworkVersion: ctx.frameworkVersion,
    modelId: ctx.modelId,
    engineVersion: ctx.engineVersion,
    schemaVersion: PII_SCHEMA_VERSION,
    systemPrompt: ctx.systemPrompt,
  });

  // Deterministic base (layers 1–2).
  const s1 = runIkcClassLayer(input, { runId: "", engineVersion: ctx.engineVersion, useLlmLayer: false, confidenceReviewThreshold: ctx.threshold });
  const s2 = runAdcClassLayer(input, { runId: "", engineVersion: ctx.engineVersion, useLlmLayer: false, confidenceReviewThreshold: ctx.threshold });
  const baseSignals = [s1, s2].filter((x): x is NonNullable<typeof x> => x !== null);
  const merged = mergeSignals(baseSignals, ctx.threshold);
  const special = merged.criterion === "SPECIAL_CATEGORY" || specialCategoryHit(merged.dataClassCode);

  // Optional LLM enrichment (cache-first, injectable, with self-consistency).
  let llm: PiiAssessment | null = null;
  let cached = false;
  let divergence: string | null = null;
  const inferFn = deps.infer ?? (isAiConfigured() ? defaultInfer() : undefined);

  if (inferFn) {
    const readCache = deps.getCached ?? (async (h: string) => (await getCached(h))?.response);
    const writeCache =
      deps.putCache ??
      (async (h: string, response: Record<string, unknown>) =>
        putCache({
          inputHash: h,
          response,
          modelId: ctx.modelId,
          promptVersion: ctx.promptVersion,
          frameworkVersionId: ctx.frameworkVersionId,
          engineVersion: ctx.engineVersion,
          schemaVersion: PII_SCHEMA_VERSION,
        }));

    const hit = ctx.useCache && !ctx.forceFresh ? await readCache(inputHash) : undefined;
    if (hit) {
      llm = hit as unknown as PiiAssessment;
      cached = true;
    } else if (ctx.selfConsistencySamples > 1) {
      // §7.4: N samples with distinct seeds; unanimous -> that verdict, else uncertain.
      const samples: PiiAssessment[] = [];
      for (let i = 0; i < ctx.selfConsistencySamples; i++) {
        const r = await inferFn(canonical, ctx.systemPrompt, ctx.seed + i);
        if (r) samples.push(r);
      }
      if (samples.length > 0) {
        const verdicts = samples.map((s) => s.verdict);
        const unanimous = verdicts.every((v) => v === verdicts[0]);
        if (unanimous) {
          llm = samples[0];
        } else {
          divergence = verdicts.join(", ");
          llm = { ...samples[0], verdict: "uncertain" };
        }
        if (ctx.useCache) await writeCache(inputHash, llm as unknown as Record<string, unknown>);
      }
    } else {
      llm = await inferFn(canonical, ctx.systemPrompt, ctx.seed);
      // Only persist to the cache when caching is enabled (force-fresh still writes).
      if (llm && ctx.useCache) await writeCache(inputHash, llm as unknown as Record<string, unknown>);
    }
  }

  let verdict: DetectionVerdict = llm?.verdict ?? merged.verdict;
  const confidence = llm?.overallConfidence ?? merged.confidence;
  // §6.1 Panel C: a verdict below the confidence floor is forced to uncertain.
  if (verdict === "pii" && confidence < ctx.confidenceFloor) verdict = "uncertain";
  const suggestedClassCode = llm?.suggestedDataClass ?? merged.dataClassCode;
  const ar = (s: string) => (ctx.includeArabic ? s : "");

  const assessments: CriterionAssessmentOut[] = ctx.activeCriteria.map((code) => {
    const fromLlm = llm?.criteria.find((c) => c.code === code);
    if (fromLlm) {
      return {
        criterionCode: code,
        applies: fromLlm.applies,
        rationaleEn: fromLlm.rationaleEn,
        rationaleAr: ar(fromLlm.rationaleAr),
        confidence: Math.max(0, Math.min(1, fromLlm.confidence)),
        signals: ["llm"],
      };
    }
    const applies = verdict === "pii" && (code === merged.criterion || (code === "SPECIAL_CATEGORY" && special));
    return {
      criterionCode: code,
      applies,
      rationaleEn: applies
        ? `Metadata signals indicate this attribute meets ${code}.`
        : `No metadata signal supports ${code} for this attribute.`,
      rationaleAr: ar(
        applies
          ? `تشير البيانات الوصفية إلى استيفاء المعيار ${code}.`
          : `لا توجد إشارة في البيانات الوصفية تدعم المعيار ${code}.`,
      ),
      confidence: applies ? confidence : 0.6,
      signals: baseSignals.flatMap((s) => s.signals),
    };
  });

  return {
    verdict,
    suggestedClassCode,
    confidence,
    rationaleEn: divergence
      ? `Self-consistency divergence across ${ctx.selfConsistencySamples} samples (${divergence}); held as uncertain.`
      : llm?.rationaleEn ?? merged.rationaleEn,
    rationaleAr: ar(llm?.rationaleAr ?? merged.rationaleAr),
    sourceLayers: divergence ? [...merged.contributingLayers, "self_consistency"] : merged.contributingLayers,
    conflict: merged.conflict,
    assessments,
    inputHash,
    cached,
  };
}
