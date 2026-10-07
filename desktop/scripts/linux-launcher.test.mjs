import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { installLinuxLauncher } from "./linux-launcher.mjs";

const run = promisify(execFile);

test("Linux package includes an executable sandbox-checking launcher", async () => {
  const root = await mkdtemp(join(tmpdir(), "branch-linux-launcher-"));
  try {
    await writeFile(join(root, "Branch Agent"), "#!/bin/sh\nprintf 'started:%s\\n' \"$1\"\n");
    await writeFile(join(root, "chrome-sandbox"), "fixture");
    if (process.platform !== "win32") await chmod(join(root, "Branch Agent"), 0o755);
    await installLinuxLauncher(root);
    const launcher = join(root, "branch-agent");
    const source = await readFile(launcher, "utf8");
    assert.match(source, /stat -c '%u:%a'/);
    assert.match(source, /unshare -Ur true/);
    assert.match(source, /os\.O_NOFOLLOW/);
    assert.match(source, /os\.fchown\(fd, 0, 0\)/);
    assert.match(source, /os\.fchmod\(fd, 0o4755\)/);
    assert.ok(source.includes(createHash("sha256").update("fixture").digest("hex")));
    assert.doesNotMatch(source, /__BRANCH_SANDBOX_SHA256__/);
    assert.equal(await readFile(join(root, "Branch Agent"), "utf8"), source);
    assert.match(await readFile(join(root, "Branch Agent.bin"), "utf8"), /started:/);
    assert.match(await readFile(join(root, "LINUX-SETUP.txt"), "utf8"), /one authorization prompt/);
    if (process.platform !== "win32") assert.equal((await stat(launcher)).mode & 0o777, 0o755);
    if (process.platform !== "linux") return;

    const tools = join(root, "tools");
    await mkdir(tools);
    await writeFile(join(tools, "unshare"), "#!/bin/sh\nexit 1\n");
    await chmod(join(tools, "unshare"), 0o755);
    const env = { ...process.env, PATH: tools + delimiter + process.env.PATH, DISPLAY: "", WAYLAND_DISPLAY: "" };
    await assert.rejects(run(launcher, [], { env }),
      error => error.code === 1 && /one-time sandbox setup/.test(error.stderr));

    await rm(join(root, "chrome-sandbox"));
    await symlink(join(root, "Branch Agent.bin"), join(root, "chrome-sandbox"));
    await assert.rejects(run(launcher, [], { env }),
      error => error.code === 1 && /chrome-sandbox is missing/.test(error.stderr));
    await rm(join(root, "chrome-sandbox"));
    await writeFile(join(root, "chrome-sandbox"), "tampered");
    await writeFile(join(tools, "pkexec"), "#!/bin/sh\nexec \"$@\"\n");
    await chmod(join(tools, "pkexec"), 0o755);
    await assert.rejects(run(launcher, [], { env: { ...env, DISPLAY: ":99" } }),
      error => error.code === 1 && /Unexpected chrome-sandbox contents/.test(error.stderr));

    await writeFile(join(tools, "stat"), "#!/bin/sh\nprintf '0:4755\\n'\n");
    await chmod(join(tools, "stat"), 0o755);
    const result = await run(launcher, ["ready"], { env });
    assert.equal(result.stdout.trim(), "started:ready");
    await writeFile(join(tools, "unshare"), "#!/bin/sh\nexit 0\n");
    const userNamespace = await run(launcher, ["userns"], { env });
    assert.equal(userNamespace.stdout.trim(), "started:userns");
  } finally { await rm(root, { recursive: true, force: true }); }
});
