// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:packages/api/src/protection/adapters/messages.ts (atlas SAFETY-0062)
import { aggregateAuditFindingsSync, recordAuditFinding } from "../audit.js";
import type { FilterPiiConfig, FiltersConfig, ToolArgumentFilterField } from "../filters.js";
import { createConfiguredContentInspector } from "../runtime.js";
import { createPiiTextTransformer, PiiTransformationError } from "../transform.js";
import type {
  ContentFormat,
  ContentTreatment,
  JsonPointer,
  ProtectionFinding,
  TextContentFragment,
} from "../types.js";
import { escapeJsonPointer, visitNestedStrings } from "./nested.js";

/** Upstream ContentTraversalLimitError message for content that could not be fully read. */
export const UNINSPECTABLE_TOOL_ARGUMENTS_REASON =
  "Submitted content could not be completely inspected before processing.";

const ARGUMENTS_ROOT: JsonPointer = "/arguments";

export interface ToolArgumentExtraction {
  readonly fragments: readonly TextContentFragment[];
  /** False when a depth, node or reflection budget stopped the traversal. */
  readonly complete: boolean;
}

export type ToolArgumentPiiDecision =
  | { readonly kind: "allow"; readonly params: unknown }
  | { readonly kind: "block"; readonly reason: string };

function createToolArgumentFragment(
  id: string,
  path: JsonPointer,
  text: string,
  field: ToolArgumentFilterField,
  format: ContentFormat,
  treatment: ContentTreatment,
): TextContentFragment {
  return { id, path, text, source: "tool_argument", field, format, treatment, provenance: "model" };
}

/**
 * Model-proposed tool calls: the tool name is inspect-only, and every textual
 * argument leaf becomes a replaceable fragment addressed by its JSON pointer.
 */
export function extractToolArgumentContent(
  toolName: string,
  params: unknown,
): ToolArgumentExtraction {
  const fragments: TextContentFragment[] = [];
  if (toolName.length > 0) {
    fragments.push(
      createToolArgumentFragment(
        "tool-call.name",
        "/name",
        toolName,
        "name",
        "plain",
        "inspect_only",
      ),
    );
  }
  const complete = visitNestedStrings(params, ARGUMENTS_ROOT, (text, path) => {
    fragments.push(
      createToolArgumentFragment(
        "tool-call.arguments",
        path,
        text,
        "arguments",
        "plain",
        "replaceable",
      ),
    );
  });
  return { fragments, complete };
}

function replaceStringLeaves(
  value: unknown,
  path: string,
  replacements: ReadonlyMap<string, string>,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") {
    return replacements.get(path) ?? value;
  }
  if (value == null || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      replaceStringLeaves(item, `${path}/${index}`, replacements, seen),
    );
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      replaceStringLeaves(entry, `${path}/${escapeJsonPointer(key)}`, replacements, seen),
    ]),
  );
}

const TRANSFORMER_CACHE = new WeakMap<object, ReturnType<typeof createPiiTextTransformer>>();

function transformerFor(pii: FilterPiiConfig, tokenSecret: string | undefined) {
  if (tokenSecret) {
    return createPiiTextTransformer(pii, { tokenSecret });
  }
  let transformer = TRANSFORMER_CACHE.get(pii);
  if (transformer == null) {
    transformer = createPiiTextTransformer(pii);
    TRANSFORMER_CACHE.set(pii, transformer);
  }
  return transformer;
}

function blockedReason(finding: ProtectionFinding): string {
  return `Tool call blocked by the personal data filter: the arguments contain a ${finding.label}.`;
}

/** Rewrites matched argument leaves to placeholders; any untransformable match fails closed. */
function redactToolArguments(
  params: unknown,
  extraction: ToolArgumentExtraction,
  filters: FiltersConfig,
  pii: FilterPiiConfig,
  finding: ProtectionFinding,
): ToolArgumentPiiDecision {
  const session = transformerFor(pii, filters.tokenSecret).createSession();
  const replacements = new Map<string, string>();
  try {
    for (const fragment of extraction.fragments) {
      const result = session.transform(fragment);
      if (result.replacements > 0) {
        replacements.set(fragment.path, result.content);
      }
    }
  } catch (error) {
    if (error instanceof PiiTransformationError) {
      return { kind: "block", reason: blockedReason(finding) };
    }
    throw error;
  }
  recordAuditFinding({
    action: "redact",
    detectorId: finding.detectorId,
    ruleId: finding.ruleId,
    label: finding.label,
    source: finding.source,
    field: finding.field,
    provenance: finding.provenance,
  });
  return {
    kind: "allow",
    params: replaceStringLeaves(params, ARGUMENTS_ROOT, replacements, new WeakSet<object>()),
  };
}

/**
 * Applies `security.contentFilters.toolArguments.pii` to one tool call: audit
 * findings are recorded, block findings veto the call, and redact findings
 * rewrite the matched values. Absent configuration leaves the call untouched.
 */
export function applyToolArgumentPiiPolicy(input: {
  readonly filters: FiltersConfig | undefined;
  readonly toolName: string;
  readonly params: unknown;
}): ToolArgumentPiiDecision {
  const { filters, params } = input;
  const pii = filters?.toolArguments?.pii;
  const inspector = filters && pii ? createConfiguredContentInspector({ filters }) : null;
  if (!filters || !pii || inspector == null) {
    return { kind: "allow", params };
  }
  return aggregateAuditFindingsSync((): ToolArgumentPiiDecision => {
    const extraction = extractToolArgumentContent(input.toolName, params);
    const finding = inspector.createSession().inspect(extraction.fragments);
    const action = pii.action ?? "block";
    if (finding != null && action !== "redact") {
      return { kind: "block", reason: blockedReason(finding) };
    }
    if (!extraction.complete && action !== "audit") {
      return { kind: "block", reason: UNINSPECTABLE_TOOL_ARGUMENTS_REASON };
    }
    if (finding != null) {
      return redactToolArguments(params, extraction, filters, pii, finding);
    }
    return { kind: "allow", params };
  });
}
