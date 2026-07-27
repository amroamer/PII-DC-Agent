/**
 * Classification LLM layer — the confidentiality analogue of the PII inference in
 * server/engine/infer.ts. Given ONLY metadata (column name, EN/AR description, data
 * type, parent asset context, sibling column names) plus the attribute's PII
 * assessment as context, it judges the confidentiality IMPACT and returns a level
 * on the DGE scale (OPEN < CONFIDENTIAL < SENSITIVE < SECRET).
 *
 * It is ESCALATE-ONLY: the caller reconciles the returned level with a governance
 * floor (personal data / IKC), so this layer can only RAISE a column above the
 * CONFIDENTIAL default — never lower it. NEVER sees data values (assertNoDataValues).
 *
 * Cache-first and injectable, mirroring inferPiiForAttribute so a run is deterministic
 * and a cache hit makes zero network calls. Degrades to null (skipped) when the AI
 * endpoint is unconfigured/unreachable, so a run still completes offline.
 */
import {
  aiComplete,
  assertNoDataValues,
  extractJson,
  isAiConfigured,
  AiUnavailableError,
  type JsonSchemaSpec,
} from "../ai-provider";
import {
  CLASSIFICATION_CODES,
  isClassificationCode,
  type ClassificationCode,
} from "@shared/lib/classification";
import type { CriterionCode } from "@shared/lib/criteria";
import type { DetectionVerdict } from "@shared/models/schema";
import type { DetectionInput } from "../pii-engine/types";
import { canonicalizeAttribute, computeInputHash, type CanonicalAttribute } from "../pii-engine/canonicalize";
import { getCached, putCache } from "../engine/cache";

/** Distinct from PII_SCHEMA_VERSION so classification cache keys never collide with PII entries. */
export const CLASS_SCHEMA_VERSION = "class-assess-v1";

/** PII context handed to the classifier so enforcement/personal signals inform the level. */
export interface PiiContext {
  verdict: DetectionVerdict;
  criterion: CriterionCode | null;
  isSpecialCategory: boolean;
}

export interface ClassAssessment {
  level: ClassificationCode;
  confidence: number;
  rationaleEn: string;
  rationaleAr: string;
  signals: string[];
}

export interface ClassInferContext {
  modelId: string;
  promptVersion: string;
  frameworkVersion: string;
  frameworkVersionId: number | null;
  engineVersion: string;
  useCache: boolean;
  forceFresh: boolean;
  systemPrompt: string;
  seed: number;
  includeArabic: boolean;
}

export interface ClassInferDeps {
  infer?: (
    payload: CanonicalAttribute,
    pii: PiiContext,
    systemPrompt: string,
    seed?: number,
  ) => Promise<ClassAssessment | null>;
  getCached?: (hash: string) => Promise<Record<string, unknown> | undefined>;
  putCache?: (hash: string, response: Record<string, unknown>) => Promise<void>;
}

export interface ClassInferenceOut {
  /** null when the LLM layer was skipped (unconfigured) or failed — caller falls back to the rule floor. */
  level: ClassificationCode | null;
  confidence: number;
  rationaleEn: string;
  rationaleAr: string;
  signals: string[];
  inputHash: string;
  cached: boolean;
}

const CLASS_ASSESS_SCHEMA: JsonSchemaSpec = {
  name: "classification_assessment",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["level", "confidence", "rationaleEn", "rationaleAr", "signals"],
    properties: {
      level: { type: "string", enum: [...CLASSIFICATION_CODES] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      rationaleEn: { type: "string" },
      rationaleAr: { type: "string" },
      signals: { type: "array", items: { type: "string" } },
    },
  },
};

/** Default LLM caller (used when no stub is injected and the AI endpoint is configured). */
export function defaultClassInfer(): ClassInferDeps["infer"] {
  return async (payload, pii, systemPrompt, seed) => {
    assertNoDataValues(payload as unknown as Record<string, unknown>);
    const prompt =
      `Classify the confidentiality of the following attribute using ONLY this metadata and PII context:\n` +
      `${JSON.stringify(payload, null, 2)}\n\nPII assessment (context): ${JSON.stringify({
        verdict: pii.verdict,
        criterion: pii.criterion,
        specialCategory: pii.isSpecialCategory,
      })}`;
    try {
      const raw = await aiComplete({
        system: systemPrompt,
        prompt,
        schema: CLASS_ASSESS_SCHEMA,
        temperature: 0,
        topP: 1,
        seed,
      });
      return extractJson<ClassAssessment>(raw);
    } catch (err) {
      if (err instanceof AiUnavailableError) return null;
      throw err;
    }
  };
}

/**
 * The classification cache key must change when the PII context changes (a column
 * re-verdicted personal must be re-judged), so the PII context is folded into the
 * hash material alongside the system prompt.
 */
function classHashSystemPrompt(systemPrompt: string, pii: PiiContext): string {
  return `${systemPrompt}\n[pii:${pii.verdict}/${pii.criterion ?? "none"}/${pii.isSpecialCategory ? "special" : "normal"}]`;
}

export async function inferClassificationLevel(
  input: DetectionInput,
  pii: PiiContext,
  ctx: ClassInferContext,
  deps: ClassInferDeps,
): Promise<ClassInferenceOut> {
  const canonical = canonicalizeAttribute(
    input.attribute,
    { name: input.asset.name, businessDomain: input.asset.businessDomain, subjectArea: input.asset.subjectArea },
    input.siblingColumnNames,
  );

  const inputHash = computeInputHash({
    payload: canonical,
    promptVersion: ctx.promptVersion,
    frameworkVersion: ctx.frameworkVersion,
    modelId: ctx.modelId,
    engineVersion: ctx.engineVersion,
    schemaVersion: CLASS_SCHEMA_VERSION,
    systemPrompt: classHashSystemPrompt(ctx.systemPrompt, pii),
  });

  const empty = (level: ClassificationCode | null, cached: boolean): ClassInferenceOut => ({
    level,
    confidence: 0,
    rationaleEn: "",
    rationaleAr: "",
    signals: [],
    inputHash,
    cached,
  });

  const inferFn = deps.infer ?? (isAiConfigured() ? defaultClassInfer() : undefined);
  if (!inferFn) return empty(null, false);

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
        schemaVersion: CLASS_SCHEMA_VERSION,
      }));

  const hit = ctx.useCache && !ctx.forceFresh ? await readCache(inputHash) : undefined;
  let assessment: ClassAssessment | null;
  let cached = false;
  if (hit) {
    assessment = hit as unknown as ClassAssessment;
    cached = true;
  } else {
    assessment = await inferFn(canonical, pii, ctx.systemPrompt, ctx.seed);
    if (assessment && ctx.useCache) await writeCache(inputHash, assessment as unknown as Record<string, unknown>);
  }

  if (!assessment) return empty(null, cached);

  const level = isClassificationCode(assessment.level) ? assessment.level : null;
  const ar = (s: string) => (ctx.includeArabic ? s : "");
  return {
    level,
    confidence: Math.max(0, Math.min(1, Number(assessment.confidence) || 0)),
    rationaleEn: assessment.rationaleEn ?? "",
    rationaleAr: ar(assessment.rationaleAr ?? ""),
    signals: Array.isArray(assessment.signals) ? assessment.signals : [],
    inputHash,
    cached,
  };
}
