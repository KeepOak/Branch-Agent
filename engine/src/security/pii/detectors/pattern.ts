// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:packages/api/src/protection/detectors/pattern.ts (atlas SAFETY-0062)
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import {
  compilePiiRegex,
  MAX_PII_CUSTOM_REGEX_CHARACTERS,
  MAX_PII_PATTERN_ID_LENGTH,
  MAX_PII_PATTERN_LABEL_LENGTH,
  MAX_PII_PATTERN_LENGTH,
  MAX_PII_PATTERNS_PER_SOURCE,
  type FilterPiiCategory,
  type FilterPiiCustomPatternConfig,
} from "../filters.js";
import type { ProtectionFinding, TextContentFragment } from "../types.js";
import { IDENTIFIER_DETECTORS } from "./identifiers.js";

const log = createSubsystemLogger("security/pii");

interface CompiledPattern {
  readonly id: string;
  readonly label: string;
  readonly pattern: RegExp;
  readonly category: FilterPiiCategory;
  readonly validate?: (value: string) => boolean;
}

interface PreparedCustomPattern {
  readonly id: string;
  readonly label: string;
  readonly regex: string;
  readonly category: FilterPiiCategory;
}

interface SnapshotPatternContentInspectorConfig {
  readonly starter: readonly CompiledPattern[];
  readonly custom: readonly PreparedCustomPattern[];
  readonly customPatterns: number;
  readonly regexCharacters: number;
}

interface PreparedPatternContentInspectorConfig {
  readonly starter: readonly CompiledPattern[];
  readonly custom: readonly CompiledPattern[];
  readonly cost: PatternContentInspectorResourceCost;
}

export class PatternConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatternConfigurationError";
  }
}

export function isPatternConfigurationError(error: unknown): error is PatternConfigurationError {
  return error instanceof PatternConfigurationError;
}

export interface PatternContentInspectorResourceCost {
  readonly customPatterns: number;
  readonly validCustomPatterns: number;
  readonly regexCharacters: number;
  readonly active: boolean;
}

export interface PatternTextMatch {
  readonly start: number;
  readonly end: number;
  readonly category: FilterPiiCategory;
  /** Declaration order of the matching rule; earlier rules win identical spans. */
  readonly priority: number;
}

export interface PatternContentInspector {
  readonly active: boolean;
  inspectFragment(fragment: TextContentFragment): ProtectionFinding | null;
  inspect(fragments: Iterable<TextContentFragment>): ProtectionFinding | null;
  /** Internal match locations, never safe to return as public finding metadata. */
  locate(text: string, maxMatches: number): readonly PatternTextMatch[];
}

export interface PatternContentInspectorConfig {
  readonly starterPatterns?: readonly string[];
  readonly customPatterns?: readonly FilterPiiCustomPatternConfig[];
}

const STARTER_PATTERNS: readonly CompiledPattern[] = [
  {
    id: "sk_prefix",
    label: "sk- prefix token",
    pattern: /\b(sk-)[a-zA-Z0-9_-]+/,
    category: "credential",
  },
  {
    id: "bearer_header",
    label: "Bearer token",
    pattern: /\b(Bearer )[^\s"']+/i,
    category: "credential",
  },
  {
    id: "api_key_header",
    label: "api-key header",
    pattern: /\b(api-key:?\s+)[^\s"']+/i,
    category: "credential",
  },
  ...IDENTIFIER_DETECTORS,
];

const STARTER_BY_ID = new Map(STARTER_PATTERNS.map((pattern) => [pattern.id, pattern]));
const SNAPSHOT_CONFIG_CACHE = new WeakMap<object, SnapshotPatternContentInspectorConfig>();
const PREPARED_CONFIG_CACHE = new WeakMap<object, PreparedPatternContentInspectorConfig>();
const INSPECTOR_CACHE = new WeakMap<object, PatternContentInspector>();
const GLOBAL_REGEX_CACHE = new WeakMap<RegExp, RegExp>();

function configurationError(message: string): PatternConfigurationError {
  return new PatternConfigurationError(`[security.contentFilters.pii] ${message}`);
}

function isArraySafely(candidate: unknown, name: string): candidate is readonly unknown[] {
  try {
    return Array.isArray(candidate);
  } catch {
    throw configurationError(`${name} could not be inspected safely`);
  }
}

function readBoundedArray(
  candidate: unknown,
  name: string,
): { readonly values: readonly unknown[]; readonly length: number } | null {
  if (candidate == null) {
    return null;
  }
  if (!isArraySafely(candidate, name)) {
    throw configurationError(`${name} must be an array`);
  }
  let length: number;
  try {
    length = candidate.length;
  } catch {
    throw configurationError(`${name} could not be read safely`);
  }
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_PII_PATTERNS_PER_SOURCE) {
    throw configurationError(`${name} may contain at most ${MAX_PII_PATTERNS_PER_SOURCE} entries`);
  }
  return { values: candidate, length };
}

function selectStarter(candidate: unknown): readonly CompiledPattern[] {
  const bounded = readBoundedArray(candidate, "starterPatterns");
  if (bounded == null) {
    return STARTER_PATTERNS;
  }
  const selected: CompiledPattern[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < bounded.length; index++) {
    let id: unknown;
    try {
      id = bounded.values[index];
    } catch {
      throw configurationError("starterPatterns could not be read safely");
    }
    if (typeof id !== "string" || id.length > MAX_PII_PATTERN_ID_LENGTH) {
      throw configurationError("starterPatterns contains an invalid identifier");
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const pattern = STARTER_BY_ID.get(id);
    if (pattern != null) {
      selected.push(pattern);
    }
  }
  return selected;
}

function readCustomPatternFields(
  candidate: object,
  index: number,
): { id: unknown; label: unknown; regex: unknown; category: unknown } {
  try {
    const value = candidate as {
      readonly id?: unknown;
      readonly label?: unknown;
      readonly regex?: unknown;
      readonly category?: unknown;
    };
    return { id: value.id, label: value.label, regex: value.regex, category: value.category };
  } catch {
    throw configurationError(`customPatterns[${index}] could not be read safely`);
  }
}

const CUSTOM_CATEGORIES: readonly string[] = [
  "email",
  "phone",
  "name",
  "credential",
  "custom",
  "national_id",
  "credit_card",
];

function readCustomPattern(candidate: unknown, index: number): FilterPiiCustomPatternConfig {
  if (
    candidate == null ||
    typeof candidate !== "object" ||
    isArraySafely(candidate, `customPatterns[${index}]`)
  ) {
    throw configurationError(`customPatterns[${index}] must be an object`);
  }
  const { id, label, regex, category } = readCustomPatternFields(candidate, index);
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_PII_PATTERN_ID_LENGTH) {
    throw configurationError(`customPatterns[${index}].id is invalid`);
  }
  if (
    typeof label !== "string" ||
    label.length === 0 ||
    label.length > MAX_PII_PATTERN_LABEL_LENGTH
  ) {
    throw configurationError(`customPatterns[${index}].label is invalid`);
  }
  if (typeof regex !== "string" || regex.length === 0 || regex.length > MAX_PII_PATTERN_LENGTH) {
    throw configurationError(`customPatterns[${index}].regex is invalid`);
  }
  if (category != null && (typeof category !== "string" || !CUSTOM_CATEGORIES.includes(category))) {
    throw configurationError(`customPatterns[${index}].category is invalid`);
  }
  return {
    id,
    label,
    regex,
    ...(category == null ? {} : { category: category as FilterPiiCategory }),
  };
}

function snapshotCustomPatterns(candidate: unknown): {
  custom: PreparedCustomPattern[];
  customPatterns: number;
  regexCharacters: number;
} {
  const bounded = readBoundedArray(candidate, "customPatterns");
  const custom: PreparedCustomPattern[] = [];
  let regexCharacters = 0;
  for (let index = 0; index < (bounded?.length ?? 0); index++) {
    let patternCandidate: unknown;
    try {
      patternCandidate = bounded?.values[index];
    } catch {
      throw configurationError("customPatterns could not be read safely");
    }
    const pattern = readCustomPattern(patternCandidate, index);
    custom.push({ ...pattern, category: pattern.category ?? "custom" });
    regexCharacters += pattern.regex.length;
    if (regexCharacters > MAX_PII_CUSTOM_REGEX_CHARACTERS) {
      throw configurationError(
        `custom patterns exceed ${MAX_PII_CUSTOM_REGEX_CHARACTERS} regex characters`,
      );
    }
  }
  return { custom, customPatterns: bounded?.length ?? 0, regexCharacters };
}

function snapshotConfig(
  config: PatternContentInspectorConfig,
): SnapshotPatternContentInspectorConfig {
  if (config == null || typeof config !== "object") {
    throw configurationError("configuration must be an object");
  }
  const cached = SNAPSHOT_CONFIG_CACHE.get(config);
  if (cached != null) {
    return cached;
  }
  let starterCandidate: unknown;
  let customCandidate: unknown;
  try {
    starterCandidate = config.starterPatterns;
    customCandidate = config.customPatterns;
  } catch {
    throw configurationError("configuration could not be read safely");
  }
  const starter = selectStarter(starterCandidate);
  const snapshot: SnapshotPatternContentInspectorConfig = {
    starter,
    ...snapshotCustomPatterns(customCandidate),
  };
  SNAPSHOT_CONFIG_CACHE.set(config, snapshot);
  return snapshot;
}

/** Compiles each distinct regex once; the first declaration keeps its metadata. */
function compileCustomPatterns(custom: readonly PreparedCustomPattern[]): CompiledPattern[] {
  const compiled: CompiledPattern[] = [];
  const seen = new Set<string>();
  for (const pattern of custom) {
    if (seen.has(pattern.regex)) {
      continue;
    }
    seen.add(pattern.regex);
    const regex = compilePiiRegex(pattern.regex);
    if (regex == null) {
      log.warn(
        `[security.contentFilters.pii] dropping invalid customPattern ${JSON.stringify(pattern.id)}: not a safe regular expression`,
      );
      continue;
    }
    compiled.push({
      id: pattern.id,
      label: pattern.label,
      pattern: regex,
      category: pattern.category,
    });
  }
  return compiled;
}

function prepareConfig(
  config: PatternContentInspectorConfig,
): PreparedPatternContentInspectorConfig {
  const cached = PREPARED_CONFIG_CACHE.get(config);
  if (cached != null) {
    return cached;
  }
  const snapshot = snapshotConfig(config);
  const custom = compileCustomPatterns(snapshot.custom);
  const prepared: PreparedPatternContentInspectorConfig = {
    starter: snapshot.starter,
    custom,
    cost: {
      customPatterns: snapshot.customPatterns,
      validCustomPatterns: custom.length,
      regexCharacters: snapshot.regexCharacters,
      active: snapshot.starter.length > 0 || custom.length > 0,
    },
  };
  PREPARED_CONFIG_CACHE.set(config, prepared);
  return prepared;
}

export function getPatternContentInspectorResourceCost(
  config: PatternContentInspectorConfig,
): PatternContentInspectorResourceCost {
  return prepareConfig(config).cost;
}

function findingFor(
  pattern: Pick<CompiledPattern, "id" | "label">,
  fragment: TextContentFragment,
): ProtectionFinding {
  return {
    detectorId: "pii-pattern",
    ruleId: pattern.id,
    label: pattern.label,
    source: fragment.source,
    field: fragment.field,
    provenance: fragment.provenance,
    fragmentId: fragment.id,
    fragmentPath: fragment.path,
  };
}

function globalRegex(pattern: RegExp): RegExp {
  let global = GLOBAL_REGEX_CACHE.get(pattern);
  if (global == null) {
    global = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    GLOBAL_REGEX_CACHE.set(pattern, global);
  }
  return global;
}

function matchesPattern(pattern: CompiledPattern, text: string): boolean {
  if (pattern.validate == null) {
    return pattern.pattern.test(text);
  }
  for (const match of text.matchAll(globalRegex(pattern.pattern))) {
    if (pattern.validate(match[0])) {
      return true;
    }
  }
  return false;
}

function locateMatches(
  patterns: readonly CompiledPattern[],
  text: string,
  maxMatches: number,
): PatternTextMatch[] {
  if (!Number.isSafeInteger(maxMatches) || maxMatches < 0) {
    throw configurationError("redaction match limit must be a non-negative safe integer");
  }
  const matches: PatternTextMatch[] = [];
  patterns.forEach((pattern, priority) => {
    for (const match of text.matchAll(globalRegex(pattern.pattern))) {
      const start = match.index;
      const end = start + match[0].length;
      if (pattern.validate != null && end > start && !pattern.validate(match[0])) {
        continue;
      }
      if (end <= start || matches.length >= maxMatches) {
        throw configurationError("redaction match limit or empty match encountered");
      }
      matches.push({ start, end, category: pattern.category, priority });
    }
  });
  return matches;
}

function createInspector(patterns: readonly CompiledPattern[]): PatternContentInspector {
  const inspectFragment = (fragment: TextContentFragment): ProtectionFinding | null => {
    for (const pattern of patterns) {
      if (matchesPattern(pattern, fragment.text)) {
        return findingFor(pattern, fragment);
      }
    }
    return null;
  };
  return {
    active: patterns.length > 0,
    inspectFragment,
    locate: (text, maxMatches) => locateMatches(patterns, text, maxMatches),
    inspect(fragments) {
      for (const fragment of fragments) {
        const finding = inspectFragment(fragment);
        if (finding != null) {
          return finding;
        }
      }
      return null;
    },
  };
}

/** Starter patterns keep precedence; custom patterns follow in declaration order. */
export function createPatternContentInspector(
  config: PatternContentInspectorConfig,
): PatternContentInspector {
  const cached = INSPECTOR_CACHE.get(config);
  if (cached != null) {
    return cached;
  }
  const prepared = prepareConfig(config);
  const inspector = createInspector([...prepared.starter, ...prepared.custom]);
  INSPECTOR_CACHE.set(config, inspector);
  return inspector;
}
