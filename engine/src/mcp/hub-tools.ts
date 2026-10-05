import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerBoardTools } from "./hub-board-tools.js";
import { list, rec, str, who, type Rec, type Who } from "./hub-shared.js";
import { ok, type TrunkGateway, type TrunkToolsOptions } from "./trunk-tools.js";

/**
 * Graft hub tools: everyone improving Branch (Claude Code, Codex, Hermes, builder Trunks) shares one set of
 * documents, memory, board cards and an activity feed inside the owner's Branch. They compose gateway methods
 * the engine already has, so they work against a running release without an engine change:
 * - a project is a Trunk's workspace (projects.list shows each as `workspace:<id>`); its Library documents are
 *   `Documents/<name>` (agents.documents.create, agents.workspace.list/get, sessions.files.set to overwrite);
 * - versions: before an overwrite the previous text is kept as the hidden document `.<name>.v<N>.md`
 *   (the Library hides dot files); the first line of every write is an attribution comment;
 * - memory is the project Trunk's MEMORY.md (agents.files.get/set with expectedHash) and memory.search;
 * - board cards are Canopy cards (canopy.cards.*), the claim owner and comments carry the agent's name.
 */

/** The Library preview reads at most 256 KiB; leave room for the attribution line. */
export const DOC_MAX_BYTES = 240 * 1024;
export const DEFAULT_PROJECT = "branch-project";
const HEADER = /^<!-- branch-doc (\{.*?\}) -->\r?\n?/;

export type DocHeader = { v: number; by: string; at: string; note?: string };

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Split a stored document into its attribution header and the text the author wrote. */
export function parseDoc(stored: string): { header?: DocHeader; body: string } {
  const match = HEADER.exec(stored);
  if (!match) {
    return { body: stored };
  }
  try {
    return {
      header: JSON.parse(match[1]!) as DocHeader,
      body: stored.slice(match[0].length),
    };
  } catch {
    return { body: stored };
  }
}

export function formatDoc(body: string, header: DocHeader): string {
  return `<!-- branch-doc ${JSON.stringify(header)} -->\n${parseDoc(body).body}`;
}

export function versionName(name: string, version: number): string {
  return `.${name.replace(/\.md$/i, "")}.v${version}.md`;
}

export function docName(name: string): string {
  const trimmed = name.trim();
  const control = [...trimmed].some((c) => c.charCodeAt(0) < 32);
  if (!trimmed || control || /[<>:"/\\|?*]/.test(trimmed) || trimmed.startsWith(".")) {
    throw new Error("A document name is a plain file name such as NOTES.md (no folders).");
  }
  return /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}

/** The project's Trunk: the one named, else the "branch-project" Trunk ("Branch project"). */
export async function resolveProject(gw: TrunkGateway, project?: string): Promise<string> {
  if (project) {
    return project;
  }
  const agents = rec(await gw.request("agents.list", {}));
  if (list(agents.agents).some((a) => a.id === DEFAULT_PROJECT)) {
    return DEFAULT_PROJECT;
  }
  // Never fall back to another Trunk's workspace: a Trunk's own Library is not a shared project.
  throw new Error(
    `This Branch has no "${DEFAULT_PROJECT}" Trunk yet; pass project with the id of the Trunk that holds the project.`,
  );
}

async function readStored(gw: TrunkGateway, agentId: string, name: string) {
  const result = rec(
    await gw.request("agents.workspace.get", { agentId, path: `Documents/${name}` }).catch((e) => {
      if (/not found/i.test(String(e))) {
        return { missing: true };
      }
      throw e;
    }),
  );
  if (result.missing) {
    return undefined;
  }
  const file = rec(result.file);
  const content = str(file.content) ?? str(result.content) ?? "";
  return { content, hash: sha256(content) };
}

/** Overwrite an existing Library document through the Trunk's main thread, which roots in its workspace. */
async function overwrite(
  gw: TrunkGateway,
  agentId: string,
  name: string,
  content: string,
  hash: string,
) {
  const sessionKey = `agent:${agentId}:main`;
  const params = {
    sessionKey,
    agentId,
    path: `Documents/${name}`,
    content,
    expectedHash: hash,
  };
  try {
    await gw.request("sessions.files.set", params);
  } catch (error) {
    if (!/not.found/i.test(String(error))) {
      throw error;
    }
    await gw.request("sessions.create", { key: sessionKey, agentId }).catch(() => undefined);
    await gw.request("sessions.files.set", params);
  }
}

/**
 * Keep the previous version first. Exclusive create catches two writers racing for one version; a kept version
 * with the same text is a retry after an overwrite that failed, so it goes on.
 */
async function keepVersion(gw: TrunkGateway, agentId: string, name: string, content: string) {
  try {
    await gw.request("agents.documents.create", { agentId, name, content });
  } catch (error) {
    if (!/already exists/i.test(String(error))) {
      throw error;
    }
    const kept = await readStored(gw, agentId, name);
    if (kept?.content !== content) {
      throw new Error(`Someone else saved ${name} at the same time; read the document again.`, {
        cause: error,
      });
    }
  }
}

export async function writeDoc(
  gw: TrunkGateway,
  input: {
    agentId: string;
    name: string;
    content: string;
    author: Who;
    note?: string;
    expectedHash?: string;
  },
  now: () => number = Date.now,
) {
  const { agentId, name, author } = input;
  if (Buffer.byteLength(input.content, "utf8") > DOC_MAX_BYTES) {
    throw new Error(
      `${name} is over ${DOC_MAX_BYTES / 1024} KiB; split it into parts (NAME part 1.md, ...).`,
    );
  }
  const current = await readStored(gw, agentId, name);
  if (current && input.expectedHash && current.hash !== input.expectedHash) {
    throw new Error(
      `${name} changed since you read it (hash ${current.hash}); read it again first.`,
    );
  }
  const previous = current ? (parseDoc(current.content).header?.v ?? 1) : 0;
  const header: DocHeader = {
    v: previous + 1,
    by: `${author.name} (${author.id})`,
    at: new Date(now()).toISOString(),
    ...(input.note ? { note: input.note } : {}),
  };
  const stored = formatDoc(input.content, header);
  if (!current) {
    await gw.request("agents.documents.create", {
      agentId,
      name,
      content: stored,
    });
  } else {
    await keepVersion(gw, agentId, versionName(name, previous), current.content);
    await overwrite(gw, agentId, name, stored, current.hash);
  }
  return {
    name,
    version: header.v,
    hash: sha256(stored),
    by: header.by,
    created: !current,
  };
}

async function listDocs(gw: TrunkGateway, agentId: string) {
  const result = rec(
    await gw
      .request("agents.workspace.list", {
        agentId,
        path: "Documents",
        limit: 500,
      })
      .catch((e) => {
        if (/not found/i.test(String(e))) {
          return {};
        }
        throw e;
      }),
  );
  const entries = list(result.entries).filter((e) => e.kind === "file");
  const hidden = entries.map((e) => String(e.name)).filter((n) => n.startsWith("."));
  return entries
    .filter((e) => !String(e.name).startsWith("."))
    .map((e) => {
      const name = String(e.name);
      const base = `.${name.replace(/\.md$/i, "")}.v`;
      return {
        name,
        size: e.size,
        updated_at: e.updatedAtMs,
        versions: hidden.filter((n) => n.startsWith(base)).length + 1,
      };
    });
}

export function searchText(name: string, text: string, terms: string[], max = 5) {
  const lines = text.split(/\r?\n/);
  const hits: { line: number; text: string }[] = [];
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    if (hits.length < max && terms.every((t) => lower.includes(t))) {
      hits.push({ line: index + 1, text: line.trim().slice(0, 240) });
    }
  });
  return hits.length ? { name, hits } : undefined;
}

export function registerHubMcpTools(
  server: McpServer,
  gw: TrunkGateway,
  opts: TrunkToolsOptions,
): void {
  registerDocTools(server, gw, opts);
  registerMemoryTools(server, gw, opts);
  registerBoardTools(server, gw, opts);
  registerActivityTool(server, gw);
}

const projectArg = z
  .string()
  .optional()
  .describe(
    'The project: a Trunk id whose workspace holds it. Default: the "branch-project" Trunk ("Branch project").',
  );

function registerDocTools(server: McpServer, gw: TrunkGateway, opts: TrunkToolsOptions): void {
  server.tool(
    "docs_list",
    "List a project's Library documents (markdown) with size, last change and how many versions each has.",
    { project: projectArg },
    async ({ project }) => {
      const agentId = await resolveProject(gw, project);
      const docs = await listDocs(gw, agentId);
      return ok(`${docs.length} documents in ${agentId}`, {
        project: agentId,
        docs,
      });
    },
  );

  server.tool(
    "docs_read",
    "Read a Library document (or an older version). Returns its text, version, who wrote that version and its hash (pass the hash to docs_write to avoid overwriting someone else's change).",
    {
      name: z.string().min(1),
      project: projectArg,
      version: z.number().int().min(1).optional(),
    },
    async ({ name, project, version }) => {
      const agentId = await resolveProject(gw, project);
      const file = docName(name);
      const latest = await readStored(gw, agentId, file);
      if (!latest) {
        throw new Error(`No document ${file} in ${agentId}.`);
      }
      const latestVersion = parseDoc(latest.content).header?.v ?? 1;
      const wanted =
        version && version !== latestVersion
          ? await readStored(gw, agentId, versionName(file, version))
          : latest;
      if (!wanted) {
        throw new Error(`${file} has no version ${version} (latest is ${latestVersion}).`);
      }
      const { header, body } = parseDoc(wanted.content);
      return ok(`${file} v${header?.v ?? version ?? 1}`, {
        name: file,
        version: header?.v ?? version ?? 1,
        latest_version: latestVersion,
        by: header?.by ?? null,
        at: header?.at ?? null,
        hash: latest.hash,
        text: body,
      });
    },
  );

  server.tool(
    "docs_write",
    "Create or update a project Library document (markdown, up to 240 KiB). Each write is a new version attributed to this agent; the previous version is kept.",
    {
      name: z.string().min(1),
      text: z.string(),
      project: projectArg,
      expected_hash: z.string().optional(),
      note: z.string().max(200).optional(),
    },
    async ({ name, text, project, expected_hash, note }) => {
      const agentId = await resolveProject(gw, project);
      const author = await who(opts);
      opts.activity?.(`Writing ${name} in ${agentId}`);
      const result = await writeDoc(
        gw,
        {
          agentId,
          name: docName(name),
          content: text,
          author,
          ...(note ? { note } : {}),
          ...(expected_hash ? { expectedHash: expected_hash } : {}),
        },
        opts.now,
      );
      return ok(`${result.name} v${result.version}`, {
        project: agentId,
        ...result,
      });
    },
  );

  server.tool(
    "project_instructions",
    "Read the project's instructions (its Trunk's AGENTS.md), or replace them when text is given. Pass the hash you read to avoid overwriting someone else's change.",
    {
      project: projectArg,
      text: z.string().optional(),
      expected_hash: z.string().optional(),
    },
    async ({ project, text, expected_hash }) => {
      const agentId = await resolveProject(gw, project);
      const file = rec(
        rec(await gw.request("agents.files.get", { agentId, name: "AGENTS.md" })).file,
      );
      const current = file.missing === false ? (str(file.content) ?? "") : undefined;
      if (text === undefined) {
        return ok("instructions", {
          project: agentId,
          text: current ?? "",
          hash: current === undefined ? null : sha256(current),
        });
      }
      const hash = expected_hash ?? (current === undefined ? undefined : sha256(current));
      opts.activity?.(`Writing ${agentId}'s instructions`);
      await gw.request("agents.files.set", {
        agentId,
        name: "AGENTS.md",
        content: text,
        ...(hash ? { expectedHash: hash } : { expectedMissing: true }),
      });
      return ok("instructions saved", {
        project: agentId,
        hash: sha256(text),
        by: (await who(opts)).name,
      });
    },
  );

  server.tool(
    "docs_search",
    "Search a project's Library documents for words (every word must appear on the line). Returns matching lines per document.",
    { query: z.string().min(1), project: projectArg },
    async ({ query, project }) => {
      const agentId = await resolveProject(gw, project);
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const docs = (await listDocs(gw, agentId)).slice(0, 100);
      const results = [];
      for (const doc of docs) {
        const stored = await readStored(gw, agentId, doc.name).catch(() => undefined);
        const found = stored && searchText(doc.name, parseDoc(stored.content).body, terms);
        if (found) {
          results.push(found);
        }
      }
      return ok(`${results.length} documents match`, {
        project: agentId,
        results,
      });
    },
  );
}

/** One memory line: date, who and what, the way MEMORY.md entries read. */
export function memoryLine(text: string, author: Who, at: number): string {
  const day = new Date(at).toISOString().slice(0, 10);
  return `- ${day} (${author.name}): ${text.replace(/\s+/g, " ").trim()}`;
}

function registerMemoryTools(server: McpServer, gw: TrunkGateway, opts: TrunkToolsOptions): void {
  server.tool(
    "memory_search",
    "Search a Trunk's memory (a project Trunk's memory is the project's shared memory).",
    {
      query: z.string().min(1),
      project: projectArg,
      limit: z.number().int().min(1).max(50).optional(),
    },
    async ({ query, project, limit }) => {
      const agentId = await resolveProject(gw, project);
      const result = rec(
        await gw.request("memory.search", {
          agentId,
          query,
          maxResults: limit ?? 10,
        }),
      );
      const hits = list(result.results ?? result.hits).map((hit) => ({
        path: hit.path ?? hit.file,
        score: hit.score,
        text: str(hit.snippet) ?? str(hit.text) ?? "",
        line: hit.startLine ?? null,
      }));
      return ok(`${hits.length} memories`, { project: agentId, hits });
    },
  );

  server.tool(
    "memory_write",
    "Add a memory to a Trunk's MEMORY.md (the project's shared memory for a project Trunk), attributed to this agent.",
    { text: z.string().min(1).max(2000), project: projectArg },
    async ({ text, project }) => {
      const agentId = await resolveProject(gw, project);
      const line = memoryLine(text, await who(opts), (opts.now ?? Date.now)());
      opts.activity?.(`Remembering in ${agentId}`);
      await appendMemory(gw, agentId, line);
      return ok("remembered", { project: agentId, line });
    },
  );
}

async function appendMemory(gw: TrunkGateway, agentId: string, line: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const file = rec(
      rec(await gw.request("agents.files.get", { agentId, name: "MEMORY.md" }).catch(() => ({})))
        .file,
    );
    const current = file.missing === false ? (str(file.content) ?? "") : undefined;
    const next =
      current === undefined ? `# Memory\n\n${line}\n` : `${current.replace(/\s*$/, "")}\n${line}\n`;
    try {
      await gw.request("agents.files.set", {
        agentId,
        name: "MEMORY.md",
        content: next,
        ...(current === undefined
          ? { expectedMissing: true }
          : { expectedHash: str(file.hash) ?? sha256(current) }),
      });
      return;
    } catch (error) {
      if (!/conflict|changed|exists/i.test(String(error)) || attempt === 2) {
        throw error;
      }
    }
  }
}

function registerActivityTool(server: McpServer, gw: TrunkGateway): void {
  server.tool(
    "activity_feed",
    'What every Trunk and grafted agent is doing now and did recently, as "X is working on Y" lines with run ids.',
    { recent: z.number().int().min(0).max(20).optional() },
    async ({ recent }) => {
      const feed = await activityFeed(gw, recent ?? 3, Date.now());
      return ok(feed.lines.join("\n") || "Nothing is happening.", feed);
    },
  );
}

function ago(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function threadTitle(row: Rec): string {
  return (
    str(row.label) ??
    str(row.displayName) ??
    str(row.derivedTitle) ??
    str(row.title) ??
    (String(row.key).endsWith(":main") ? "the main chat" : String(row.key))
  );
}

/** The run a working thread is on: chat.history carries it (also one resumed after a restart); sessions.list doesn't. */
async function runInFlight(gw: TrunkGateway, row: Rec): Promise<string | undefined> {
  const key = str(row.key);
  const history = key
    ? rec(await gw.request("chat.history", { sessionKey: key, limit: 1 }).catch(() => ({})))
    : {};
  return str(rec(history.inFlightRun).runId) ?? str(row.activeWriterRunId);
}

/** Lines for the feed: working Trunks first (with run ids), then grafted agents, then recent finished threads. */
export async function activityFeed(gw: TrunkGateway, recent: number, now: number) {
  const agents = list(rec(await gw.request("agents.list", {})).agents);
  const working: Rec[] = [];
  const lately: { at: number; line: string }[] = [];
  await Promise.all(
    agents.map(async (agent) => {
      const id = String(agent.id);
      const name = str(rec(agent.identity).name) ?? str(agent.name) ?? id;
      const rows = list(
        rec(await gw.request("sessions.list", { agentId: id, limit: 20 }).catch(() => ({})))
          .sessions,
      );
      for (const row of rows) {
        const summary = str(rec(row.activitySummary).text);
        if (row.hasActiveRun === true || row.status === "running") {
          const run = await runInFlight(gw, row);
          working.push({
            who: name,
            trunk: id,
            thread: row.key,
            title: threadTitle(row),
            run_id: run ?? null,
            line: `${name} is working on ${threadTitle(row)}${run ? ` (run ${run})` : ""}${summary ? ` - ${summary}` : ""}`,
          });
        } else if (typeof row.updatedAt === "number") {
          lately.push({
            at: row.updatedAt,
            line: `${name} ${row.status === "failed" ? "stopped" : "worked"} on ${threadTitle(row)} ${ago(now - row.updatedAt)}`,
          });
        }
      }
    }),
  );
  const outside = list(rec(await gw.request("contacts.outside.list", {}).catch(() => ({}))).agents)
    .filter((a) => a.online)
    .map(
      (a) =>
        `${String(a.name)} (grafted${str(a.where) ? `, ${String(a.where)}` : ""}) ${str(a.activity) ? `is ${lowerFirst(String(a.activity))}` : "is connected"}`,
    )
    // One line per agent and activity, however many processes it runs.
    .filter((line, i, all) => all.indexOf(line) === i);
  const recentLines = lately
    .toSorted((a, b) => b.at - a.at)
    .slice(0, recent * Math.max(1, agents.length))
    .map((r) => r.line);
  return {
    lines: [...working.map((w) => String(w.line)), ...outside, ...recentLines.slice(0, 20)],
    working,
    grafted: outside,
    recent: recentLines,
  };
}

function lowerFirst(text: string): string {
  return text ? text[0]!.toLowerCase() + text.slice(1) : text;
}
