import { placeholderToken } from "./detectors/identifiers.js";
// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:packages/api/src/protection/transform.ts (atlas SAFETY-0062)
import type { PatternContentInspectorConfig, PatternTextMatch } from "./detectors/pattern.js";
import { createPatternContentInspector, PatternConfigurationError } from "./detectors/pattern.js";
import {
  DEFAULT_PII_REDACTION_MAX_CHARACTERS,
  DEFAULT_PII_REDACTION_MAX_MATCHES,
  MAX_PII_PATTERNS_PER_SOURCE,
  type FilterPiiAction,
  type FilterPiiCategory,
} from "./filters.js";
import type { TextContentFragment } from "./types.js";

export type PiiPlaceholderType = Uppercase<FilterPiiCategory>;

export interface PiiRedactionConfig extends PatternContentInspectorConfig {
  readonly action?: FilterPiiAction;
  readonly fields?: readonly string[];
  readonly maxCharacters?: number;
  readonly maxMatches?: number;
}

export interface PiiTransformerOptions {
  /**
   * deer-flow keyed pseudonyms: when set, each value maps to a stable
   * `[TYPE_letters]` HMAC token instead of a per-session sequence number.
   */
  readonly tokenSecret?: string;
}

export interface PiiRedactionMetadata {
  readonly category: PiiPlaceholderType;
  readonly count: number;
}

export interface PiiTransformationResult {
  readonly version: 1;
  readonly content: string;
  readonly replacements: number;
  readonly categories: readonly PiiRedactionMetadata[];
}

export class PiiTransformationError extends Error {
  constructor(reason: "limit" | "unreplaceable" | "inspection") {
    super(`PII transformation failed: ${reason}`);
    this.name = "PiiTransformationError";
  }
}

export interface PiiTransformationSession {
  /** Applies this rule to selected text fields; the caller must still enforce all other policies. */
  transform(fragment: TextContentFragment): PiiTransformationResult;
}

interface PlaceholderAllocator {
  /** Reserves literal markers already present in selected text. */
  reserve(text: string): void;
  placeholder(type: PiiPlaceholderType, value: string): string;
}

const SEQUENTIAL_MARKER =
  /\[(?:EMAIL|PHONE|NAME|CREDENTIAL|CUSTOM|NATIONAL_ID|CREDIT_CARD)_[1-9]\d*\]/g;

function readLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value == null) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new PatternConfigurationError("Invalid PII transformation limit");
  }
  return value;
}

function readFields(config: PiiRedactionConfig): ReadonlySet<string> | undefined {
  if (config.fields == null) {
    return undefined;
  }
  try {
    if (!Array.isArray(config.fields) || config.fields.length > MAX_PII_PATTERNS_PER_SOURCE) {
      throw new PatternConfigurationError("Invalid PII transformation fields");
    }
    const fields = new Set<string>(config.fields);
    if (fields.size === 0 || [...fields].some((field) => typeof field !== "string")) {
      throw new PatternConfigurationError("Invalid PII transformation fields");
    }
    return fields;
  } catch {
    throw new PatternConfigurationError("Invalid PII transformation fields");
  }
}

function mergedMatches(matches: readonly PatternTextMatch[]): PatternTextMatch[] {
  const sorted = matches.toSorted(
    (left, right) =>
      left.start - right.start || right.end - left.end || left.priority - right.priority,
  );
  const merged: PatternTextMatch[] = [];
  for (const match of sorted) {
    const previous = merged.at(-1);
    if (previous == null || match.start >= previous.end) {
      merged.push(match);
    } else if (match.end > previous.end) {
      merged[merged.length - 1] = { ...previous, end: match.end };
    }
  }
  return merged;
}

/** LibreChat's session-scoped `[TYPE_n]` allocation that never aliases a literal marker. */
function createSequentialAllocator(): PlaceholderAllocator {
  const placeholders = new Map<string, string>();
  const issued = new Set<string>();
  const reserved = new Set<string>();
  const nextByCategory = new Map<PiiPlaceholderType, number>();
  return {
    reserve(text) {
      for (const marker of text.matchAll(SEQUENTIAL_MARKER)) {
        reserved.add(marker[0]);
        if (issued.has(marker[0])) {
          throw new PiiTransformationError("inspection");
        }
      }
    },
    placeholder(type, value) {
      const key = JSON.stringify([type, value]);
      let placeholder = placeholders.get(key);
      if (placeholder == null) {
        let next = nextByCategory.get(type) ?? 0;
        do {
          next++;
          placeholder = `[${type}_${next}]`;
        } while (reserved.has(placeholder) || issued.has(placeholder));
        nextByCategory.set(type, next);
        placeholders.set(key, placeholder);
        issued.add(placeholder);
      }
      return placeholder;
    },
  };
}

/** deer-flow value-derived tokens: no mapping is stored, so nothing to reserve. */
function createKeyedAllocator(tokenSecret: string): PlaceholderAllocator {
  return {
    reserve() {
      // Value-derived tokens keep no mapping, so literal markers need no reservation.
    },
    placeholder: (type, value) => placeholderToken(type.toLowerCase(), value, tokenSecret),
  };
}

function unchanged(text: string): PiiTransformationResult {
  return { version: 1, content: text, replacements: 0, categories: [] };
}

function replaceMatches(
  text: string,
  merged: readonly PatternTextMatch[],
  allocator: PlaceholderAllocator,
): PiiTransformationResult {
  const categories = new Map<PiiPlaceholderType, number>();
  const parts: string[] = [];
  let offset = 0;
  for (const { start, end, category } of merged) {
    const type = category.toUpperCase() as PiiPlaceholderType;
    categories.set(type, (categories.get(type) ?? 0) + 1);
    parts.push(text.slice(offset, start), allocator.placeholder(type, text.slice(start, end)));
    offset = end;
  }
  parts.push(text.slice(offset));
  return {
    version: 1,
    content: parts.join(""),
    replacements: merged.length,
    categories: [...categories].map(([category, count]) => ({ category, count })),
  };
}

/**
 * Explicit, opt-in transformation. Inspection still reports `redact` findings
 * as blocking until a caller consumes this API.
 * A session owns only ephemeral, bounded mappings; never log or persist it.
 */
export function createPiiTextTransformer(
  config: PiiRedactionConfig,
  options: PiiTransformerOptions = {},
): { createSession(): PiiTransformationSession } {
  if (config.action !== "redact") {
    throw new PatternConfigurationError("PII transformation requires the redact action");
  }
  const maxCharacters = readLimit(
    config.maxCharacters,
    DEFAULT_PII_REDACTION_MAX_CHARACTERS,
    262_144,
  );
  const maxMatches = readLimit(config.maxMatches, DEFAULT_PII_REDACTION_MAX_MATCHES, 4_096);
  const fields = readFields(config);
  const inspector = createPatternContentInspector(config);
  const { tokenSecret } = options;

  return {
    createSession() {
      const allocator = tokenSecret
        ? createKeyedAllocator(tokenSecret)
        : createSequentialAllocator();
      const budget = { characters: maxCharacters, matches: maxMatches };
      return {
        transform(fragment) {
          if (fields != null && !fields.has(fragment.field)) {
            return unchanged(fragment.text);
          }
          const matches = locateWithinBudget(fragment, budget, allocator, inspector.locate);
          if (matches.length === 0) {
            return unchanged(fragment.text);
          }
          if (
            fragment.treatment !== "replaceable" ||
            !["plain", "markdown"].includes(fragment.format)
          ) {
            throw new PiiTransformationError("unreplaceable");
          }
          budget.matches -= matches.length;
          return replaceMatches(fragment.text, mergedMatches(matches), allocator);
        },
      };
    },
  };
}

function locateWithinBudget(
  fragment: TextContentFragment,
  budget: { characters: number; matches: number },
  allocator: PlaceholderAllocator,
  locate: (text: string, maxMatches: number) => readonly PatternTextMatch[],
): readonly PatternTextMatch[] {
  try {
    if (typeof fragment.text !== "string" || fragment.text.length > budget.characters) {
      throw new PiiTransformationError("limit");
    }
    budget.characters -= fragment.text.length;
    allocator.reserve(fragment.text);
    return locate(fragment.text, budget.matches);
  } catch (error) {
    if (error instanceof PiiTransformationError) {
      throw error;
    }
    throw new PiiTransformationError("inspection");
  }
}
