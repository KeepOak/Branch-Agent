import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Ship an explicit launcher: a user-extracted tarball cannot retain a root-owned setuid chrome-sandbox. */
export async function installLinuxLauncher(app) {
  const source = fileURLToPath(new URL("./branch-agent-linux.sh", import.meta.url));
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(app, "chrome-sandbox"))) hash.update(chunk);
  const launcher = (await readFile(source, "utf8")).replace("__BRANCH_SANDBOX_SHA256__", hash.digest("hex"));
  await rename(join(app, "Branch Agent"), join(app, "Branch Agent.bin"));
  for (const name of ["Branch Agent", "branch-agent"]) {
    const target = join(app, name);
    await writeFile(target, launcher);
    await chmod(target, 0o755);
  }
  await writeFile(join(app, "LINUX-SETUP.txt"), `Launch Branch Agent with ./branch-agent or ./Branch\\ Agent.
The launcher uses unprivileged user namespaces when available. Otherwise it offers one authorization prompt to set up Chromium's chrome-sandbox safely.
If the authorization prompt is unavailable, launch from a terminal with sudo available and try again.
A whole-runtime update may require setup for its new sandbox binary.
`);
}
