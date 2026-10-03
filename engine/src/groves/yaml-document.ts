import { coerceErrorMessage } from "@branch/normalization-core/error-coercion";
import { isScalar, parseDocument, visit } from "yaml";
import type { ClawDiagnostic } from "./types.js";

function diagnostic(code: string, message: string): ClawDiagnostic {
  return { level: "error", code, phase: "parse", path: "$", message };
}

export function parseGroveYaml(
  raw: string,
  path: string,
  kind: "frontmatter" | "profile",
): { ok: true; value: unknown } | { ok: false; diagnostics: ClawDiagnostic[] } {
  const [invalidCode, unsupportedCode, label]: [string, string, string] =
    kind === "frontmatter"
      ? ["invalid_grove_frontmatter", "unsupported_grove_yaml_feature", "GROVE.md frontmatter"]
      : [
          "invalid_branch_profile",
          "unsupported_branch_profile_yaml_feature",
          "Branch Agent profile YAML",
        ];
  const document = parseDocument(raw, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    return {
      ok: false,
      diagnostics: document.errors.map((error) =>
        diagnostic(invalidCode, `Could not parse ${path}: ${error.message}`),
      ),
    };
  }
  let unsupportedFeature: string | undefined;
  visit(document, {
    Alias() {
      unsupportedFeature ??= "aliases";
    },
    Node(_key, node) {
      if (node.anchor) {
        unsupportedFeature ??= "anchors";
      } else if (node.tag) {
        unsupportedFeature ??= "explicit tags";
      }
    },
    Pair(_key, pair) {
      if (isScalar(pair.key) && pair.key.value === "<<") {
        unsupportedFeature ??= "merge keys";
      }
    },
  });
  if (unsupportedFeature) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          unsupportedCode,
          `${path} uses ${unsupportedFeature}; ${label} must map directly to JSON data.`,
        ),
      ],
    };
  }
  try {
    return { ok: true, value: document.toJSON() };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(invalidCode, `Could not parse ${path}: ${coerceErrorMessage(error)}`),
      ],
    };
  }
}
