#!/usr/bin/env node
// Like mcp-proxy.cjs, but exits 1 with a stderr reason when a crash_proxy tool call arrives,
// while BRANCH_TEST_CRASH_FILE still holds a positive crash budget. BRANCH_TEST_CRASH_ON overrides
// the text that triggers the crash.
const fs = require("node:fs");
const net = require("node:net");
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "mcp" || args[1] !== "--embedded" || args[2] !== "--socket") {
  process.exit(64);
}
const budgetFile = process.env.BRANCH_TEST_CRASH_FILE;
const crashOn = process.env.BRANCH_TEST_CRASH_ON || "crash_proxy";
const socket = net.createConnection(args[3]);
socket.pipe(process.stdout);
process.stdin.on("data", (chunk) => {
  if (budgetFile && chunk.includes(crashOn)) {
    const budget = Number(fs.readFileSync(budgetFile, "utf8"));
    if (budget > 0) {
      fs.writeFileSync(budgetFile, String(budget - 1));
      process.stderr.write("fixture proxy crashed\n", () => process.exit(1));
      return;
    }
  }
  socket.write(chunk);
});
socket.on("error", (error) => {
  process.stderr.write(error.message);
  process.exit(66);
});
socket.on("close", () => process.exit(0));
