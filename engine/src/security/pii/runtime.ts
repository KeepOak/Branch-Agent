// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:packages/api/src/protection/runtime.ts (atlas SAFETY-0062)
import { recordAuditFinding } from "./audit.js";
import type {
  PatternContentInspector,
  PatternContentInspectorConfig,
} from "./detectors/pattern.js";
import { createPatternContentInspector, PatternConfigurationError } from "./detectors/pattern.js";
import {
  MAX_PII_PATTERN_ID_LENGTH,
  MAX_PII_PATTERNS_PER_SOURCE,
  type FilterPiiAction,
  type FiltersConfig,
} from "./filters.js";
import type { ContentSource, ProtectionFinding, TextContentFragment } from "./types.js";

interface CompiledFilter {
  readonly detectorId: string;
  readonly action: FilterPiiAction;
  readonly sources: ReadonlySet<ContentSource>;
  readonly fields: ReadonlySet<string> | null;
  readonly inspector: PatternContentInspector;
}

export interface ContentInspectionConfig {
  readonly filters?: FiltersConfig;
}

export interface ConfiguredContentInspector {
  readonly hasAuditRules: boolean;
  createSession(): ConfiguredContentInspectionSession;
  inspect(fragments: Iterable<TextContentFragment>): ProtectionFinding | null;
}

export interface ConfiguredContentInspectionSession {
  readonly hasAuditRules: boolean;
  inspectFragment(fragment: TextContentFragment): ProtectionFinding | null;
  inspect(fragments: Iterable<TextContentFragment>): ProtectionFinding | null;
}

const FILTER_INSPECTOR_CACHE = new WeakMap<object, ConfiguredContentInspector>();
const MAX_INSPECTION_DEDUPE_ENTRIES_PER_RULE = 4_096;

interface FilterCompilationPlan {
  readonly detectorId: string;
  readonly action: FilterPiiAction;
  readonly config: PatternContentInspectorConfig;
  readonly sources: readonly ContentSource[];
  readonly fields: ReadonlySet<string> | null;
}

function fieldsError(message: string): PatternConfigurationError {
  return new PatternConfigurationError(`[security.contentFilters.pii] ${message}`);
}

function readFieldCount(candidate: unknown): number {
  let isArray: boolean;
  try {
    isArray = Array.isArray(candidate);
  } catch {
    throw fieldsError("fields could not be inspected safely");
  }
  if (!isArray) {
    throw fieldsError("fields must be an array");
  }
  let fieldCount: number;
  try {
    fieldCount = (candidate as readonly unknown[]).length;
  } catch {
    throw fieldsError("fields could not be read safely");
  }
  if (
    !Number.isSafeInteger(fieldCount) ||
    fieldCount < 0 ||
    fieldCount > MAX_PII_PATTERNS_PER_SOURCE
  ) {
    throw fieldsError(`fields may contain at most ${MAX_PII_PATTERNS_PER_SOURCE} entries`);
  }
  return fieldCount;
}

function snapshotFilterFields(
  config: PatternContentInspectorConfig & { readonly fields?: readonly string[] },
): ReadonlySet<string> | null {
  let candidate: unknown;
  try {
    candidate = config.fields;
  } catch {
    throw fieldsError("fields could not be read safely");
  }
  if (candidate == null) {
    return null;
  }
  const fieldCount = readFieldCount(candidate);
  const fields = new Set<string>();
  for (let index = 0; index < fieldCount; index++) {
    let field: unknown;
    try {
      field = (candidate as readonly unknown[])[index];
    } catch {
      throw fieldsError("fields could not be read safely");
    }
    if (
      typeof field !== "string" ||
      field.length === 0 ||
      field.length > MAX_PII_PATTERN_ID_LENGTH
    ) {
      throw fieldsError("fields contains an invalid value");
    }
    fields.add(field);
  }
  return fields;
}

function appendFilterPlan(
  plans: FilterCompilationPlan[],
  config:
    | (PatternContentInspectorConfig & {
        readonly action?: FilterPiiAction;
        readonly fields?: readonly string[];
      })
    | undefined,
  sources: readonly ContentSource[],
): void {
  if (config == null) {
    return;
  }
  plans.push({
    detectorId: "pii-pattern",
    action: config.action ?? "block",
    config,
    sources,
    fields: snapshotFilterFields(config),
  });
}

function getFilterCompilationPlans(filters: FiltersConfig): FilterCompilationPlan[] {
  const plans: FilterCompilationPlan[] = [];
  try {
    appendFilterPlan(plans, filters.toolArguments?.pii, ["tool_argument"]);
  } catch (error) {
    if (error instanceof PatternConfigurationError) {
      throw error;
    }
    throw fieldsError("filters could not be read safely");
  }
  return plans;
}

function compilePlans(plans: readonly FilterCompilationPlan[]): readonly CompiledFilter[] {
  const compiled: CompiledFilter[] = [];
  for (const plan of plans) {
    const inspector = createPatternContentInspector(plan.config);
    if (!inspector.active) {
      continue;
    }
    compiled.push({
      detectorId: plan.detectorId,
      action: plan.action,
      sources: new Set(plan.sources),
      fields: plan.fields,
      inspector,
    });
  }
  return compiled;
}

type RuleEntry = readonly [number, CompiledFilter];

function indexRulesBySource(rules: readonly CompiledFilter[]): Map<ContentSource, RuleEntry[]> {
  const rulesBySource = new Map<ContentSource, RuleEntry[]>();
  rules.forEach((rule, ruleIndex) => {
    for (const source of rule.sources) {
      const sourceRules = rulesBySource.get(source);
      if (sourceRules == null) {
        rulesBySource.set(source, [[ruleIndex, rule]]);
      } else {
        sourceRules.push([ruleIndex, rule]);
      }
    }
  });
  return rulesBySource;
}

function recordRuleAuditFinding(rule: CompiledFilter, finding: ProtectionFinding): void {
  recordAuditFinding({
    action: rule.action,
    detectorId: finding.detectorId,
    ruleId: finding.ruleId,
    label: finding.label,
    source: finding.source,
    field: finding.field,
    provenance: finding.provenance,
  });
}

/** Returns true when this rule already inspected the text in the current session. */
function alreadyInspected(
  inspectedTextByRule: Array<Set<string> | undefined>,
  ruleIndex: number,
  text: string,
): boolean {
  const inspectedText = (inspectedTextByRule[ruleIndex] ??= new Set<string>());
  if (inspectedText.has(text)) {
    return true;
  }
  if (inspectedText.size < MAX_INSPECTION_DEDUPE_ENTRIES_PER_RULE) {
    inspectedText.add(text);
  }
  return false;
}

function createFragmentInspector(
  rulesBySource: Map<ContentSource, RuleEntry[]>,
  hasAuditRules: boolean,
) {
  return (
    fragment: TextContentFragment,
    inspectedTextByRule: Array<Set<string> | undefined>,
  ): ProtectionFinding | null => {
    let firstBlockingFinding: ProtectionFinding | null = null;
    for (const [ruleIndex, rule] of rulesBySource.get(fragment.source) ?? []) {
      if (rule.fields != null && !rule.fields.has(fragment.field)) {
        continue;
      }
      if (alreadyInspected(inspectedTextByRule, ruleIndex, fragment.text)) {
        continue;
      }
      const finding = rule.inspector.inspectFragment(fragment);
      if (finding == null) {
        continue;
      }
      const configuredFinding = { ...finding, detectorId: rule.detectorId };
      if (rule.action === "audit") {
        recordRuleAuditFinding(rule, configuredFinding);
        continue;
      }
      firstBlockingFinding ??= configuredFinding;
      if (!hasAuditRules) {
        return firstBlockingFinding;
      }
    }
    return firstBlockingFinding;
  };
}

function createInspector(rules: readonly CompiledFilter[]): ConfiguredContentInspector {
  const hasAuditRules = rules.some((rule) => rule.action === "audit");
  const inspectFragment = createFragmentInspector(indexRulesBySource(rules), hasAuditRules);
  const inspect = (
    fragments: Iterable<TextContentFragment>,
    inspectedTextByRule: Array<Set<string> | undefined>,
  ): ProtectionFinding | null => {
    let firstBlockingFinding: ProtectionFinding | null = null;
    for (const fragment of fragments) {
      const finding = inspectFragment(fragment, inspectedTextByRule);
      firstBlockingFinding ??= finding;
      if (firstBlockingFinding != null && !hasAuditRules) {
        break;
      }
    }
    return firstBlockingFinding;
  };
  const createSession = (): ConfiguredContentInspectionSession => {
    const inspectedTextByRule: Array<Set<string> | undefined> = Array.from({
      length: rules.length,
    });
    return {
      hasAuditRules,
      inspectFragment: (fragment) => inspectFragment(fragment, inspectedTextByRule),
      inspect: (fragments) => inspect(fragments, inspectedTextByRule),
    };
  };
  return {
    hasAuditRules,
    createSession,
    inspect: (fragments) => inspect(fragments, Array.from({ length: rules.length })),
  };
}

export function createConfiguredContentInspector(
  config: ContentInspectionConfig,
): ConfiguredContentInspector | null {
  const { filters } = config;
  if (filters == null) {
    return null;
  }
  const cached = FILTER_INSPECTOR_CACHE.get(filters);
  if (cached != null) {
    return cached;
  }
  const plans = getFilterCompilationPlans(filters);
  const rules = compilePlans(plans);
  if (rules.length === 0) {
    return null;
  }
  const inspector = createInspector(rules);
  FILTER_INSPECTOR_CACHE.set(filters, inspector);
  return inspector;
}

export function inspectContent(
  fragments: Iterable<TextContentFragment>,
  config: ContentInspectionConfig,
): ProtectionFinding | null {
  return createConfiguredContentInspector(config)?.inspect(fragments) ?? null;
}
