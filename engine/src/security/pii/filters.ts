// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:packages/data-provider/src/filters.ts (atlas SAFETY-0062)
import { z } from "zod";
import { sensitive } from "../../config/zod-schema.sensitive.js";
import { compileConfigRegex } from "../config-regex.js";

/**
 * Built-in catalog: LibreChat's credential starters followed by deer-flow's
 * checksum-gated personal-data detectors, in deer-flow's pinned order.
 */
export const FILTER_PII_STARTER_PATTERNS = [
  "sk_prefix",
  "bearer_header",
  "api_key_header",
  "email",
  "api_key",
  "national_id",
  "credit_card",
  "phone",
] as const;

export const MAX_PII_PATTERNS_PER_SOURCE = 256;
export const MAX_PII_PATTERN_LENGTH = 512;
export const MAX_PII_PATTERN_ID_LENGTH = 256;
export const MAX_PII_PATTERN_LABEL_LENGTH = 512;
export const MAX_PII_CUSTOM_REGEX_CHARACTERS = 8_192;
/** deer-flow MIN_TOKEN_SECRET_LENGTH: shorter keys make keyed digests brute-forceable offline. */
export const MIN_PII_TOKEN_SECRET_LENGTH = 16;

const RE2_CASE_INSENSITIVE_PREFIX = "(?i)";

/**
 * Compiles a configured pattern. Upstream measures RE2 programs; Branch compiles
 * through its shared safe-regex guard, which rejects nested and ambiguous
 * repetition. RE2's leading `(?i)` maps to the `i` flag.
 */
export function compilePiiRegex(pattern: string, flags = ""): RegExp | null {
  const insensitive = pattern.startsWith(RE2_CASE_INSENSITIVE_PREFIX);
  const source = insensitive ? pattern.slice(RE2_CASE_INSENSITIVE_PREFIX.length) : pattern;
  const effectiveFlags = insensitive && !flags.includes("i") ? `${flags}i` : flags;
  return compileConfigRegex(source, effectiveFlags)?.regex ?? null;
}

export const TOOL_ARGUMENT_FILTER_FIELDS = ["name", "arguments"] as const;

export const toolArgumentFilterFieldSchema = z.enum(TOOL_ARGUMENT_FILTER_FIELDS);
export const filterPiiStarterPatternSchema = z.enum(FILTER_PII_STARTER_PATTERNS);
export const filterPiiActionSchema = z.enum(["block", "audit", "redact"]);
export const filterPiiCategorySchema = z.enum([
  "email",
  "phone",
  "name",
  "credential",
  "custom",
  "national_id",
  "credit_card",
]);
export const DEFAULT_PII_REDACTION_MAX_CHARACTERS = 65_536;
export const DEFAULT_PII_REDACTION_MAX_MATCHES = 256;

export type ToolArgumentFilterField = z.infer<typeof toolArgumentFilterFieldSchema>;
export type FilterPiiAction = z.infer<typeof filterPiiActionSchema>;
export type FilterPiiCategory = z.infer<typeof filterPiiCategorySchema>;

type PiiPatternSelection = {
  readonly starterPatterns?: readonly unknown[];
  readonly customPatterns?: readonly unknown[];
};

/**
 * An omitted starter selection enables the built-in catalog. An explicit
 * empty selection disables it, so a source is active only when custom rules
 * remain. This mirrors the documented filter semantics without compiling
 * regular expressions.
 */
export function hasActivePiiPatterns(config: PiiPatternSelection | null | undefined): boolean {
  return (
    config != null &&
    (config.starterPatterns == null ||
      config.starterPatterns.length > 0 ||
      (config.customPatterns?.length ?? 0) > 0)
  );
}

export const filterPiiRegexSchema = z
  .string()
  .min(1)
  .max(MAX_PII_PATTERN_LENGTH)
  .refine((value) => compilePiiRegex(value) != null, {
    message: "Regex must be valid and free of nested or ambiguous repetition",
  });

export const filterPiiCustomPatternSchema = z.strictObject({
  id: z.string().min(1).max(MAX_PII_PATTERN_ID_LENGTH),
  label: z.string().min(1).max(MAX_PII_PATTERN_LABEL_LENGTH),
  regex: filterPiiRegexSchema,
  category: filterPiiCategorySchema.optional(),
});

export type FilterPiiCustomPatternConfig = z.infer<typeof filterPiiCustomPatternSchema>;

export const filterPiiConfigSchema = z.strictObject({
  action: filterPiiActionSchema.optional(),
  maxCharacters: z.number().int().positive().max(262_144).optional(),
  maxMatches: z.number().int().positive().max(4_096).optional(),
  fields: z.array(toolArgumentFilterFieldSchema).min(1).max(MAX_PII_PATTERNS_PER_SOURCE).optional(),
  starterPatterns: z
    .array(filterPiiStarterPatternSchema)
    .max(MAX_PII_PATTERNS_PER_SOURCE)
    .optional(),
  customPatterns: z.array(filterPiiCustomPatternSchema).max(MAX_PII_PATTERNS_PER_SOURCE).optional(),
});

export type FilterPiiConfig = z.infer<typeof filterPiiConfigSchema>;

/** deer-flow token_secret rule: keyed placeholders need a non-blank, long-enough key. */
export const filterPiiTokenSecretSchema = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "tokenSecret must not be blank" })
  .refine((value) => value.length >= MIN_PII_TOKEN_SECRET_LENGTH, {
    message: `tokenSecret must be at least ${MIN_PII_TOKEN_SECRET_LENGTH} characters; use a long random value`,
  });

export const filtersConfigSchema = z.strictObject({
  toolArguments: z.strictObject({ pii: filterPiiConfigSchema.optional() }).optional(),
  tokenSecret: filterPiiTokenSecretSchema.optional().register(sensitive),
});

export type FiltersConfig = z.infer<typeof filtersConfigSchema>;
