/**
 * Locates local Branch Agent docs/source roots for references shown to agents.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveBranchPackageRoot } from "../infra/branch-root.js";

export const BRANCH_DOCS_URL = "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs";
export const BRANCH_SOURCE_URL = "https://github.com/openclaw/openclaw";

type ResolveBranchReferencePathParams = {
  workspaceDir?: string;
  argv1?: string;
  cwd?: string;
  moduleUrl?: string;
};

function isUsableDocsDir(docsDir: string): boolean {
  return fs.existsSync(path.join(docsDir, "docs.json"));
}

/** Resolve docs and source from one package root, preferring workspace docs. */
export async function resolveBranchReferencePaths(
  params: ResolveBranchReferencePathParams,
): Promise<{
  docsPath: string | null;
  sourcePath: string | null;
}> {
  let docsPath: string | null = null;
  const workspaceDir = params.workspaceDir?.trim();
  if (workspaceDir) {
    const workspaceDocs = path.join(workspaceDir, "docs");
    if (isUsableDocsDir(workspaceDocs)) {
      docsPath = workspaceDocs;
    }
  }

  const packageRoot = await resolveBranchPackageRoot({
    cwd: params.cwd,
    argv1: params.argv1,
    moduleUrl: params.moduleUrl,
  });
  if (!docsPath && packageRoot) {
    const packageDocs = path.join(packageRoot, "docs");
    docsPath = isUsableDocsDir(packageDocs) ? packageDocs : null;
  }
  return {
    docsPath,
    sourcePath: packageRoot && fs.existsSync(path.join(packageRoot, ".git")) ? packageRoot : null,
  };
}
