// One app launch for the cross-process race test: attach or start through a shared fake service manager whose
// every start adds another engine, so only the app's start lock keeps it to one.
const { readdirSync, writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const [dist, dataDir] = process.argv.slice(2);
const { attachOrStartEngine } = require(join(dist, "engine-service.js"));
const engines = join(dataDir, "engines");
mkdirSync(engines, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const running = () => readdirSync(engines).length > 0;
attachOrStartEngine({
  dataDir,
  probe: async () => running(),
  installService: async () => { await pause(50); },
  startService: async () => { await pause(50); writeFileSync(join(engines, String(process.pid)), ""); },
  waitForService: async () => running(),
  spawnChild: async () => { writeFileSync(join(dataDir, `child-${process.pid}`), ""); },
  log: () => undefined,
}).then(result => { process.stdout.write(JSON.stringify(result)); }, () => process.exit(1));
