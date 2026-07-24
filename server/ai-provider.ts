/**
 * Provider-agnostic wrapper around an OpenAI-compatible Chat Completions API.
 *
 * The ONLY place in the codebase that talks to an inference endpoint. Feature
 * code calls aiComplete() — it never constructs requests or reads OPENAI_* env
 * vars directly. Target deployment is a local/self-hosted endpoint (Ollama /
 * vLLM / LiteLLM) so metadata stays inside the ADC boundary.
 */

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export class MetadataBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetadataBoundaryError";
  }
}

export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

export interface AiCompleteParams {
  system?: string;
  prompt: string;
  /** "json" -> response_format json_object. Ignored when `schema` is provided. */
  responseFormat?: "text" | "json";
  /** strict json_schema structured output. */
  schema?: JsonSchemaSpec;
  temperature?: number;
  maxTokens?: number;
  /** Determinism knobs (Prompt 2 §7.1). top_p defaults to 1, n to 1. */
  topP?: number;
  seed?: number;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

function endpoint(): { baseUrl: string; model: string; apiKey: string } {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "").replace(/\/+$/, "");
  const model = process.env.OPENAI_MODEL ?? "";
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!baseUrl || !model) {
    throw new AiUnavailableError(
      "AI provider not configured — set OPENAI_BASE_URL and OPENAI_MODEL.",
    );
  }
  return { baseUrl, model, apiKey };
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_BASE_URL && process.env.OPENAI_MODEL);
}

/** Trivial completion to check reachability + catch silent model substitution. */
export async function testConnection(): Promise<{
  ok: boolean;
  latencyMs: number;
  configuredModel: string;
  returnedModel: string | null;
  error?: string;
}> {
  const configuredModel = process.env.OPENAI_MODEL ?? "";
  const start = Date.now();
  try {
    const { baseUrl, model, apiKey } = endpoint();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, temperature: 0 }),
    });
    const data = (await res.json().catch(() => ({}))) as { model?: string };
    return {
      ok: res.ok,
      latencyMs: Date.now() - start,
      configuredModel,
      returnedModel: data.model ?? null,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      configuredModel,
      returnedModel: null,
      error: (err as Error).message,
    };
  }
}

export async function aiComplete(params: AiCompleteParams): Promise<string> {
  const { baseUrl, model, apiKey } = endpoint();

  const messages: ChatMessage[] = [];
  if (params.system) messages.push({ role: "system", content: params.system });
  messages.push({ role: "user", content: params.prompt });

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: params.temperature ?? 0,
    top_p: params.topP ?? 1,
    n: 1,
    max_tokens: params.maxTokens ?? 800,
  };
  // A fixed seed makes greedy decoding reproducible on endpoints that honour it.
  if (params.seed !== undefined) body.seed = params.seed;

  if (params.schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: params.schema.name, schema: params.schema.schema, strict: true },
    };
  } else if (params.responseFormat === "json") {
    body.response_format = { type: "json_object" };
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AiUnavailableError(
      `AI endpoint unreachable at ${baseUrl}: ${(err as Error).message}`,
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AiUnavailableError(`AI endpoint returned ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  return typeof content === "string" ? content : JSON.stringify(content);
}

/**
 * Defensive JSON extraction. Structured endpoints are told to emit raw JSON only,
 * but local models sometimes wrap output in prose or ``` fences — tolerate that.
 */
export function extractJson<T = unknown>(raw: string): T {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    return JSON.parse(stripped) as T;
  } catch {
    const first = stripped.indexOf("{");
    const last = stripped.lastIndexOf("}");
    if (first !== -1 && last > first) {
      return JSON.parse(stripped.slice(first, last + 1)) as T;
    }
    throw new Error("Failed to extract a JSON object from model output.");
  }
}

/**
 * Metadata-only guarantee. The PII engine calls this before every LLM request:
 * the payload sent to the model may ONLY contain metadata fields, never anything
 * sourced from actual data rows. Throws if a disallowed key is present.
 */
const ALLOWED_METADATA_KEYS = new Set([
  "assetId",
  "columnName",
  "descriptionEn",
  "descriptionAr",
  "dataType",
  "nativeType",
  "assetName",
  "assetType",
  "businessDomain",
  "subjectArea",
  "siblingColumns",
  "selectedDataClassName",
  "suggestedClasses",
  "isPrimaryKey",
  "nullable",
  "piiName",
  "piiDescription",
]);

const FORBIDDEN_KEY_HINTS = ["value", "sample", "row", "record", "cell", "content"];

export function assertNoDataValues(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      throw new MetadataBoundaryError(
        `Field "${key}" is not an allowed metadata field. Only column/asset metadata may be sent to the model — never data values.`,
      );
    }
    const lower = key.toLowerCase();
    if (FORBIDDEN_KEY_HINTS.some((hint) => lower.includes(hint) && !ALLOWED_METADATA_KEYS.has(key))) {
      throw new MetadataBoundaryError(`Field "${key}" looks like it carries row data.`);
    }
  }
}
