/**
 * Layer 3 — semantic inference via aiComplete(). Sends ONLY metadata: column name,
 * EN + AR description, data type, parent asset name/domain, and sibling column
 * names. NEVER data values (enforced by assertNoDataValues). Returns strict JSON.
 *
 * If the AI endpoint is not configured/unreachable the layer degrades to null
 * (skipped) so a detection run still completes offline — it never crashes.
 */
import type { DetectionInput, DetectionSignal, EngineContext } from "../types";
import {
  aiComplete,
  assertNoDataValues,
  extractJson,
  isAiConfigured,
  AiUnavailableError,
  type JsonSchemaSpec,
} from "../../ai-provider";
import { getPrompt } from "../../reference-cache";
import { CRITERION_CODES, isCriterionCode, type CriterionCode } from "@shared/lib/criteria";
import type { DetectionVerdict } from "@shared/models/schema";

interface LlmResult {
  verdict: DetectionVerdict;
  criterion: CriterionCode;
  dataClass: string | null;
  confidence: number;
  rationaleEn: string;
  rationaleAr: string;
  signals: string[];
}

// Strict json_schema — raw JSON only, no prose, no fences.
export const PII_LLM_SCHEMA: JsonSchemaSpec = {
  name: "pii_detection",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "verdict",
      "criterion",
      "dataClass",
      "confidence",
      "rationaleEn",
      "rationaleAr",
      "signals",
    ],
    properties: {
      verdict: { type: "string", enum: ["pii", "not_pii", "uncertain"] },
      criterion: { type: "string", enum: [...CRITERION_CODES] },
      dataClass: { type: ["string", "null"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      rationaleEn: { type: "string" },
      rationaleAr: { type: "string" },
      signals: { type: "array", items: { type: "string" } },
    },
  },
};

export async function runLlmLayer(
  input: DetectionInput,
  ctx: EngineContext,
): Promise<DetectionSignal | null> {
  if (!ctx.useLlmLayer || !isAiConfigured()) return null;

  // Metadata-only payload. assertNoDataValues throws if a non-metadata key slips in.
  const payload = {
    columnName: input.attribute.columnName,
    descriptionEn: input.attribute.descriptionEn ?? "",
    descriptionAr: input.attribute.descriptionAr ?? "",
    dataType: input.attribute.dataType ?? "",
    assetName: input.asset.name,
    businessDomain: input.asset.businessDomain ?? "",
    subjectArea: input.asset.subjectArea ?? "",
    siblingColumns: input.siblingColumnNames.join(", "),
  };
  assertNoDataValues(payload);

  const prompt = `Classify the following attribute using ONLY this metadata:\n${JSON.stringify(payload, null, 2)}`;

  try {
    const raw = await aiComplete({
      system: getPrompt("pii_detection_classify"),
      prompt,
      schema: PII_LLM_SCHEMA,
      temperature: 0,
    });
    const parsed = extractJson<LlmResult>(raw);
    return normalize(parsed);
  } catch (err) {
    if (err instanceof AiUnavailableError) return null;
    // Malformed model output -> record an uncertain signal so merge flags review.
    return {
      layer: "llm",
      verdict: "uncertain",
      criterion: null,
      dataClassCode: null,
      confidence: 0,
      rationaleEn: "The LLM layer returned a response that could not be parsed.",
      rationaleAr: "أعادت طبقة النموذج اللغوي استجابة تعذّر تحليلها.",
      signals: ["llm_parse_error"],
      evidence: { error: String(err) },
    };
  }
}

function normalize(result: LlmResult): DetectionSignal {
  const verdict: DetectionVerdict = ["pii", "not_pii", "uncertain"].includes(result.verdict)
    ? result.verdict
    : "uncertain";
  const criterion = isCriterionCode(result.criterion) ? result.criterion : null;
  const confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0));

  return {
    layer: "llm",
    verdict,
    criterion: verdict === "pii" ? criterion : verdict === "uncertain" ? criterion : null,
    dataClassCode: result.dataClass ?? null,
    confidence,
    rationaleEn: result.rationaleEn ?? "",
    rationaleAr: result.rationaleAr ?? "",
    signals: Array.isArray(result.signals) ? result.signals : [],
    evidence: { llmDataClass: result.dataClass, rawConfidence: result.confidence },
  };
}
