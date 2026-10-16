// Test stand-in for the desktop UI: starts the engine stand-in with the production spawn options,
// waits until it answers /readyz, reports its pid, then exits the way a quit does.
// argv: [engineSpawnDist, standinPath, port, detachedEngine ("1" | "0"), logPath]
const { openSync } = require('node:fs');
const http = require('node:http');
const { engineSpawnOptions } = require(process.argv[2]);
const [standin, port, flag, logPath] = [process.argv[3], process.argv[4], process.argv[5], process.argv[6]];

function ready() {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/readyz', timeout: 1000 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => { request.destroy(); resolve(false); });
  });
}

(async () => {
  const logFd = openSync(logPath, 'a');
  const child = require('node:child_process').spawn(process.execPath, [standin, port], engineSpawnOptions({
    platform: process.platform,
    detachedEngine: flag === '1',
    env: process.env,
    cwd: __dirname,
    logFd,
  }));
  child.unref();
  const deadline = Date.now() + 15000;
  while (!(await ready())) {
    if (Date.now() > deadline) { process.stderr.write('stand-in never ready\n'); process.exit(2); }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  process.stdout.write(`pid ${child.pid}\n`);
  process.exit(0);
})();
