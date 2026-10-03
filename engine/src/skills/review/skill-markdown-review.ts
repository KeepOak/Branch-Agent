import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { buildSkillResourceGraph } from "./resource-graph.js";

// Structural rules ported from bytedance/deer-flow f840e843 analyzer.py.
export type SkillReadinessFinding = {
  ruleId: string;
  severity: "blocker" | "error" | "warning";
  path: string;
  message: string;
};
const allowedFields = new Set([
  "name",
  "description",
  "license",
  "allowed-tools",
  "argument-hint",
  "required-secrets",
  "secrets-autonomous",
  "metadata",
  "compatibility",
  "version",
  "author",
]);

function allowedToolsValid(raw: unknown): boolean {
  if (raw == null) {
    return true;
  }
  if (Array.isArray(raw)) {
    return raw.every((item) => typeof item === "string" && item.trim().length > 0);
  }
  if (typeof raw !== "string") {
    return false;
  }
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (const char of raw) {
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (quote) {
      if (char === quote) {
        quote = undefined;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")" && --depth < 0) {
      return false;
    }
  }
  return depth === 0 && quote === undefined;
}

function secretFindings(metadata: Record<string, unknown>, add: AddFinding): void {
  const required = metadata["required-secrets"];
  if (required != null && !Array.isArray(required)) {
    add("structure.invalid-required-secrets", "error", "Declare required-secrets as a YAML list.");
  }
  if (
    Array.isArray(required) &&
    required.some(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        "optional" in entry &&
        typeof entry.optional !== "boolean",
    )
  ) {
    add(
      "structure.invalid-required-secrets-optional",
      "error",
      "required-secrets[].optional must be a boolean.",
    );
  }
  if ("secrets-autonomous" in metadata && typeof metadata["secrets-autonomous"] !== "boolean") {
    add("structure.invalid-secrets-autonomous", "error", "secrets-autonomous must be a boolean.");
  }
}

type AddFinding = (
  ruleId: string,
  severity: SkillReadinessFinding["severity"],
  message: string,
) => void;

function analyzeIdentity(metadata: Record<string, unknown>, add: AddFinding): string | null {
  const unknown = Object.keys(metadata)
    .filter((key) => !allowedFields.has(key))
    .toSorted();
  if (unknown.length) {
    add(
      "structure.unknown-frontmatter-field",
      "warning",
      `Unknown frontmatter field(s): ${unknown.join(", ")}`,
    );
  }
  const name = typeof metadata.name === "string" ? metadata.name.trim() : null;
  if (!name) {
    add("structure.missing-name", "blocker", "Frontmatter is missing a non-empty name.");
  } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || name.length > 64) {
    add(
      "structure.invalid-name",
      "error",
      "Skill name must be hyphen-case using lowercase letters, digits, and hyphens.",
    );
  }
  return name;
}

function analyzeMetadata(
  metadata: Record<string, unknown>,
  body: string,
  add: AddFinding,
): string | null {
  const name = analyzeIdentity(metadata, add);
  const description = metadata.description;
  if (typeof description !== "string" || !description.trim()) {
    add(
      "structure.missing-description",
      "blocker",
      "Frontmatter is missing a non-empty description.",
    );
  } else if ([...description.trim()].length > 1024) {
    add(
      "structure.description-too-long",
      "error",
      "Description exceeds DeerFlow's 1024 character limit.",
    );
  }
  if (!body.trim()) {
    add("structure.empty-body", "error", "SKILL.md has no instruction body after frontmatter.");
  }
  if (!allowedToolsValid(metadata["allowed-tools"])) {
    add(
      "structure.invalid-allowed-tools",
      "error",
      "Declare allowed-tools as a space-separated string or YAML list of non-empty strings.",
    );
  }
  secretFindings(metadata, add);
  return name;
}

function analyzeMarkdown(content: string, add: AddFinding): string | null {
  const match = /^\ufeff?---[^\S\n]*\n([\s\S]*?)\n---[^\S\n]*\n?/u.exec(
    content.replaceAll("\r\n", "\n"),
  );
  if (!match) {
    add("structure.invalid-frontmatter", "blocker", "No YAML frontmatter found.");
    return null;
  }
  try {
    const doc = parseDocument(match[1] ?? "", {
      schema: "core",
      prettyErrors: false,
      uniqueKeys: false,
    });
    if (doc.errors.length) {
      throw new Error("Invalid YAML in frontmatter.");
    }
    const metadata: unknown = doc.toJS();
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new Error("Frontmatter must be a YAML dictionary.");
    }
    const normalized = content.replaceAll("\r\n", "\n");
    return analyzeMetadata(
      metadata as Record<string, unknown>,
      normalized.slice(match[0].length),
      add,
    );
  } catch {
    add("structure.invalid-frontmatter", "blocker", "Invalid YAML dictionary in frontmatter.");
    return null;
  }
}

/** Static facts only: findings never activate skills or alter runtime eligibility. */
export function reviewSkillMarkdown(content: string) {
  const findings: SkillReadinessFinding[] = [];
  const add: AddFinding = (ruleId, severity, message) => {
    findings.push({ ruleId, severity, path: "SKILL.md", message });
  };
  const declaredName = analyzeMarkdown(content, add);
  const resources = buildSkillResourceGraph({ "SKILL.md": content }, false);
  return {
    declaredName,
    instructionDigest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    completeness: {
      packageEnumerated: false,
      textContentComplete: true,
      notAssessed: ["package_enumeration", "resource_existence", "eval_manifests", "skillscan"],
    },
    summary: {
      blockers: findings.filter((finding) => finding.severity === "blocker").length,
      errors: findings.filter((finding) => finding.severity === "error").length,
      warnings:
        findings.filter((finding) => finding.severity === "warning").length +
        resources.findings.length,
    },
    findings,
    resources,
  };
}
