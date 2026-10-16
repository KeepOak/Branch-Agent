// The app's stand-in for the Windows job-object test. Node and Electron share libuv, which puts every non-detached
// child in one job object with KILL_ON_JOB_CLOSE, so whatever this process starts as a plain child dies with it.
//   service: start the engine the way the app does with always on: the service manager (Task Scheduler) starts it.
//   child:   the old way, the engine as this process's own child (the negative control).
const { spawn } = require("node:child_process");
const { openSync, closeSync } = require("node:fs");
const { join } = require("node:path");
const [mode, dist, taskName, node, standin, port, pidFile] = process.argv.slice(2);
const { engineAnswers, runEngineCli, waitForEngineAnswer } = require(join(dist, "engine-service.js"));
(async () => {
  if (mode === "service") {
    await runEngineCli({ file: "schtasks.exe", args: ["/Run", "/TN", taskName], cwd: process.cwd(), env: process.env });
  } else if (mode === "detached") {
    // Keep working on, service fallback: detached and hidden, so the Windows job does not kill it with the app.
    const { fallbackEngineSpawnOptions } = require(join(dist, "fallback-engine.js"));
    const logFd = openSync(`${pidFile}.log`, "a");
    try {
      const child = spawn(node, [standin, port, pidFile], fallbackEngineSpawnOptions({
        platform: process.platform, surviveQuit: true, env: process.env, cwd: process.cwd(), logFd,
      }));
      child.unref();
    } finally { closeSync(logFd); }
  } else {
    spawn(node, [standin, port, pidFile], { windowsHide: true, stdio: "ignore" });
  }
  if (!await waitForEngineAnswer(() => engineAnswers(Number(port)), 30_000)) process.exit(2);
  process.exit(0);
})().catch(() => process.exit(3));
