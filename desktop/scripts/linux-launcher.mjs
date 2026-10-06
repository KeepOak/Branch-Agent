import { copyFile, chmod, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Ship an explicit launcher: a user-extracted tarball cannot retain a root-owned setuid chrome-sandbox. */
export async function installLinuxLauncher(app) {
  const source = fileURLToPath(new URL("./branch-agent-linux.sh", import.meta.url));
  await rename(join(app, "Branch Agent"), join(app, "Branch Agent.bin"));
  for (const name of ["Branch Agent", "branch-agent"]) {
    const target = join(app, name);
    await copyFile(source, target);
    await chmod(target, 0o755);
  }
  await writeFile(join(app, "LINUX-SETUP.txt"), `Launch Branch Agent with ./branch-agent or ./Branch\\ Agent.
The launchers set up Chromium's chrome-sandbox before starting Electron.
If the authorization prompt is unavailable, run these commands from this folder:
  sudo chown root:root chrome-sandbox
  sudo chmod 4755 chrome-sandbox
Then launch Branch Agent again. A whole-runtime update may require this for its new sandbox binary.
`);
}
