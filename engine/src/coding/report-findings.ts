// QwenLM/qwen-code@728c13de219885de6a3e93223460c3ec8a8f690d,
// packages/core/src/tools/report-findings.ts (adapted to Branch tool results).
import { Type } from "typebox";
import { Value } from "typebox/value";

export const FINDING_SEVERITIES = ["Critical", "Suggestion", "Nice to have"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_CONFIDENCES = ["high", "low"] as const;
export type FindingConfidence = (typeof FINDING_CONFIDENCES)[number];

export const FINDING_OUTCOMES = ["fixed", "skipped", "no_change_needed"] as const;
export type FindingOutcome = (typeof FINDING_OUTCOMES)[number];

export const FINDING_SOURCES = ["review", "build", "test", "probe", "lint"] as const;
export type FindingSource = (typeof FINDING_SOURCES)[number];

/**
 * The two decision axes a Critical's severity bit used to collapse (#10291).
 *
 * `direction` — which way the defect fails: `certifies-falsely` means the
 * code produces a wrong result it presents as correct (a wrong output, a
 * silent corruption, a bypassed check, a decision taken over state nobody
 * read); `fails-closed` means it refuses, wedges, crashes or degrades to its
 * own absence under some input or configuration without producing a wrong
 * result. `baseline` — what the defect is measured against: `regression`
 * means the merge base handled the trigger correctly and this change breaks
 * it; `new-surface` means the failing path does not exist at the merge base
 * (the change adds the feature, the defense or the branch the defect lives
 * in). Both are optional: a verifier states them off its own witness, and a
 * Critical it could not classify carries neither — which every consumer
 * reads as "posts at any floor", never as a classification.
 */
export const FINDING_DIRECTIONS = ["certifies-falsely", "fails-closed"] as const;
export type FindingDirection = (typeof FINDING_DIRECTIONS)[number];

export const FINDING_BASELINES = ["regression", "new-surface"] as const;
export type FindingBaseline = (typeof FINDING_BASELINES)[number];

export const REPORT_FINDINGS_LEVELS = ["low", "medium", "high"] as const;
export type ReportFindingsLevel = (typeof REPORT_FINDINGS_LEVELS)[number];

export const REPORT_FINDINGS_MAX = 50;
export const SHORT_SUMMARY_MAX = 60;
// The artifact and the repository set the path domain: repo-relative paths
// run to the filesystem limit (PATH_MAX, 4096), and the artifact keeps any
// one of them — a narrower cap refused whole lists the artifact preserves,
// and truncating a path would identify a different location.
export const REPORT_FINDINGS_FILE_MAX = 4096;

/** `shortSummary`, when the caller did not supply one within the cap. */
export function compressFindingSummary(summary: string, max = SHORT_SUMMARY_MAX): string {
  // Collapse whitespace first: a summary that wrapped across lines in the source
  // prose would otherwise carry its newlines into a single-line list cell.
  const flat = summary.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  // Cut on a word boundary when one is reasonably near the limit, so the label
  // reads as a clause rather than a severed word. `max - 1` leaves room for
  // the ellipsis, which is one character (U+2026), not three dots. The hard cut
  // backs off one unit when it would land inside a surrogate pair — an
  // unpaired high surrogate is not a character, and the codebase's other
  // truncation paths (terminal sanitizing, display compaction) all cut on
  // code-point boundaries.
  let head = flat.slice(0, max - 1);
  const lastUnit = head.charCodeAt(head.length - 1);
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
    head = head.slice(0, -1);
  }
  const space = head.lastIndexOf(" ");
  const cut = space >= max * 0.6 ? head.slice(0, space) : head;
  return `${cut.trimEnd()}…`;
}

export interface ReportFindingsFindingParams {
  id?: string;
  severity: FindingSeverity;
  confidence?: FindingConfidence;
  source?: FindingSource;
  file: string;
  line?: number;
  summary: string;
  shortSummary?: string;
  failureScenario: string;
  category?: string;
  direction?: FindingDirection;
  baseline?: FindingBaseline;
  outcome?: FindingOutcome;
  outcomeNote?: string;
}

export interface ReportFindingsParams {
  level?: ReportFindingsLevel;
  findings: ReportFindingsFindingParams[];
}

export const REPORT_FINDINGS_DESCRIPTION = `Reports code-review findings as typed data so clients (Branch clients) can render a per-finding list. Use it only when an active review flow (such as the bundled review skill) instructs you to report findings with it; otherwise present findings as ordinary text. Call it once per report with the complete list, most severe first — a later call replaces the whole list, it never appends. When the review wrote a findings artifact, copy each field verbatim from it (id, severity, confidence, source, file/line, summary, shortSummary, failureScenario, category, direction, baseline); do not re-derive or re-word values — the artifact is the oracle.

After fixes are applied — at the review's own fix step, or ANY later time in the session a reported finding's disposition changes — call it again with the same findings, each carrying "outcome" ("fixed", "skipped", or "no_change_needed"; "outcomeNote" for the reason). Client per-finding status trusts only a call that carries outcomes, and a call where some findings carry an outcome and others do not is refused: account for every finding.

This tool renders data for the client and nothing else: it persists nothing, decides no verdict, and a failure is a UI-delivery failure — disclose it and move on without changing the review's artifacts or verdict.`;

export const FINDING_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: {
      type: "string",
      maxLength: 64,
      description: 'The findings artifact id (e.g. "R1-2"), when the review produced one.',
    },
    severity: {
      type: "string",
      enum: [...FINDING_SEVERITIES],
    },
    confidence: {
      type: "string",
      enum: [...FINDING_CONFIDENCES],
      description: "Verification confidence. Omit on an unverified (low-effort) pass.",
    },
    source: {
      type: "string",
      enum: [...FINDING_SOURCES],
      description: 'Where the finding came from. Defaults to "review".',
    },
    file: {
      type: "string",
      maxLength: REPORT_FINDINGS_FILE_MAX,
      description:
        'Repo-relative path, or the review\'s "(body)" stand-in for an unanchored finding.',
    },
    line: {
      type: "integer",
      minimum: 1,
    },
    summary: {
      type: "string",
      description: "One sentence stating the defect.",
    },
    shortSummary: {
      type: "string",
      description: `Compressed label for a compact list UI (<= ${SHORT_SUMMARY_MAX} characters; longer values are compressed, and it is derived from "summary" when absent).`,
    },
    failureScenario: {
      type: "string",
      maxLength: 4000,
      description: "The concrete trigger and wrong outcome.",
    },
    category: {
      type: "string",
      maxLength: 64,
      description: 'Free-form kebab-case tag ("correctness", "security", "test-coverage", …).',
    },
    direction: {
      type: "string",
      enum: [...FINDING_DIRECTIONS],
      description:
        'Which way a Critical fails, from the artifact: "certifies-falsely" (a wrong result presented as correct) or "fails-closed" (refuses, wedges or degrades without a wrong result). Omit when the artifact carries none.',
    },
    baseline: {
      type: "string",
      enum: [...FINDING_BASELINES],
      description:
        'What a Critical is measured against, from the artifact: "regression" (the merge base handled the trigger correctly) or "new-surface" (the failing path does not exist at the merge base). Omit when the artifact carries none.',
    },
    outcome: {
      type: "string",
      enum: [...FINDING_OUTCOMES],
      description:
        "Set ONLY on a re-report after fixes were applied: what happened to this finding. All findings in the call must carry one, or none.",
    },
    outcomeNote: {
      type: "string",
      maxLength: 1000,
      description: 'The fixer\'s reason — required reading for "skipped".',
    },
  },
  required: ["severity", "file", "summary", "failureScenario"],
} as const;

export type ReportedFinding = Omit<ReportFindingsFindingParams, "shortSummary"> & {
  shortSummary: string;
};
export type FindingsResultDisplay = {
  type: "findings_list";
  level?: ReportFindingsLevel;
  findings: ReportedFinding[];
};
export type FindingsReportResult = {
  llmContent: string;
  returnDisplay: FindingsResultDisplay;
  error?: unknown;
};

function normalizeFinding(raw: ReportFindingsFindingParams): ReportedFinding {
  const shortSource = raw.shortSummary?.trim() || raw.summary;
  return {
    ...(raw.id?.trim() ? { id: raw.id.trim() } : {}),
    severity: raw.severity,
    ...(raw.confidence ? { confidence: raw.confidence } : {}),
    ...(raw.source ? { source: raw.source } : {}),
    file: raw.file.trim(),
    ...(raw.line !== undefined ? { line: raw.line } : {}),
    summary: raw.summary.trim(),
    shortSummary: compressFindingSummary(shortSource),
    failureScenario: raw.failureScenario.trim(),
    ...(raw.category?.trim() ? { category: raw.category.trim() } : {}),
    ...(raw.direction ? { direction: raw.direction } : {}),
    ...(raw.baseline ? { baseline: raw.baseline } : {}),
    ...(raw.outcome ? { outcome: raw.outcome } : {}),
    ...(raw.outcomeNote?.trim() ? { outcomeNote: raw.outcomeNote.trim() } : {}),
  };
}

/**
 * Severity, then confidence, then location — matching the artifact's own
 * `sortFindings` (code-unit file/id comparison, a missing line ranked first),
 * so the list a client renders and the artifact a reader opens agree about
 * order. The one extension: the artifact requires `confidence`, this contract
 * does not (an unverified low-effort pass omits it), and an absent confidence
 * ranks between `high` and `low`.
 */
function sortReportedFindings(findings: readonly ReportedFinding[]): ReportedFinding[] {
  const confidenceRank = (c: ReportedFinding["confidence"]): number =>
    c === "high" ? 0 : c === undefined ? 1 : 2;
  return [...findings].sort((a, b) => {
    const severity =
      FINDING_SEVERITIES.indexOf(a.severity) - FINDING_SEVERITIES.indexOf(b.severity);
    if (severity !== 0) return severity;
    const confidence = confidenceRank(a.confidence) - confidenceRank(b.confidence);
    if (confidence !== 0) return confidence;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    const line = (a.line ?? 0) - (b.line ?? 0);
    if (line !== 0) return line;
    const aId = a.id ?? "";
    const bId = b.id ?? "";
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
}

function reportIdentity(
  findings: readonly ReportFindingsFindingParams[],
): ReadonlySet<string> | undefined {
  const ids = findings.map((finding) => finding.id?.trim() ?? "");
  if (findings.length === 0 || ids.some((id) => id === "")) {
    return undefined;
  }
  return new Set(ids);
}

export const ReportFindingsSchema = Type.Unsafe<ReportFindingsParams>({
  type: "object",
  additionalProperties: false,
  properties: {
    level: { type: "string", enum: [...REPORT_FINDINGS_LEVELS] },
    findings: { type: "array", maxItems: REPORT_FINDINGS_MAX, items: FINDING_ITEM_SCHEMA },
  },
  required: ["findings"],
});

export const ReportFindingsOutputSchema = Type.Unsafe<FindingsResultDisplay>({
  type: "object",
  additionalProperties: false,
  properties: {
    type: { const: "findings_list" },
    level: { type: "string", enum: [...REPORT_FINDINGS_LEVELS] },
    findings: {
      type: "array",
      maxItems: REPORT_FINDINGS_MAX,
      items: {
        ...FINDING_ITEM_SCHEMA,
        required: [...FINDING_ITEM_SCHEMA.required, "shortSummary"],
      },
    },
  },
  required: ["type", "findings"],
});

// Qwen record-artifact.ts control-character policy, including prose line whitespace.
function hasControlCharacter(value: string, allowLineWhitespace = false): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (allowLineWhitespace && (code === 0x09 || code === 0x0a || code === 0x0d)) continue;
    if (
      code <= 0x1f ||
      code === 0x7f ||
      (code >= 0x200b && code <= 0x200f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff
    )
      return true;
  }
  return false;
}

function validateFinding(finding: ReportFindingsFindingParams, index: number): void {
  const fields = {
    id: finding.id,
    file: finding.file,
    summary: finding.summary,
    shortSummary: finding.shortSummary,
    failureScenario: finding.failureScenario,
    category: finding.category,
    outcomeNote: finding.outcomeNote,
  };
  for (const [field, value] of Object.entries(fields)) {
    const prose = field === "summary" || field === "failureScenario" || field === "outcomeNote";
    if (value !== undefined && hasControlCharacter(value, prose)) {
      throw new Error(`Finding at index ${index}: "${field}" contains control characters`);
    }
  }
  for (const field of ["file", "summary", "failureScenario"] as const) {
    if (!finding[field].trim())
      throw new Error(`Finding at index ${index}: "${field}" must not be empty`);
  }
  if (finding.line !== undefined && !Number.isSafeInteger(finding.line)) {
    throw new Error(
      `Finding at index ${index}: "line" must be an integer within JavaScript's safe range`,
    );
  }
  if (finding.outcome === "skipped" && !finding.outcomeNote?.trim()) {
    throw new Error(
      `Finding at index ${index}: "outcomeNote" is required when "outcome" is "skipped"`,
    );
  }
}

function validateOutcomeIdentity(
  findings: ReportFindingsFindingParams[],
  activeIds?: ReadonlySet<string>,
): void {
  const withOutcome = findings.filter((finding) => finding.outcome).length;
  if (withOutcome > 0 && withOutcome < findings.length) {
    throw new Error(
      `${withOutcome} of ${findings.length} findings carry an "outcome". Outcomes account for every finding or none: a partial set silently shortens the list.`,
    );
  }
  if (!withOutcome || !activeIds) return;
  const ids = new Set(findings.map((finding) => finding.id?.trim() ?? ""));
  const missing = [...activeIds].filter((id) => !ids.has(id));
  if (missing.length) {
    throw new Error(
      `Outcome report drops ${missing.length} finding(s) from the active report: ${missing.map((id) => JSON.stringify(id)).join(", ")}. Re-report every active finding with its outcome.`,
    );
  }
  const unknown = [...ids].filter((id) => id === "" || !activeIds.has(id));
  if (unknown.length) {
    throw new Error(
      `Outcome report carries finding(s) the active report does not have: ${unknown.map((id) => (id === "" ? "(missing id)" : JSON.stringify(id))).join(", ")}. Outcomes join back to the active report by id.`,
    );
  }
}

function validateReport(params: ReportFindingsParams, activeIds?: ReadonlySet<string>): void {
  if (!Value.Check(ReportFindingsSchema, params))
    throw new Error("Invalid report_findings parameters.");
  const seenIds = new Set<string>();
  for (const [index, finding] of params.findings.entries()) {
    validateFinding(finding, index);
    const id = finding.id?.trim();
    if (id && seenIds.has(id)) throw new Error(`Finding at index ${index}: duplicate id "${id}"`);
    if (id) seenIds.add(id);
  }
  validateOutcomeIdentity(params.findings, activeIds);
}

function countLabels(
  findings: ReportedFinding[],
  field: "severity" | "outcome",
  values: readonly string[],
): string {
  return values
    .map((value) => {
      const count = findings.filter((finding) => finding[field] === value).length;
      return count ? `${count} ${value}` : undefined;
    })
    .filter(Boolean)
    .join(", ");
}

function createReportResult(params: ReportFindingsParams): FindingsReportResult {
  const findings = sortReportedFindings(params.findings.map(normalizeFinding));
  const severity = countLabels(findings, "severity", FINDING_SEVERITIES);
  const outcomes =
    findings.length && findings[0]?.outcome
      ? ` with outcomes (${countLabels(findings, "outcome", FINDING_OUTCOMES)})`
      : "";
  const summary =
    findings.length === 0
      ? "Reported an empty findings list to the client UI."
      : `Reported ${findings.length} finding${findings.length === 1 ? "" : "s"} to the client UI (${severity})${outcomes}.`;
  return {
    llmContent: `${summary} Nothing was persisted; the review's findings artifact remains the canonical record.`,
    returnDisplay: {
      type: "findings_list",
      ...(params.level ? { level: params.level } : {}),
      findings,
    },
  };
}

/** The upstream live-session report identity is committed only on execution. */
export class ReportFindingsTool {
  static readonly Name = "report_findings";
  readonly schema = { parametersJsonSchema: ReportFindingsSchema };
  private activeReportIds: ReadonlySet<string> | undefined;

  build(params: ReportFindingsParams) {
    validateReport(params, this.activeReportIds);
    const snapshot = structuredClone(params);
    return {
      execute: async (signal?: AbortSignal): Promise<FindingsReportResult> => {
        signal?.throwIfAborted();
        validateReport(snapshot, this.activeReportIds);
        const result = createReportResult(snapshot);
        this.activeReportIds = reportIdentity(snapshot.findings);
        return result;
      },
    };
  }
}
