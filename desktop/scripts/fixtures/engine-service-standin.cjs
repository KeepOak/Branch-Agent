// Engine stand-in for the always-on tests: answers /readyz on the given loopback port and records its pid.
const { createServer } = require("node:http");
const { writeFileSync } = require("node:fs");
const [port, pidFile] = process.argv.slice(2);
createServer((req, res) => { res.statusCode = req.url === "/readyz" ? 200 : 404; res.end(); })
  .listen(Number(port), "127.0.0.1", () => writeFileSync(pidFile, String(process.pid)));
// Never outlive the test by long, even if its cleanup could not run.
setTimeout(() => process.exit(0), 120_000).unref?.();
setInterval(() => undefined, 60_000);
