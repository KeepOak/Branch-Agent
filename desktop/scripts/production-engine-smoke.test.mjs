import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { smokeProductionEngine } from "./production-engine-smoke.mjs";

const commit = "a".repeat(40);
async function fixture(mode, body) {
  const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? process.env.BRANCH_RELEASE_TEST_TEMP ?? tmpdir(), "production-smoke-fixture-"));
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist/build-info.json"), JSON.stringify({ commit }));
  const source = String.raw`
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const mode = ${JSON.stringify(mode)};
if (mode === "exit") process.exit(7);
if (!process.env.BRANCH_STATE_DIR.startsWith(process.env.HOME) || process.env.OPENAI_API_KEY || process.env.GH_TOKEN) process.exit(9);
const config = JSON.parse(readFileSync(process.env.BRANCH_CONFIG_PATH));
if (config.plugins.enabled !== false || config.update.auto.enabled !== false) process.exit(10);
const server = createServer((req, res) => { res.writeHead(mode === "stall" ? 503 : 200); res.end("ready"); });
server.on("upgrade", (req, socket) => {
  const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
  let buffer = Buffer.alloc(0);
  socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 6) {
      let length = buffer[1] & 127, offset = 2;
      if (length === 126) { if (buffer.length < 8) return; length = buffer.readUInt16BE(2); offset = 4; }
      if (buffer.length < offset + 4 + length) return;
      const masked = buffer.subarray(offset + 4, offset + 4 + length), key = buffer.subarray(offset, offset + 4);
      const opcode = buffer[0] & 15; buffer = buffer.subarray(offset + 4 + length);
      if (opcode === 8) { socket.end(); return; }
      const payload = Buffer.from(masked); for (let i = 0; i < payload.length; i++) payload[i] ^= key[i % 4];
      const request = JSON.parse(payload.toString());
      const ok = request.method === "connect" ? mode !== "auth-fail" && request.params.auth.token === process.env.BRANCH_GATEWAY_TOKEN : mode !== "health-fail";
      const result = { type: "res", id: request.id, ok, payload: request.method === "connect" ? { type: "hello-ok" } : { ok, ts: Date.now() } };
      const bytes = Buffer.from(JSON.stringify(result));
      const header = bytes.length < 126 ? Buffer.from([129, bytes.length]) : Buffer.from([129, 126, bytes.length >> 8, bytes.length & 255]);
      socket.write(Buffer.concat([header, bytes]));
    }
  });
});
server.listen(Number(process.argv[process.argv.indexOf("--port") + 1]), "127.0.0.1");
`;
  await writeFile(join(root, "branch.mjs"), source);
  const previous = process.env.BRANCH_RELEASE_TEST_TEMP;
  process.env.BRANCH_RELEASE_TEST_TEMP = root;
  try { await body(root); }
  finally { previous === undefined ? delete process.env.BRANCH_RELEASE_TEST_TEMP : process.env.BRANCH_RELEASE_TEST_TEMP = previous; await rm(root, { recursive: true, force: true }); }
}

test("isolated actual child proves readyz, fresh token authenticated non-model health and owned shutdown", () => fixture("success", async root => {
  const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "fixture-must-not-inherit";
  try {
    const proof = await smokeProductionEngine(root, process.execPath, commit, { min: 4, max: 4 }, { budgetMs: 3000 });
    assert.equal(proof.ready, true); assert.equal(proof.authenticatedHealth, true); assert.equal(proof.exited, true);
    assert.equal(proof.runtime.platform, process.platform); assert(proof.elapsedMs < 3000);
  } finally { previous === undefined ? delete process.env.OPENAI_API_KEY : process.env.OPENAI_API_KEY = previous; }
}));
for (const [mode, message] of [["exit", /exited before/], ["stall", /readiness deadline/], ["auth-fail", /refused authenticated/], ["health-fail", /non-model health/]]) {
  test(`production smoke fails closed for ${mode} and reaps its child`, () => fixture(mode, root => assert.rejects(
    smokeProductionEngine(root, process.execPath, commit, { min: 4, max: 4 }, { budgetMs: 1800 }), message)));
}
test("production smoke rejects a different packaged source before starting a child", () => fixture("success", root => assert.rejects(
  smokeProductionEngine(root, process.execPath, "b".repeat(40), { min: 4, max: 4 }), /source identity mismatch/)));
