// Quits the way the desktop does for the service fallback.
// Starts the engine with production startGateway, then either leaves it or stops it.
// argv: dist, dataDir, port, keepWorking ("1" or "0"), alwaysOn ("1" or "0")
const { join } = require("node:path");
const [dist, dataDir, portText, keepWorkingArg, alwaysOnArg] = process.argv.slice(2);
const keepWorking = keepWorkingArg === "1";
const alwaysOn = alwaysOnArg === "1";
const port = Number(portText);
const { startGateway, stopGateway } = require(join(dist, "gateway.js"));
const { fallbackEngineSurvivesQuit, quitLeavesFallbackEngine } = require(join(dist, "fallback-engine.js"));
const { engineAnswers } = require(join(dist, "engine-service.js"));

(async () => {
  const survive = fallbackEngineSurvivesQuit(alwaysOn, keepWorking);
  const child = startGateway(
    { dataDir, nodePath: process.execPath, gatewayPort: port },
    dataDir, "token", false, port, undefined, undefined, survive,
  );
  const end = Date.now() + 15_000;
  let ready = false;
  while (Date.now() < end) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    if (await engineAnswers(port)) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!ready) {
    stopGateway(child);
    process.stderr.write(`fallback engine did not answer (exit ${child.exitCode} ${child.signalCode ?? ""})\n`);
    process.exit(2);
  }
  process.stdout.write(`pid ${child.pid}\n`);
  if (!quitLeavesFallbackEngine(survive, keepWorking, false)) stopGateway(child);
  process.exit(0);
})().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
