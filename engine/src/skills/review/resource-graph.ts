import path from "node:path";
import { extractSkillReferences } from "./resource-references.js";

export type ResourceFinding = {
  ruleId: string;
  severity: "warning";
  path: string;
  target?: string;
};
type Edge = { source: string; target: string };
const resourceDirs = new Set(["references", "scripts", "templates", "assets", "evals"]);

function isEvalFixture(file: string): boolean {
  const parts = file.split("/");
  const index = parts.indexOf("evals");
  return index >= 0 && parts[index + 1] === "fixtures" && parts.length > index + 2;
}

function resolveReference(source: string, raw: string, files: Set<string>): string | null {
  let ref = raw.trim().replace(/^["']|["']$/gu, "");
  if (
    !ref ||
    ref.startsWith("#") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(ref) ||
    ref.includes("://")
  ) {
    return null;
  }
  if (ref.startsWith("/")) {
    return "__ESCAPES__";
  }
  const base = path.posix.dirname(source);
  if (ref.includes("#")) {
    const hash = ref.indexOf("#");
    const fragment = ref.slice(hash + 1);
    const literal = path.posix.normalize(path.posix.join(base, ref));
    if (!(`/${fragment}`.includes("/..") || fragment.startsWith("..")) && files.has(literal)) {
      return literal;
    }
    ref = ref.slice(0, hash);
  }
  const resolved =
    path.posix.normalize(path.posix.join(base, ref).replaceAll("\\", "/")).replace(/\/+$/u, "") ||
    "/";
  return resolved === "." ||
    resolved === ".." ||
    resolved.startsWith("../") ||
    resolved.startsWith("/")
    ? "__ESCAPES__"
    : resolved;
}

function uniqueEdges(items: Edge[]): Edge[] {
  return [
    ...new Map(items.map((edge) => [JSON.stringify([edge.source, edge.target]), edge])).values(),
  ].toSorted((a, b) => {
    const left = JSON.stringify([a.source, a.target]);
    const right = JSON.stringify([b.source, b.target]);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function uniqueResourceFindings(findings: ResourceFinding[]): ResourceFinding[] {
  return [
    ...new Map(
      findings.map((finding) => [
        JSON.stringify([finding.ruleId, finding.path, finding.target]),
        finding,
      ]),
    ).values(),
  ].toSorted((a, b) => {
    const rank = (finding: ResourceFinding) => (finding.ruleId === "resource.missing" ? 0 : 1);
    return rank(a) - rank(b);
  });
}

function graphReferences(files: Record<string, string>, complete: boolean) {
  const paths = new Set(Object.keys(files));
  const edges: Edge[] = [];
  const unresolved: Edge[] = [];
  const findings: ResourceFinding[] = [];
  for (const source of [...paths].toSorted()) {
    if (isEvalFixture(source)) {
      continue;
    }
    for (const raw of [...extractSkillReferences(files[source] ?? "")].toSorted()) {
      const target = resolveReference(source, raw, paths);
      if (target === null) {
        continue;
      }
      if (target === "__ESCAPES__") {
        findings.push({
          ruleId: "resource.escaping-link",
          severity: "warning",
          path: source,
          target: raw,
        });
      } else if (paths.has(target)) {
        edges.push({ source, target });
      } else if (complete) {
        findings.push({ ruleId: "resource.missing", severity: "warning", path: source, target });
      } else {
        unresolved.push({ source, target });
      }
    }
  }
  return {
    edges: uniqueEdges(edges),
    unresolved: uniqueEdges(unresolved),
    findings: uniqueResourceFindings(findings),
  };
}

/** An incomplete catalog read cannot establish whether a companion file exists. */
export function buildSkillResourceGraph(files: Record<string, string>, complete = true) {
  const { edges, unresolved, findings } = graphReferences(files, complete);
  const referenced = new Set(edges.map((edge) => edge.target));
  const orphans = complete
    ? Object.keys(files)
        .filter(
          (file) =>
            resourceDirs.has(file.split("/")[0] ?? "") &&
            !referenced.has(file) &&
            !isEvalFixture(file) &&
            file !== "evals/evals.json" &&
            file !== "evals/trigger_eval_set.json",
        )
        .toSorted()
    : [];
  for (const orphan of orphans) {
    findings.push({ ruleId: "resource.unreferenced", severity: "warning", path: orphan });
  }
  return {
    nodes: Object.keys(files)
      .toSorted()
      .map((file) => ({ path: file, kind: "text" as const })),
    edges,
    orphans,
    unresolved,
    findings,
  };
}
