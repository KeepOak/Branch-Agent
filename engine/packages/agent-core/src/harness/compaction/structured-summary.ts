// From aaif-goose/goose@bab8ff641039c9cd3331121cd84a5c6045f365ca:crates/goose-context-management/src/structured.rs and crates/goose-context-management/src/prompts/compaction_summary.md (atlas AGENT-LOOP-0100). Converted to TypeScript; provenance and uncertainty render before other sections (R-1696).
import { isRecord } from "@branch/normalization-core/record-coerce";

const LIST_FIELDS = [
  "user_intent",
  "technical_concepts",
  "errors_and_fixes",
  "problem_solving",
  "user_messages",
  "pending_tasks",
] as const;
type ListField = (typeof LIST_FIELDS)[number];
export type FileActivity = { path: string; summary: string; key_code?: string };
export type StructuredSummary = Record<ListField, string[]> & {
  files: FileActivity[];
  current_work?: string;
  next_step?: string;
  extra: Record<string, unknown>;
};

function stringifyLenient(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(stringifyLenient).join("; ");
  if (isRecord(value))
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${stringifyLenient(item)}`)
      .join("; ");
  return String(value);
}

function lenientList(value: unknown): string[] {
  return (Array.isArray(value) ? value : value == null ? [] : [value])
    .map(stringifyLenient)
    .filter((text) => text.trim());
}

function lenientOptional(value: unknown): string | undefined {
  const text = stringifyLenient(value);
  return text.trim() ? text : undefined;
}

function fileList(value: unknown): FileActivity[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values
    .map((item) =>
      isRecord(item)
        ? {
            path: stringifyLenient(item.path),
            summary: stringifyLenient(item.summary),
            key_code: lenientOptional(item.key_code),
          }
        : { path: stringifyLenient(item), summary: "" },
    )
    .filter(
      (file) => file.path.trim() || file.summary.trim() || ("key_code" in file && file.key_code),
    );
}

function leadingObject(text: string): string | undefined {
  const source = text.trimStart();
  if (!source.startsWith("{")) return undefined;
  let depth = 0,
    inString = false,
    escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return source.slice(0, index + 1);
  }
  return undefined;
}

function jsonCandidates(text: string): string[] {
  const terminator = "</analysis>";
  const cuts = Array.from(
    text.matchAll(/<\/analysis>/g),
    (match) => match.index + terminator.length,
  );
  if (!cuts.length) cuts.push(0);
  const candidates: string[] = [];
  for (const cut of cuts.toReversed()) {
    const tail = text.slice(cut),
      later = tail.split(terminator).length - 1;
    const fences = Array.from(tail.matchAll(/```json/g), (match) => match.index + 7).toReversed();
    const extracted = [
      ...fences.map((index) => leadingObject(tail.slice(index))),
      leadingObject(tail),
    ];
    for (const candidate of extracted) {
      if (candidate && candidate.split(terminator).length - 1 === later) candidates.push(candidate);
    }
  }
  const leading = leadingObject(text);
  if (leading) candidates.push(leading);
  return [...new Set(candidates)];
}

function repairTruncatedJson(source: string): string {
  let repaired = source,
    inString = false,
    escaped = false;
  const closers: string[] = [];
  for (const char of source) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") closers.push("}");
    else if (char === "[") closers.push("]");
    else if ((char === "}" || char === "]") && closers.at(-1) === char) closers.pop();
  }
  if (inString) repaired += (escaped ? "\\" : "") + '"';
  return repaired + closers.toReversed().join("");
}

function safelyParseJson(candidate: string): unknown {
  const escaped = candidate.replace(/[\u0000-\u001f]/g, (char) =>
    JSON.stringify(char).slice(1, -1),
  );
  for (const source of [
    candidate,
    repairTruncatedJson(candidate),
    escaped,
    repairTruncatedJson(escaped),
  ]) {
    try {
      return JSON.parse(source) as unknown;
    } catch {
      /* Try source repair variants. */
    }
  }
  return undefined;
}

/** Unanchored prose or incomplete JSON is left untouched, rather than silently losing late work. */
export function parseStructuredSummary(text: string): StructuredSummary | undefined {
  for (const candidate of jsonCandidates(text)) {
    const value = safelyParseJson(candidate);
    if (!isRecord(value)) continue;
    const summary: StructuredSummary = {
      user_intent: lenientList(value.user_intent),
      technical_concepts: lenientList(value.technical_concepts),
      errors_and_fixes: lenientList(value.errors_and_fixes),
      problem_solving: lenientList(value.problem_solving),
      user_messages: lenientList(value.user_messages),
      pending_tasks: lenientList(value.pending_tasks),
      files: fileList(value.files),
      current_work: lenientOptional(value.current_work),
      next_step: lenientOptional(value.next_step),
      extra: Object.fromEntries(
        Object.entries(value).filter(
          ([key]) => ![...LIST_FIELDS, "files", "current_work", "next_step"].includes(key),
        ),
      ),
    };
    if (
      LIST_FIELDS.some((field) => summary[field].length) ||
      summary.files.length ||
      summary.current_work ||
      summary.next_step
    )
      return summary;
  }
  return undefined;
}

function codeFence(code: string): string {
  const runs = [...code.matchAll(/`+/g)].map((match) => match[0].length);
  const fence = "`".repeat(Math.max(3, 1 + Math.max(0, ...runs)));
  return `${fence}\n${code.replace(/\n+$/, "")}\n${fence}`;
}

/** List order is preserved; callers may provide a renderer that can also access extra fields. */
export function renderStructuredSummary(summary: StructuredSummary): string {
  const sections = ["# Conversation Summary"];
  const provenance = lenientList(summary.extra.provenance);
  const uncertain = lenientList(summary.extra.uncertain);
  if (provenance.length)
    sections.push(`## Provenance\n${provenance.map((item) => `- ${item}`).join("\n")}`);
  if (uncertain.length)
    sections.push(`## Uncertain\n${uncertain.map((item) => `- ${item}`).join("\n")}`);
  const appendList = (title: string, field: ListField) => {
    if (summary[field].length)
      sections.push(`## ${title}\n${summary[field].map((item) => `- ${item}`).join("\n")}`);
  };
  appendList("User Intent", "user_intent");
  appendList("Technical Concepts", "technical_concepts");
  if (summary.files.length)
    sections.push(
      `## Files + Code\n${summary.files.map((file) => [file.path && `### ${file.path}`, file.summary, file.key_code && codeFence(file.key_code)].filter(Boolean).join("\n")).join("\n\n")}`,
    );
  appendList("Errors + Fixes", "errors_and_fixes");
  appendList("Problem Solving", "problem_solving");
  appendList("User Messages", "user_messages");
  appendList("Pending Tasks", "pending_tasks");
  if (summary.current_work) sections.push(`## Current Work\n${summary.current_work}`);
  if (summary.next_step) sections.push(`## Next Step\n${summary.next_step}`);
  return sections.join("\n\n");
}

export function applyStructuredSummary(text: string, render = renderStructuredSummary): string {
  const summary = parseStructuredSummary(text);
  if (!summary) return text;
  try {
    return render(summary).trim() || text;
  } catch {
    return text;
  }
}
