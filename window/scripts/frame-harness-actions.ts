// Stateful responses for the frame crawl's create/save flows. This is never shipped.
import { BUILTIN, toPalette } from "../src/places/settings/set1/appearance-look";

type Params = Record<string, any>;
export function createFrameActions() {
  const files = new Map<string, { name: string; content: string; hash: string; missing: boolean }>();
  const prefs: Params = {};
  const themes = new Map<string, Params>(Object.entries(BUILTIN).map(([id, pair]) => [id, {
    id, name: id, source: "builtin", modes: ["light", "dark"],
    definition: { name: id, light: toPalette(pair.light), dark: toPalette(pair.dark) },
  }]));
  const sessions: Params[] = [];
  let revision = 0;
  let current = "grove";
  return { sessions, request(method: string, p: Params = {}): unknown {
    if (method === "sessions.create") {
      const key = `agent:${p.agentId}:fixture-${++revision}`;
      sessions.push({ key, agentId: p.agentId, label: p.label, kind: "direct", updatedAt: Date.now() });
      return { ok: true, key };
    }
    if (method === "session.members.add") return { ok: true };
    if (method === "agents.files.list") return { files: [...files.values()] };
    if (method === "agents.files.get") return { file: files.get(`${p.agentId}/${p.name}`) ?? { name: p.name, missing: true } };
    if (method === "agents.files.set") {
      const old = files.get(`${p.agentId}/${p.name}`);
      if ((p.expectedMissing && old) || (p.expectedHash && p.expectedHash !== old?.hash)) throw new Error("File changed since it was read");
      const file = { name: p.name, content: p.content, hash: `fixture-${++revision}`, missing: false };
      files.set(`${p.agentId}/${p.name}`, file);
      return { ok: true, file };
    }
    if (method === "users.prefs.get") return { status: "ok", entries: { ...prefs } };
    if (method === "users.prefs.set") { Object.assign(prefs, p.entries); return { status: "ok" }; }
    if (method === "themes.list") return { themes: [...themes.values()], current: { id: current, mode: "system", scope: "profile", overrides: {} } };
    if (method === "themes.get") return themes.get(p.id);
    if (method === "themes.import") {
      const id = `user/${p.id}`;
      themes.set(id, { id, name: p.definition.name, definition: p.definition, source: "user", modes: ["light", "dark"] });
      if (p.apply) current = id;
      return { status: "ok", id };
    }
    if (method === "themes.set") { current = p.id; return { status: "ok" }; }
    return undefined;
  } };
}
