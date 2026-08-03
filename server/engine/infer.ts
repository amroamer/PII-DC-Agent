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
  /** True when the column name and its description clearly describe different things (bad metadata). */
  metadataConflict: boolean;
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
  /** When false, disables the operational-column short-circuit (C1) so everything hits the LLM. */
  shortCircuitOperational?: boolean;
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
    required: ["verdict", "suggestedDataClass", "overallConfidence", "rationaleEn", "rationaleAr", "metadataConflict", "criteria"],
    properties: {
      verdict: { type: "string", enum: ["pii", "not_pii", "uncertain"] },
      suggestedDataClass: { type: ["string", "null"] },
      overallConfidence: { type: "number", minimum: 0, maximum: 1 },
      rationaleEn: { type: "string" },
      rationaleAr: { type: "string" },
      metadataConflict: { type: "boolean" },
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

/** System/operational columns that are not personal on their own (audit timestamps, flags, versions, keys). */
function isOperationalColumn(name: string): boolean {
  const n = name.toLowerCase();
  return (
    /(date_created|created_date|date_modified|modified_date|creation_date|last_modified|last_updated|update_date|updated_date|date_updated|modified_at|created_at)/.test(n) ||
    /(_flag$|_flag_|^flag_|is_deletable|isdeletable|_enabled$|enabled_flag|active_flag)/.test(n) ||
    /(row_version|_version_no|version_no|_seq$|_seqno$|sequence_no|_rowid$|_count$)/.test(n)
  );
}

/**
 * Column names that HINT at special-category data (health, biometric, religion, ethnicity,
 * …). The short-circuit must never skip these — a `DISABILITY_FLAG` matches the operational
 * `_flag$` pattern but is health data. Deliberately liberal: a false hint only costs one LLM
 * call (fail-safe), whereas a miss would drop a special category to not_pii (unsafe). Note
 * "disabilit" matches "disability" (health) but not "is_disabled" (an operational state flag).
 */
function hintsSpecialCategory(name: string): boolean {
  const n = name.toLowerCase();
  return /(health|medical|illness|disease|disabilit|diagnos|patient|clinic|blood_type|biometric|fingerprint|finger_print|iris_|retina|photo|facial|signature|religio|faith|ethnic|racial|sexual|orientation|political|genetic)/.test(n);
}

/** Deterministic not_pii result for a short-circuited operational column (no LLM call). */
function operationalNotPii(input: DetectionInput, ctx: InferContext, inputHash: string): PiiInferenceOut {
  const ar = (s: string) => (ctx.includeArabic ? s : "");
  const name = input.attribute.columnName;
  const assessments: CriterionAssessmentOut[] = ctx.activeCriteria.map((code) => ({
    criterionCode: code,
    applies: false,
    rationaleEn: `Operational/system column (${name}) — not personal on its own.`,
    rationaleAr: ar("عمود تشغيلي/نظامي — ليس شخصياً بحد ذاته."),
    confidence: 0,
    signals: ["operational_shortcircuit"],
  }));
  return {
    verdict: "not_pii",
    suggestedClassCode: null,
    confidence: 0.9,
    rationaleEn: `Operational/system metadata (${name}) — audit timestamp, boolean flag, row version or sequence key. Not personal on its own; resolved deterministically without AI.`,
    rationaleAr: ar(
      `بيانات تشغيلية/نظامية (${name}) — طابع زمني أو علم منطقي أو إصدار أو مفتاح تسلسلي؛ ليست شخصية بحد ذاتها، وتم الحسم دون ذكاء اصطناعي.`,
    ),
    sourceLayers: ["operational_shortcircuit"],
    conflict: false,
    assessments,
    inputHash,
    cached: false,
  };
}

function specialCategoryHit(dataClassCode: string | null): boolean {
  if (!dataClassCode) return false;
  const dc = getDataClasses().find((c) => c.code === dataClassCode);
  return Boolean(dc?.isSpecialCategory);
}

interface DeterministicBase {
  canonical: CanonicalAttribute;
  inputHash: string;
  baseSignals: NonNullable<ReturnType<typeof runIkcClassLayer>>[];
  merged: ReturnType<typeof mergeSignals>;
  special: boolean;
}

/** Layers 1–2 + canonical payload + input hash — the deterministic base shared by single + batch. */
function deterministicBase(input: DetectionInput, ctx: InferContext): DeterministicBase {
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
  const s1 = runIkcClassLayer(input, { runId: "", engineVersion: ctx.engineVersion, useLlmLayer: false, confidenceReviewThreshold: ctx.threshold });
  const s2 = runAdcClassLayer(input, { runId: "", engineVersion: ctx.engineVersion, useLlmLayer: false, confidenceReviewThreshold: ctx.threshold });
  const baseSignals = [s1, s2].filter((x): x is NonNullable<typeof x> => x !== null);
  const merged = mergeSignals(baseSignals, ctx.threshold);
  const special = merged.criterion === "SPECIAL_CATEGORY" || specialCategoryHit(merged.dataClassCode);
  return { canonical, inputHash, baseSignals, merged, special };
}

/** C1: a clearly-operational column safe to resolve not_pii without the LLM (safety-gated). */
function canShortCircuit(input: DetectionInput, ctx: InferContext, base: DeterministicBase): boolean {
  return (
    ctx.shortCircuitOperational !== false &&
    base.merged.verdict !== "pii" &&
    !base.special &&
    isOperationalColumn(input.attribute.columnName) &&
    !hintsSpecialCategory(input.attribute.columnName)
  );
}

/** Assemble the final inference from the deterministic base + an optional LLM assessment. Shared
 *  by the single-column and batch paths so both apply identical guardrails, floors and rationale. */
function assembleInference(
  input: DetectionInput,
  ctx: InferContext,
  base: DeterministicBase,
  opts: { llm: PiiAssessment | null; cached: boolean; llmFailed: boolean; divergence: string | null },
): PiiInferenceOut {
  const { merged, special, baseSignals, inputHash } = base;
  const { llm, cached, llmFailed, divergence } = opts;

  // #3: the model flagged that the column name and description describe different things. It has
  // already classified from the NAME (per the prompt); here we only SURFACE the data-quality issue.
  const metadataConflict = llm?.metadataConflict === true;

  let verdict: DetectionVerdict = llm?.verdict ?? merged.verdict;
  let confidence = llm?.overallConfidence ?? merged.confidence;
  // §6.1 Panel C: a verdict below the confidence floor is forced to uncertain.
  if (verdict === "pii" && confidence < ctx.confidenceFloor) verdict = "uncertain";
  if (llmFailed) {
    verdict = "uncertain";
    confidence = 0;
  }
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

  // #6/#7 guardrail: a "pii" verdict resting ONLY on Contextual Risk is association-with-the-asset,
  // not intrinsic personal content. Operational columns → not_pii; otherwise cap confidence.
  const appliedCodes = assessments.filter((a) => a.applies).map((a) => a.criterionCode);
  const onlyContextual = appliedCodes.length > 0 && appliedCodes.every((c) => c === "CONTEXTUAL");
  if (verdict === "pii" && onlyContextual) {
    if (isOperationalColumn(input.attribute.columnName)) {
      verdict = "not_pii";
      const ctxA = assessments.find((a) => a.criterionCode === "CONTEXTUAL");
      if (ctxA) {
        ctxA.applies = false;
        ctxA.rationaleEn = `Operational/system metadata (${input.attribute.columnName}) — not personal on its own, despite the asset containing identifiers.`;
        ctxA.rationaleAr = ar("بيانات تشغيلية/نظامية — ليست شخصية بحد ذاتها رغم احتواء الأصل على معرّفات.");
      }
    } else {
      confidence = Math.min(confidence, 0.55);
    }
  }

  // A "pii" verdict with NO applied criterion is not a finding — it is an
  // unattributed assertion. It cannot be defended in an export, filtered by
  // criterion, or actioned by a steward, and it is what produced 145 blank
  // "Criteria Matched" cells: the model judged a column personal for a reason
  // (contextual, regulatory, special-category) that the run was not scoped to
  // score, so every in-scope criterion came back false.
  //
  // Held as `uncertain` rather than `not_pii` on purpose: several of these are
  // genuinely personal (employee photo, religion, passport image), so asserting
  // "not personal" would be the more dangerous error. Uncertain keeps them out
  // of the PII inventory and routes them to a steward.
  const unattributedPii = verdict === "pii" && appliedCodes.length === 0;
  if (unattributedPii) verdict = "uncertain";

  return {
    verdict,
    suggestedClassCode,
    confidence,
    rationaleEn: llmFailed
      ? "AI inference was unavailable for this attribute (rate limit / timeout / unreachable); held as uncertain for steward review — not auto-classified."
      : unattributedPii
      ? `Assessed as personal, but no criterion in this run's scope (${ctx.activeCriteria.join(", ")}) applies — the reason falls outside it. Held as uncertain for steward review rather than recorded as PII without a criterion. Engine rationale: ${llm?.rationaleEn ?? merged.rationaleEn}`
      : divergence
        ? `Self-consistency divergence across ${ctx.selfConsistencySamples} samples (${divergence}); held as uncertain.`
        : (metadataConflict ? "Data-quality issue: the column name and its description describe different things, so the metadata is unreliable — held for steward review (fix the description). " : "") +
          (llm?.rationaleEn ?? merged.rationaleEn),
    rationaleAr: ar(
      llmFailed
        ? "تعذّر إجراء الاستدلال بالذكاء الاصطناعي لهذه السمة (حد المعدل / مهلة)؛ مُعلّقة للمراجعة."
        : unattributedPii
          ? `تم تقييمها كبيانات شخصية، لكن لا ينطبق أي معيار ضمن نطاق هذا التشغيل؛ مُعلّقة للمراجعة بدلاً من تسجيلها كبيانات شخصية بلا معيار. ${llm?.rationaleAr ?? merged.rationaleAr}`
          : (metadataConflict ? "مشكلة جودة بيانات: اسم العمود ووصفه غير متطابقين، لذا البيانات الوصفية غير موثوقة — مُعلّقة للمراجعة. " : "") +
            (llm?.rationaleAr ?? merged.rationaleAr),
    ),
    sourceLayers: [
      ...merged.contributingLayers,
      ...(llm ? ["llm"] : []),
      ...(metadataConflict ? ["metadata_conflict"] : []),
      ...(llmFailed ? ["llm_unavailable"] : []),
      ...(divergence ? ["self_consistency"] : []),
    ],
    conflict: merged.conflict,
    assessments,
    inputHash,
    cached,
  };
}

export async function inferPiiForAttribute(
  input: DetectionInput,
  ctx: InferContext,
  deps: InferDeps,
): Promise<PiiInferenceOut> {
  const base = deterministicBase(input, ctx);
  if (canShortCircuit(input, ctx, base)) return operationalNotPii(input, ctx, base.inputHash);

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

    const hit = ctx.useCache && !ctx.forceFresh ? await readCache(base.inputHash) : undefined;
    if (hit) {
      llm = hit as unknown as PiiAssessment;
      cached = true;
    } else if (ctx.selfConsistencySamples > 1) {
      // §7.4: N samples with distinct seeds; unanimous -> that verdict, else uncertain.
      const samples: PiiAssessment[] = [];
      for (let i = 0; i < ctx.selfConsistencySamples; i++) {
        const r = await inferFn(base.canonical, ctx.systemPrompt, ctx.seed + i);
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
        if (ctx.useCache) await writeCache(base.inputHash, llm as unknown as Record<string, unknown>);
      }
    } else {
      llm = await inferFn(base.canonical, ctx.systemPrompt, ctx.seed);
      // Only persist to the cache when caching is enabled (force-fresh still writes).
      if (llm && ctx.useCache) await writeCache(base.inputHash, llm as unknown as Record<string, unknown>);
    }
  }

  // A configured LLM attempted but with no result (rate limit / timeout / unreachable) must NOT
  // silently fall through to not_pii — assembleInference surfaces it as uncertain for review.
  const llmFailed = !deps.infer && isAiConfigured() && !cached && llm === null;
  return assembleInference(input, ctx, base, { llm, cached, llmFailed, divergence });
}

const PII_ASSESS_BATCH_SCHEMA: JsonSchemaSpec = {
  name: "pii_assessment_batch",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: { type: "array", items: PII_ASSESS_SCHEMA.schema },
    },
  },
};

/** One LLM call for several columns (C2 prototype). Explicitly instructs per-column independence
 *  to avoid the "the table has PII so every column is PII" halo. One assessment per payload. */
async function defaultBatchInfer(payloads: CanonicalAttribute[], systemPrompt: string, seed?: number): Promise<(PiiAssessment | null)[]> {
  for (const p of payloads) assertNoDataValues(p as unknown as Record<string, unknown>);
  const prompt =
    `Assess EACH of the following ${payloads.length} attributes INDEPENDENTLY against all five criteria, using ONLY that attribute's own metadata. ` +
    `Judge every attribute on its OWN column — do NOT let one attribute's personal data influence another's verdict; each is a separate decision. ` +
    `Return {"items": [...]} where items[i] is the assessment for attributes[i], in the same order.\n\nattributes:\n${JSON.stringify(payloads, null, 2)}`;
  try {
    // The batch output is ~N full assessments; scale the token budget with N (the default
    // 3000 truncates the JSON for N≳4, which then fails to parse and drops the whole chunk).
    const raw = await aiComplete({
      system: systemPrompt,
      prompt,
      schema: PII_ASSESS_BATCH_SCHEMA,
      temperature: 0,
      topP: 1,
      seed,
      maxTokens: Math.min(16000, 2500 + 1500 * payloads.length),
    });
    const parsed = extractJson<{ items: PiiAssessment[] }>(raw);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return payloads.map((_, i) => items[i] ?? null);
  } catch (err) {
    if (err instanceof AiUnavailableError) return payloads.map(() => null);
    throw err;
  }
}

/** Batch variant of inferPiiForAttribute: short-circuits + cache-hits resolve per column; the
 *  remaining misses go out in ONE LLM call. Returns one result per input, in order. */
export async function inferPiiForBatch(inputs: DetectionInput[], ctx: InferContext, deps: InferDeps): Promise<PiiInferenceOut[]> {
  const bases = inputs.map((inp) => deterministicBase(inp, ctx));
  const results: (PiiInferenceOut | null)[] = new Array(inputs.length).fill(null);

  const inferFn = deps.infer ?? (isAiConfigured() ? defaultInfer() : undefined);
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

  const pending: number[] = [];
  for (let i = 0; i < inputs.length; i++) {
    if (canShortCircuit(inputs[i], ctx, bases[i])) {
      results[i] = operationalNotPii(inputs[i], ctx, bases[i].inputHash);
      continue;
    }
    if (!inferFn) {
      results[i] = assembleInference(inputs[i], ctx, bases[i], { llm: null, cached: false, llmFailed: false, divergence: null });
      continue;
    }
    if (ctx.useCache && !ctx.forceFresh) {
      const hit = await readCache(bases[i].inputHash);
      if (hit) {
        results[i] = assembleInference(inputs[i], ctx, bases[i], { llm: hit as unknown as PiiAssessment, cached: true, llmFailed: false, divergence: null });
        continue;
      }
    }
    pending.push(i);
  }

  if (pending.length > 0 && inferFn) {
    const payloads = pending.map((i) => bases[i].canonical);
    // Injected single-column stub (tests) → map per column; real path → one batched call.
    const batchOut = deps.infer
      ? await Promise.all(payloads.map((p) => deps.infer!(p, ctx.systemPrompt, ctx.seed)))
      : await defaultBatchInfer(payloads, ctx.systemPrompt, ctx.seed);
    for (let k = 0; k < pending.length; k++) {
      const i = pending[k];
      const llm = batchOut[k] ?? null;
      if (llm && ctx.useCache) await writeCache(bases[i].inputHash, llm as unknown as Record<string, unknown>);
      results[i] = assembleInference(inputs[i], ctx, bases[i], { llm, cached: false, llmFailed: llm === null, divergence: null });
    }
  }

  return results.map((r, i) => r ?? assembleInference(inputs[i], ctx, bases[i], { llm: null, cached: false, llmFailed: false, divergence: null }));
}
