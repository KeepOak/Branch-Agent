// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:agent/auxiliary_client.py (atlas AGENT-LOOP-0073)
/**
 * In-place request repair for provider 400s that reject one request parameter by name.
 *
 * Mirrors the upstream parameter ladder: each rung strips one field family at most once and
 * only when that field was on the wire, so an unchanged request is never re-sent and a request
 * with N rejected fields recovers in at most N retries.
 */
import { isRecord } from "@branch/normalization-core/record-coerce";

/** Generic "this parameter is not accepted" phrasings (agent/error_classifier.py). */
export const UNSUPPORTED_PARAM_MARKERS = [
  "unsupported parameter",
  "unsupported_parameter",
  "not supported",
  "does not support",
  "doesn't support",
  "is deprecated for this model",
  "unknown parameter",
  "unrecognized request argument",
  "unrecognized parameter",
  "invalid parameter",
  "extra inputs are not permitted",
  "invalid option: expected one of",
] as const;

// Standalone reasoning wire-field names; never a model-id segment nor "... reasoning models".
const REASONING_FIELD_TOKEN =
  /(?<![\w\-/])(?:reasoning_effort|thinking_config|thinking_budget|enable_thinking|thinkingconfig|thinkingbudget|reasoning|thinking|think)(?![\w\-/])(?!\s+models?\b)/;
const REASONING_PARAM_REJECTION =
  /['"]param['"]\s*:\s*['"](?:reasoning(?:[._]effort)?|thinking(?:_config|_budget)?|enable_thinking)['"]|invalid_reasoning_effort/;
const REASONING_WIRE_KEYS = ["reasoning_effort", "reasoning", "thinking", "enable_thinking"];
const TEMPLATE_REASONING_KEYS = new Set(["enable_thinking", "thinking"]);

export type RequestParams = Record<string, unknown>;

export type RequestRepairRungId = "temperature" | "structured-output" | "reasoning" | "max-tokens";

export type RequestParameterRepair = {
  rung: RequestRepairRungId;
  params: RequestParams;
};

type RequestRepairRung = {
  id: RequestRepairRungId;
  matches: (text: string) => boolean;
  strip: (params: RequestParams) => RequestParams | undefined;
};

function containsAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

/** Lower-cased error text: message plus any structured provider body. */
export function describeRequestError(error: unknown): string {
  if (!isRecord(error)) {
    return String(error ?? "").toLowerCase();
  }
  const parts: string[] = [];
  if (typeof error.message === "string") {
    parts.push(error.message);
  }
  for (const key of ["error", "body"] as const) {
    const value = error[key];
    if (value === undefined) {
      continue;
    }
    try {
      parts.push(typeof value === "string" ? value : JSON.stringify(value));
    } catch {
      // An unserializable body adds nothing the message does not already carry.
    }
  }
  return parts.join(" ").toLowerCase();
}

function errorStatus(error: unknown): unknown {
  if (!isRecord(error)) {
    return undefined;
  }
  return error.status ?? error.statusCode ?? error.status_code;
}

/** Provider 400 for an unsupported request parameter: the name plus a generic marker. */
export function isUnsupportedParameterError(error: unknown, param: string): boolean {
  const paramLower = param.toLowerCase();
  if (!paramLower) {
    return false;
  }
  const text = describeRequestError(error);
  return text.includes(paramLower) && containsAny(text, UNSUPPORTED_PARAM_MARKERS);
}

/** Provider 400 rejecting a reasoning wire control by name, or a structured param naming one. */
export function isReasoningFieldRejection(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  if (REASONING_PARAM_REJECTION.test(msg)) {
    return true;
  }
  const token = REASONING_FIELD_TOKEN.exec(msg);
  if (!token) {
    return false;
  }
  const near = msg.slice(Math.max(0, token.index - 32), token.index + token[0].length + 32);
  return near.includes("unsupported") || containsAny(msg, UNSUPPORTED_PARAM_MARKERS);
}

/** Provider 400/422 rejecting the structured-output field (response_format). */
export function isStructuredOutputRejection(errorMessage: string): boolean {
  const text = errorMessage.toLowerCase();
  if (containsAny(text, ["guided_grammar", "xgrammar", "compile_grammar_error"])) {
    return true;
  }
  if (text.includes("extra inputs are not permitted") && text.includes("response_format")) {
    return true;
  }
  if (text.includes("response_format") && text.includes("unavailable")) {
    return true;
  }
  if (text.includes("response_format") && text.includes("json_schema")) {
    return true;
  }
  if (containsAny(text, ["response mime type", "response_schema", "response_json_schema"])) {
    return true;
  }
  return isUnsupportedParameterError(text, "response_format");
}

function withoutKeys(params: RequestParams, keys: readonly string[]): RequestParams | undefined {
  if (!keys.some((key) => params[key] !== undefined)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(params).filter(([key]) => !keys.includes(key)));
}

function withoutTemplateReasoning(next: RequestParams): boolean {
  const template = next.chat_template_kwargs;
  if (!isRecord(template)) {
    return false;
  }
  const remaining = Object.fromEntries(
    Object.entries(template).filter(([key]) => !TEMPLATE_REASONING_KEYS.has(key)),
  );
  if (Object.keys(remaining).length === Object.keys(template).length) {
    return false;
  }
  if (Object.keys(remaining).length > 0) {
    next.chat_template_kwargs = remaining;
  } else {
    delete next.chat_template_kwargs;
  }
  return true;
}

function withoutReasoningFields(params: RequestParams): RequestParams | undefined {
  const next: RequestParams = { ...params };
  let changed = false;
  for (const key of REASONING_WIRE_KEYS) {
    if (next[key] !== undefined) {
      delete next[key];
      changed = true;
    }
  }
  changed = withoutTemplateReasoning(next) || changed;
  return changed ? next : undefined;
}

function isMaxTokensRejection(text: string): boolean {
  return (
    text.includes("max_tokens") ||
    text.includes("unsupported_parameter") ||
    isUnsupportedParameterError(text, "max_tokens")
  );
}

// Ordered like upstream _parameter_rungs. The reasoning-floor rung is not ported: it needs
// per-route effort memory that Branch keeps in model compat flags instead.
const REQUEST_REPAIR_RUNGS: readonly RequestRepairRung[] = [
  {
    id: "temperature",
    matches: (text) => isUnsupportedParameterError(text, "temperature"),
    strip: (params) => withoutKeys(params, ["temperature"]),
  },
  {
    id: "structured-output",
    matches: isStructuredOutputRejection,
    strip: (params) => withoutKeys(params, ["response_format"]),
  },
  { id: "reasoning", matches: isReasoningFieldRejection, strip: withoutReasoningFields },
  {
    id: "max-tokens",
    matches: isMaxTokensRejection,
    strip: (params) => withoutKeys(params, ["max_tokens", "max_completion_tokens"]),
  },
];

/**
 * Return the request to retry after a parameter rejection, or undefined when no unused rung
 * matches a field that was actually sent. attempted records spent rungs across retries.
 */
export function repairRejectedRequestParams(
  params: RequestParams,
  error: unknown,
  attempted: Set<RequestRepairRungId>,
): RequestParameterRepair | undefined {
  const status = errorStatus(error);
  if (status !== undefined && status !== 400 && status !== 422) {
    return undefined;
  }
  const text = describeRequestError(error);
  for (const rung of REQUEST_REPAIR_RUNGS) {
    if (attempted.has(rung.id) || !rung.matches(text)) {
      continue;
    }
    const next = rung.strip(params);
    if (next) {
      attempted.add(rung.id);
      return { rung: rung.id, params: next };
    }
  }
  return undefined;
}

/**
 * Send a request, repairing and re-sending it in place while a provider rejects a parameter
 * that the ladder can strip. Aborted requests and non-parameter failures rethrow unchanged.
 */
export async function sendWithRequestParameterRepair<T>(
  params: RequestParams,
  send: (params: RequestParams) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const attempted = new Set<RequestRepairRungId>();
  let current = params;
  for (;;) {
    try {
      return await send(current);
    } catch (error) {
      const repair = signal?.aborted
        ? undefined
        : repairRejectedRequestParams(current, error, attempted);
      if (!repair) {
        throw error;
      }
      current = repair.params;
    }
  }
}
