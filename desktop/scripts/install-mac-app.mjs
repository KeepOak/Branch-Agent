// Copies a built Branch.app into /Applications (or ~/Applications) and registers it.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = process.env.BRANCH_DESKTOP_TEST_DIST ?? join(desktopRoot, "dist");
const source = process.argv[2];
if (!source) {
  console.error("Usage: node scripts/install-mac-app.mjs <path-to.app>");
  process.exit(1);
}
const { installMacApp } = await import(pathToFileURL(join(dist, "mac-applications.js")));
const applicationsDirectory = process.env.BRANCH_MAC_APPLICATIONS;
const destination = await installMacApp(resolve(source), applicationsDirectory ? { applicationsDirectory } : {});
console.log(destination);
