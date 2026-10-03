import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { projectImportantSessionFilePaths } from "./important-session-files.js";

type Params = { sessionKey: string; agentId?: string; path?: string; search?: string };
type Response = { files: { path: string; missing?: boolean }[]; browser?: { entries: { path: string; kind: "file" | "directory" }[] }; root?: string };
type Sink = { sessionKey?: string; importantPaths?: string[]; root?: string; file?: object };
const source = readFileSync(new URL("../gateway/server-methods/sessions-files.ts", import.meta.url), "utf8");
const body = source.slice(source.indexOf("async function handleSessionFilesRead("), source.indexOf("export const sessionsFilesHandlers:"));
assert.ok(body.startsWith("async function handleSessionFilesRead("));
const stripped = stripTypeScriptTypes(body);
function fixture(options: {
  repository?: "stored" | "remote";
  denied?: boolean;
  staleAfter?: number;
  result?: Response;
} = {}) {
  const result = options.result ?? { root: "C:/private-root", files: [{ path: "README.md" }, { path: "src/a.ts" }, { path: "package.json", missing: true }], browser: { entries: [{ path: "Dockerfile", kind: "file" }, { path: "LICENSE", kind: "directory" }] } };
  const events: string[] = [];
  const responses: Sink[] = [];
  let assertions = 0;
  const context = { getRuntimeConfig: () => ({ synthetic: true }) };
  const loaded = { files: [], root: "C:/private-root", repository: options.repository ? { kind: options.repository, inspect: async (kind: string, query: object) => { events.push(`inspect:${kind}`); assert.ok(query); return result; } } : undefined };
  const dependencies: Record<string, unknown> = {
    requireSessionFilesAgentId: (value: { sessionKey: string; agentId?: string }) => { assert.equal(value.sessionKey, "agent:test:current"); return options.denied ? undefined : "resolved-test"; },
    retainSessionScopedRead: (value: { context: object }, key: string, agent: string, admission: object) => { assert.equal(value.context, context); assert.equal(key, "agent:test:current"); assert.equal(agent, "resolved-test"); assert.deepEqual(admission, { requireMaterialized: true }); events.push("retain"); return { assertCurrent: () => { assertions++; if (assertions === options.staleAfter) throw new Error("stale-read"); }, release: () => events.push("release") }; },
    loadSessionFiles: async (value: Params & { context: object }) => { assert.equal(value.agentId, "resolved-test"); assert.equal(value.context, context); events.push("load"); return loaded; },
    listRepositoryArtifacts: async (repository: object, query: { path?: string; search?: string }) => { assert.equal(repository, loaded.repository); assert.equal(query.search, "requested"); events.push("stored-list"); return result; },
    listSessionWorkspaceFiles: async (value: { search?: string; assertCurrent: () => void }) => { assert.equal(value.search, "requested"); value.assertCurrent(); events.push("local-list"); return result; },
    getSessionWorkspaceFile: async () => ({ root: "C:/private-root", file: { path: "README.md", content: "text" } }),
    getRepositoryArtifact: async () => ({ file: { path: "README.md", content: "text" } }),
    respondSessionFileNotFound: () => assert.fail("unexpected missing file"),
    respondSessionFileTooLarge: () => assert.fail("unexpected too-large file"),
    projectImportantSessionFilePaths,
  };
  const handler = Function(...Object.keys(dependencies), `${stripped};return handleSessionFilesRead;`)(...Object.values(dependencies)) as (options: object, request: { kind: "list" | "get"; params: Params }) => Promise<void>;
  return {
    events, responses, result,
    run: (kind: "list" | "get" = "list") => handler({ context, respond: (ok: boolean, response: Sink) => { assert.equal(ok, true); responses.push(response); events.push("respond"); } }, { kind, params: { sessionKey: "agent:test:current", search: "requested" } }),
  };
}

test("actual local list handler projects only returned nonmissing files and nondirectory entries", async () => {
  const current = fixture();
  await current.run();
  assert.deepEqual(current.responses[0]?.importantPaths, ["README.md", "Dockerfile"]);
  assert.equal(current.responses[0]?.sessionKey, "agent:test:current");
  assert.equal(current.responses[0]?.root, "C:/private-root");
  assert.deepEqual(current.result.files.map(file => file.path), ["README.md", "src/a.ts", "package.json"]);
  assert.deepEqual(current.events, ["retain", "load", "local-list", "respond", "release"]);
});
test("actual stored repository list keeps root redacted and classifies returned paths", async () => {
  const current = fixture({ repository: "stored" });
  await current.run();
  assert.deepEqual(current.responses[0]?.importantPaths, ["README.md", "Dockerfile"]);
  assert.equal(current.responses[0]?.root, undefined);
  assert.ok(current.events.includes("stored-list"));
});
test("actual remote repository list keeps root redacted", async () => {
  const current = fixture({ repository: "remote" });
  await current.run();
  assert.equal(current.responses[0]?.root, undefined);
  assert.deepEqual(current.responses[0]?.importantPaths, ["README.md", "Dockerfile"]);
  assert.ok(current.events.includes("inspect:list"));
});
test("actual read denial produces no new loading or projection", async () => {
  const current = fixture({ denied: true });
  await current.run();
  assert.deepEqual(current.events, []);
  assert.deepEqual(current.responses, []);
});
test("actual stale read after load blocks the whole response and releases admission", async () => {
  const current = fixture({ staleAfter: 1 });
  await assert.rejects(current.run(), /stale-read/);
  assert.deepEqual(current.responses, []);
  assert.deepEqual(current.events, ["retain", "load", "release"]);
});
test("actual stale read after repository inspection blocks projection and releases admission", async () => {
  const current = fixture({ repository: "stored", staleAfter: 2 });
  await assert.rejects(current.run(), /stale-read/);
  assert.deepEqual(current.responses, []);
  assert.deepEqual(current.events, ["retain", "load", "stored-list", "release"]);
});
test("actual get handler keeps established result with no importantPaths field", async () => {
  const current = fixture();
  await current.run("get");
  assert.equal(Object.hasOwn(current.responses[0]!, "importantPaths"), false);
  assert.deepEqual(current.responses[0]?.file, { path: "README.md", content: "text" });
});
test("empty listing is explicit empty metadata without root lookup", async () => {
  const current = fixture({ result: { files: [] } });
  await current.run();
  assert.deepEqual(current.responses[0]?.importantPaths, []);
});
test("response schema makes the new metadata optional", () => {
  const schema = readFileSync(new URL("../../packages/gateway-protocol/src/schema/sessions.ts", import.meta.url), "utf8");
  assert.match(schema, /importantPaths: Type\.Optional\(Type\.Array\(Type\.String\(\)\)\)/);
});
