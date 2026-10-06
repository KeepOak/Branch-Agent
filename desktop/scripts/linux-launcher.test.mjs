import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { installLinuxLauncher } from "./linux-launcher.mjs";

const run = promisify(execFile);

test("Linux package includes an executable sandbox-checking launcher", async () => {
  const root = await mkdtemp(join(tmpdir(), "branch-linux-launcher-"));
  try {
    await writeFile(join(root, "Branch Agent"), "#!/bin/sh\nprintf 'started:%s\\n' \"$1\"\n");
    if (process.platform !== "win32") await chmod(join(root, "Branch Agent"), 0o755);
    await installLinuxLauncher(root);
    const launcher = join(root, "branch-agent");
    const source = await readFile(launcher, "utf8");
    assert.match(source, /stat -c '%u:%a'/);
    assert.match(source, /root:root/);
    assert.match(source, /chmod 4755/);
    assert.equal(await readFile(join(root, "Branch Agent"), "utf8"), source);
    assert.match(await readFile(join(root, "Branch Agent.bin"), "utf8"), /started:/);
    assert.match(await readFile(join(root, "LINUX-SETUP.txt"), "utf8"), /sudo chmod 4755 chrome-sandbox/);
    if (process.platform !== "win32") assert.equal((await stat(launcher)).mode & 0o777, 0o755);
    if (process.platform !== "linux") return;

    await writeFile(join(root, "chrome-sandbox"), "fixture");
    await assert.rejects(run(launcher, [], { env: { ...process.env, DISPLAY: "", WAYLAND_DISPLAY: "" } }),
      error => error.code === 1 && /sudo chown root:root/.test(error.stderr));

    const tools = join(root, "tools");
    await mkdir(tools);
    await writeFile(join(tools, "stat"), "#!/bin/sh\nprintf '0:4755\\n'\n");
    await chmod(join(tools, "stat"), 0o755);
    const result = await run(launcher, ["ready"], { env: { ...process.env, PATH: tools + delimiter + process.env.PATH } });
    assert.equal(result.stdout.trim(), "started:ready");
  } finally { await rm(root, { recursive: true, force: true }); }
});
