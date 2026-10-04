import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const packages = new URL("../../packages/", import.meta.url);
const dependencyRoot = process.env.BRANCH_SESSION_TEST_DEPENDENCY_ROOT;
const dependencyParent = dependencyRoot
  ? pathToFileURL(`${dependencyRoot}/package.json`).href
  : undefined;

// Load the actual workspace sources, without a build or runtime mocks.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@branch/")) {
      const [name, ...subpath] = specifier.slice("@branch/".length).split("/");
      const candidate = new URL(`${name}/src/${subpath.join("/") || "index"}.ts`, packages);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
    if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
      const candidate = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        error.code !== "ERR_MODULE_NOT_FOUND" ||
        !dependencyParent ||
        specifier.startsWith(".") ||
        specifier.startsWith("/") ||
        specifier.startsWith("file:")
      ) {
        throw error;
      }
      return nextResolve(specifier, { ...context, parentURL: dependencyParent });
    }
  },
});
