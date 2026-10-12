import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const mockedOwners = new Map([
  ["agents/agent-scope-config.ts", ["resolveConfiguredAgentId"]],
  ["cli/failure-output.ts", ["ExpectedCliError"]],
  ["config/config.ts", ["getRuntimeConfig"]],
  ["config/sessions/paths.ts", ["resolveSessionStorePathCore"]],
  ["config/sessions/session-accessor.ts", ["loadSessionEntryReadOnly", "listSessionEntriesReadOnly",
    "resolveSessionTranscriptReadTarget", "readSessionTranscriptMessageEventPage", "readTranscriptExportSnapshotReadOnlySync"]],
  ["routing/session-key.ts", ["resolveAgentIdFromSessionKey"]],
  ["commands/session-store-targets.ts", ["resolveExplicitSessionStorePath", "resolveCommandSessionStoreTargets"]],
]);
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@branch/normalization-core/number-coercion") return { url: "fixture:normalization", shortCircuit: true };
  if (specifier.endsWith(".js") && specifier.startsWith(".")) {
    const url = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
    if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url === "fixture:normalization") return { format: "module", shortCircuit: true,
    source: "export const parseStrictPositiveInteger = (value) => /^\\d+$/.test(String(value)) && Number(value) > 0 ? Number(value) : undefined;" };
  const fixtures = {
    "packages/terminal-core/src/theme.ts": 'export const theme = { muted: x => x };',
    "src/globals.ts": 'export const setVerbose = () => {};',
    "src/runtime.ts": 'export const defaultRuntime = { log: x => globalThis.__sessionCliOutput.push(x) };',
    "src/cli/cli-utils.ts": 'export const runCommandWithRuntime = async (runtime, callback) => callback();',
    "src/cli/help-format.ts": 'export const formatDocsHelp = () => ""; export const formatHelpExamples = () => "";',
  };
  const fixture = Object.entries(fixtures).find(([suffix]) => url.endsWith(suffix));
  if (fixture) return { format: "module", shortCircuit: true, source: fixture[1] };
  const owner = [...mockedOwners].find(([suffix]) => url.endsWith(suffix));
  if (owner) return { format: "module", source: owner[1].map((name) =>
    `export const ${name} = (...args) => globalThis.__sessionExportOwners.${name}(...args);`
  ).join("\n").replace("export const ExpectedCliError = (...args) => globalThis.__sessionExportOwners.ExpectedCliError(...args);",
    "export const ExpectedCliError = class extends Error { constructor(options) { super(options.message); } };"), shortCircuit: true };
  if (url.endsWith(".ts")) return { format: "module", source: stripTypeScriptTypes(
    readFileSync(fileURLToPath(url), "utf8")), shortCircuit: true };
  return next(url, context);
} });
const { nativeTranscriptEntries } = await import("./resume-transcript-entries.js");
const { entriesToMarkdown, entriesToHtml } = await import("./resume-transcript-render.js");
const { formatContextTranscript } = await import("./resume-context-transcript.js");
const { entriesToPlainText, stripThoughtChain } = await import("./resume-export-plaintext.js");
const { buildSessionRecap, nativeRecapMessages } = await import("./resume-session-recap.js");
const { nativeMessageTree } = await import("./resume-native-message-tree.js");
await import("./resume-message-tree.native-tests.ts");
const { sessionExportCommand } = await import("./resume-export-command.js");
const ts = "2026-07-10T12:34:56.000Z";
const events = [
  { timestamp: ts, message: { role: "user", content: "Please diagnose **the failure**." } },
  { timestamp: ts, message: { role: "assistant", content: [{ type: "text", text: "Checking now." },
    { type: "toolCall", name: "exec", arguments: { secret: "must-not-export" } }] } },
  { timestamp: ts, message: { role: "toolResult", toolName: "exec", content: [{ type: "text", text: "trace\n```nested```" }] } },
];
const options = { includeToolDetails: true, includeTimestamps: true, title: "Failure diagnosis", model: "test/model" };
const entries = nativeTranscriptEntries(events, options);

test("ported OpenHands messages and collapsed tool details in Markdown", () => {
  const md = entriesToMarkdown(entries, options);
  assert.match(md, /^# Failure diagnosis/); assert.match(md, /## User/);
  assert.match(md, /Please diagnose \*\*the failure\*\*/); assert.match(md, /<details>/);
  assert.match(md, /````text\ntrace\n```nested```\n````/);
});
test("ported OpenHands honors detail and timestamp options", () => {
  const disabled = { ...options, includeToolDetails: false, includeTimestamps: false };
  for (const output of [entriesToMarkdown(entries, disabled), entriesToHtml(entries, disabled)]) {
    assert.ok(!output.includes("<details>")); assert.ok(!output.includes(ts));
    assert.ok(!output.includes("trace"));
  }
});
test("ported OpenHands neutralizes active Markdown and HTML", () => {
  const hostile = [{ kind: "message", author: "user", timestamp: ts,
    content: '<script>alert(1)</script> [click](javascript:alert(1))' }];
  const md = entriesToMarkdown(hostile, options); const html = entriesToHtml(hostile, options);
  assert.ok(!md.includes("<script>")); assert.ok(md.includes("\\[click\\]"));
  assert.ok(!html.includes("<script>")); assert.ok(html.includes("&lt;script&gt;"));
});
test("ported OpenHands standalone HTML has restrictive content policy", () => {
  const html = entriesToHtml(entries, options);
  assert.match(html, /^<!doctype html>/); assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/); assert.ok(html.includes("<style>"));
  assert.ok(!html.includes("must-not-export"));
});
test("native adaptation excludes binary payloads, signatures, synthetic text and hidden reasoning", () => {
  const adapted = nativeTranscriptEntries([{ message: { role: "assistant", content: [
    { type: "image", data: "hidden" }, { type: "text", synthetic: true, text: "plumbing" },
    { type: "thinking", thinking: "reason", signature: "signature" },
  ] } }], options);
  assert.deepEqual(adapted, []);
  const reasoning = nativeTranscriptEntries([{ message: { role: "assistant", content: [
    { type: "thinking", thinking: "reason", signature: "signature" },
  ] } }], { ...options, includeReasoning: true });
  assert.equal(reasoning[0].content, "reason"); assert.ok(!JSON.stringify(reasoning).includes("signature"));
});
test("native adaptation handles timestamps and malformed historical messages", () => {
  assert.deepEqual(nativeTranscriptEntries([null, {}, { message: { role: "system", content: "hidden" } }], options), []);
  const row = nativeTranscriptEntries([{ message: { timestamp: 0, role: "user", content: "hello" } }], options)[0];
  assert.equal(row.timestamp, "1970-01-01T00:00:00.000Z");
});
test("source inline reasoning and native hidden display messages stay separate from visible prose", () => {
  const rows = [{ message: { role: "user", display: false, content: "hidden" } },
    { message: { role: "assistant", content: "<think>reason</think><answer>visible</answer>" } }];
  assert.deepEqual(nativeTranscriptEntries(rows, options).map((entry) => entry.content), ["visible"]);
  assert.deepEqual(nativeTranscriptEntries(rows, { ...options, includeReasoning: true }).map((entry) => entry.content), ["reason", "visible"]);
});
test("Kilo context preserves original request and latest discussion with honest omission marker", () => {
  const content = formatContextTranscript("Title", [{ kind: "message", author: "user",
    timestamp: "", content: "request " + "x".repeat(200) + " latest" }], { max: 60 });
  assert.ok(content.startsWith("# Session: Title")); assert.ok(content.endsWith("latest\n"));
  assert.match(content, /characters omitted from the middle/);
  assert.throws(() => formatContextTranscript("x", [], { max: 0 }));
});

function commandFixture() {
  const calls = []; const output = [];
  const owner = (name, result) => (...args) => { calls.push({ name, args }); return result; };
  globalThis.__sessionExportOwners = {
    getRuntimeConfig: owner("config", { session: { store: "/physical/config.sqlite" } }),
    resolveConfiguredAgentId: owner("agent", "selected"),
    resolveAgentIdFromSessionKey: owner("keyAgent", "main"),
    resolveSessionStorePathCore: owner("store", "/physical/selected.sqlite"),
    resolveExplicitSessionStorePath: owner("explicitStore", "/physical/explicit.sqlite"),
    loadSessionEntryReadOnly: owner("entry", { sessionId: "real-id", label: "Saved title", model: "test/model" }),
    listSessionEntriesReadOnly: owner("list", [{ sessionKey: "agent:main:chat", entry: { sessionId: "real-id", label: "Saved title" } },
      { sessionKey: "agent:main:empty", entry: {} }]),
    resolveCommandSessionStoreTargets: owner("stores", [{ agentId: "physical", storePath: "/physical/explicit.sqlite" }]),
    resolveSessionTranscriptReadTarget: owner("target", { agentId: "physical", sessionId: "real-id",
      sessionKey: "agent:main:chat", storePath: "/physical/explicit.sqlite" }),
    readSessionTranscriptMessageEventPage: owner("page", { events: events.map((event) => ({ event })) }),
  };
  return { calls, output, runtime: { log: (value) => output.push(value) } };
}
test("actual export command binds exact readonly physical active-path scope", async () => {
  const fixture = commandFixture();
  await sessionExportCommand({ sessionKey: "agent:main:chat", store: "/requested",
    agent: "selected", format: "html" }, fixture.runtime);
  assert.equal(fixture.calls.find((call) => call.name === "entry").args[0].storePath, "/physical/explicit.sqlite");
  assert.deepEqual(fixture.calls.find((call) => call.name === "page").args,
    [{ agentId: "physical", sessionId: "real-id", sessionKey: "agent:main:chat", storePath: "/physical/explicit.sqlite" },
      { offset: 0, offsetFrom: "start", maxMessages: Number.MAX_SAFE_INTEGER, readOnly: true }]);
  assert.ok(fixture.output[0].includes("Saved title"));
});
test("command emits JSON and context through the production renderer", async () => {
  let fixture = commandFixture();
  await sessionExportCommand({ sessionKey: "agent:main:chat", format: "json" }, fixture.runtime);
  assert.equal(JSON.parse(fixture.output[0]).sessionId, "real-id");
  fixture = commandFixture();
  await sessionExportCommand({ sessionKey: "agent:main:chat", format: "context" }, fixture.runtime);
  assert.ok(fixture.output[0].includes("## User"));
});
test("invalid selectors and format fail before owner reads", async () => {
  for (const bad of [{}, { sessionKey: "x", agent: " " }, { sessionKey: "x", store: " " },
    { sessionKey: "x", format: "unknown" }, { sessionKey: "x", contextMax: "5" },
    { sessionKey: "x", format: "context", contextMax: "NaN" }]) {
    const fixture = commandFixture();
    await assert.rejects(sessionExportCommand(bad, fixture.runtime));
    assert.equal(fixture.output.length, 0);
    assert.equal(fixture.calls.length, 0);
  }
});
test("missing selected session never resolves or exports another transcript", async () => {
  const fixture = commandFixture(); globalThis.__sessionExportOwners.loadSessionEntryReadOnly = () => undefined;
  await assert.rejects(sessionExportCommand({ sessionKey: "missing" }, fixture.runtime), /Session not found/);
  assert.ok(!fixture.calls.some((call) => call.name === "page"));
});
test("source AnythingLLM plaintext strips assistant thought chains and retains user quotes", () => {
  assert.equal(stripThoughtChain("<think>hidden</think><response>answer</response>"), "answer");
  const output = entriesToPlainText([{ kind: "message", author: "user", content: "<think>quote</think>", timestamp: "" },
    { kind: "message", author: "assistant", content: "<thought_chain>hidden</thought_chain>visible", timestamp: "" }], "Title");
  assert.ok(output.includes("<think>quote</think>")); assert.ok(output.includes("visible")); assert.ok(!output.includes("hidden"));
});
test("export all uses selected physical stores and omits metadata-only rows", async () => {
  const fixture = commandFixture();
  await sessionExportCommand({ all: true, allAgents: true, format: "json" }, fixture.runtime);
  assert.equal(JSON.parse(fixture.output[0]).conversations.length, 1);
  assert.deepEqual(fixture.calls.find((call) => call.name === "list").args[0],
    { agentId: "physical", storePath: "/physical/explicit.sqlite", projection: "list" });
  assert.ok(!fixture.calls.some((call) => call.name === "entry"));
});
test("export all HTML is a single self-contained document", async () => {
  const fixture = commandFixture();
  globalThis.__sessionExportOwners.listSessionEntriesReadOnly = () => [
    { sessionKey: "first", entry: { sessionId: "first-id", label: "First" } },
    { sessionKey: "second", entry: { sessionId: "second-id", label: "Second" } },
  ];
  await sessionExportCommand({ all: true, format: "html" }, fixture.runtime);
  assert.equal(fixture.output[0].match(/<!doctype html>/g).length, 1);
  assert.ok(fixture.output[0].includes("First")); assert.ok(fixture.output[0].includes("Second"));
});
test("export all rejects conflicting selectors before reading stores", async () => {
  for (const bad of [{ all: true, sessionKey: "selected" }, { allAgents: true, sessionKey: "selected" }]) {
    const fixture = commandFixture(); await assert.rejects(sessionExportCommand(bad, fixture.runtime));
    assert.equal(fixture.calls.length, 0);
  }
});
test("real Commander registration reaches the actual export with inherited scope and disabled details", async () => {
  assert.ok(process.env.BRANCH_NATIVE_COMMANDER_PATH, "Set BRANCH_NATIVE_COMMANDER_PATH to existing Commander entrypoint");
  const require = createRequire(import.meta.url);
  const { Command } = require(process.env.BRANCH_NATIVE_COMMANDER_PATH);
  const { registerStatusHealthSessionsCommands } = await import("../cli/program/register.status-health-sessions.js");
  const fixture = commandFixture(); globalThis.__sessionCliOutput = [];
  const program = new Command(); registerStatusHealthSessionsCommands(program);
  await program.parseAsync(["sessions", "--agent", "selected", "export", "--session-key", "agent:main:chat",
    "--format", "markdown", "--no-include-tool-details", "--no-include-timestamps"], { from: "user" });
  assert.equal(fixture.calls.find((call) => call.name === "agent").args[1], "selected");
  assert.ok(globalThis.__sessionCliOutput[0].includes("## User"));
  assert.ok(!globalThis.__sessionCliOutput[0].includes("trace"));
  assert.ok(!globalThis.__sessionCliOutput[0].includes(ts));
});
test("Hermes pinned recap truncates a long prompt preview", () => {
  const output = buildSessionRecap([{ role: "user", content: "x ".repeat(500) }]);
  const ask = output.split("\n").find((line) => line.includes("Last ask"));
  assert.ok(ask.length < 300); assert.ok(ask.includes("…"));
});
test("Hermes pinned recap neutralizes terminal escapes", () => {
  const output = buildSessionRecap([{ role: "user", content: "please \x1b[2J\x1b]0;pwned\x07 do the thing" },
    { role: "assistant", content: "done \x9b31m with it\x07" }]);
  assert.ok(!/[\x1b\x9b\x07]/.test(output)); assert.ok(output.includes("do the thing")); assert.ok(output.includes("with it"));
});
test("recap recent twenty visible turns retains riding tool messages and total attribution", () => {
  const messages = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `turn${index}` }));
  messages.push({ role: "tool", content: "result" });
  const output = buildSessionRecap(messages, { title: "Title" });
  assert.ok(output.includes("10 user turns / 10 assistant replies (of 15/15 total), 1 tool result"));
  assert.ok(output.includes("Last ask: turn28")); assert.ok(output.includes("Last reply: turn29"));
});
test("recap native tool calls are counted and touched files retain newest-first identity", () => {
  const output = buildSessionRecap(nativeRecapMessages([{ message: { role: "assistant", content: [
    { type: "toolCall", name: "write", arguments: { path: "older.ts", secret: "not-output" } },
    { type: "toolCall", name: "write", arguments: { path: "newer.ts" } },
    { type: "toolCall", name: "read", arguments: { path: "older.ts" } },
  ] } }]));
  assert.ok(output.includes("write×2, read×1")); assert.ok(output.includes("older.ts, newer.ts"));
  assert.ok(!output.includes("not-output"));
});
test("recap handles empty history and malformed tool arguments", () => {
  assert.ok(buildSessionRecap([], { sessionId: "123456789" }).includes("12345678"));
  assert.ok(buildSessionRecap([{ role: "assistant", tool_calls: [{ function: { name: "exec", arguments: "{" } }] }]).includes("exec×1"));
});
test("actual recap command consumes readonly selected transcript and never calls a model", async () => {
  const fixture = commandFixture();
  await sessionExportCommand({ sessionKey: "agent:main:chat", format: "recap" }, fixture.runtime);
  assert.ok(fixture.output[0].startsWith("Session recap — Saved title"));
  assert.ok(fixture.output[0].includes("exec×1"));
  assert.equal(fixture.calls.filter((call) => call.name === "page").length, 1);
});
test("real Commander recap registration forwards inherited physical scope", async () => {
  const require = createRequire(import.meta.url); const { Command } = require(process.env.BRANCH_NATIVE_COMMANDER_PATH);
  const { registerStatusHealthSessionsCommands } = await import("../cli/program/register.status-health-sessions.js");
  const fixture = commandFixture(); globalThis.__sessionCliOutput = [];
  const program = new Command(); registerStatusHealthSessionsCommands(program);
  await program.parseAsync(["sessions", "--agent", "selected", "recap", "--session-key", "agent:main:chat"], { from: "user" });
  assert.ok(globalThis.__sessionCliOutput[0].startsWith("Session recap"));
  assert.equal(fixture.calls.find((call) => call.name === "agent").args[1], "selected");
});
test("native graph preserves assistant siblings, boundaries, skipped tool plumbing and active leaf", () => {
  const events = [
    { id: "user", parentId: null, message: { role: "user", content: "Request" } },
    { id: "a", parentId: "user", message: { role: "assistant", content: "First" } },
    { id: "b", parentId: "user", message: { role: "assistant", content: "Second" } },
    { id: "tool", parentId: "b", message: { role: "toolResult", content: "binary-secret", data: "not-exported" } },
    { id: "boundary", parentId: "tool", type: "compaction", summary: "Context boundary" },
    { id: "next", parentId: "boundary", message: { role: "user", content: "Next" } },
  ];
  const graph = nativeMessageTree(events, "next");
  assert.equal(graph.stats.nodeCount, 5); assert.equal(graph.stats.activePathLength, 4);
  assert.equal(graph.edges.find((edge) => edge.target === "boundary").source, "b");
  assert.ok(graph.nodes.find((node) => node.id === "a").data.isInactiveBranch);
  assert.ok(graph.nodes.find((node) => node.id === "boundary").data.isContextBoundary);
  assert.ok(!JSON.stringify(graph).includes("binary-secret"));
});
test("graph export uses native leaf and raw events from one readonly snapshot", async () => {
  const fixture = commandFixture(); const snapshotCalls = [];
  globalThis.__sessionExportOwners.readTranscriptExportSnapshotReadOnlySync = (...args) => {
    snapshotCalls.push(args); return { events: [{ id: "one", message: { role: "user", content: "Hello" } }], activeLeafEntryId: "one" };
  };
  await sessionExportCommand({ sessionKey: "agent:main:chat", format: "graph" }, fixture.runtime);
  assert.equal(snapshotCalls.length, 1); assert.deepEqual(snapshotCalls[0][1], { includeActiveLeaf: true });
  assert.equal(JSON.parse(fixture.output[0]).activeNodeId, "one");
  assert.ok(!fixture.calls.some((call) => call.name === "page"));
});
