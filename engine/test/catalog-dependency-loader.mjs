import fs from "node:fs";
import { registerHooks, createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const root =
  process.env.BRANCH_CATALOG_ACCEPTANCE_ENGINE_ROOT ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dependencies = process.env.BRANCH_CATALOG_ACCEPTANCE_DEPENDENCY_ROOT ?? root;
const requireDependency = createRequire(`${dependencies}/package.json`);
const paths = JSON.parse(fs.readFileSync(`${root}/tsconfig.json`, "utf8")).compilerOptions.paths;
const resolving = new Set();
function alias(id) {
  for (const [pattern, targets] of Object.entries(paths)) {
    const w = pattern.indexOf("*");
    if (w < 0 && id === pattern) return path.resolve(root, targets[0]);
    if (w >= 0 && id.startsWith(pattern.slice(0, w)) && id.endsWith(pattern.slice(w + 1)))
      return path.resolve(
        root,
        targets[0].replace("*", id.slice(w, id.length - (pattern.length - w - 1))),
      );
  }
}
registerHooks({
  resolve(id, context, nextResolve) {
    const key = `${id}|${context.parentURL ?? ""}`;
    if (resolving.has(key)) return nextResolve(id, context);
    resolving.add(key);
    try {
      const source = alias(id);
      if (source) return { url: pathToFileURL(source).href, shortCircuit: true };
      try {
        return nextResolve(id, context);
      } catch (error) {
        if (error.code !== "ERR_MODULE_NOT_FOUND" && error.code !== "MODULE_NOT_FOUND") throw error;
        if (id.startsWith(".") && id.endsWith(".js") && context.parentURL?.startsWith("file:")) {
          const candidate = fileURLToPath(new URL(id.slice(0, -3) + ".ts", context.parentURL));
          const relative = path.relative(root, candidate);
          if (!relative.startsWith("..") && !path.isAbsolute(relative) && fs.existsSync(candidate))
            return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
        if (!id.startsWith(".") && !id.startsWith("/") && !id.includes(":/"))
          return { url: pathToFileURL(requireDependency.resolve(id)).href, shortCircuit: true };
        throw error;
      }
    } finally {
      resolving.delete(key);
    }
  },
});
