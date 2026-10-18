// Settings › Memory & documents: the controls the R1 page draws itself (slots.ts controls), each reusing Classic
// Advanced's logic on the same calls (places/settings/set2/advanced.tsx, advanced-tech.tsx): checking meaning search
// (doctor.memory.status), also searching past conversations (memory.search.sources), last night's tidy-up (History &
// backups), bringing in other coding agents' memory (migrations.memory.plan / apply) and rewriting notes (Library). The
// memory engine, the plugin switches, the folder list and Every memory setting are Customize's (customize-live.tsx).
import { useState } from "react";
import { Coming } from "../../../glass/coming";
import { record, text, visible, type RecordValue } from "../../../places/settings/adapter";
import { useResource } from "../../../places/settings/hooks";
import { KitProvider } from "../../../places/settings/kit";
import { MigrateDialog } from "../../../places/settings/set2/advanced-tech";
import { openPlace } from "../../../places/settings/set2/common";
import { Toggle } from "../RowView";
import type { PageSlot, SlotControlProps } from "../slots";
import { Failed, Needs, useFailure } from "./appearance-live";
import { editSection, listControl, MemoryEngine, pluginSwitch, useConfigSnap } from "./customize-live";

const QUIET = { saving: () => undefined, saved: () => undefined, failed: () => undefined };
const PROVIDER: Record<string, string> = { openai: "OpenAI", gemini: "Gemini", voyage: "Voyage", mistral: "Mistral", bedrock: "Amazon Bedrock", deepinfra: "DeepInfra",
  "github-copilot": "GitHub Copilot", lmstudio: "LM Studio", ollama: "Ollama", local: "On this computer", "openai-compatible": "An OpenAI-compatible address" };
const LOCAL = new Set(["lmstudio", "ollama", "local"]);

/** Meaning search: whether it answered when last checked, the service and where it runs, and Test (a probe). */
export function MeaningSearch({ engine }: SlotControlProps) {
  const { get } = useConfigSnap(engine);
  const st = useResource<RecordValue>(engine, "doctor.memory.status", {});
  const [probe, setProbe] = useState<RecordValue | null>(null);
  const [failed, run] = useFailure();
  const data = probe ?? record(st.data);
  const emb = record(data.embedding);
  const provider = text(data.provider) || text(get("memory.search.provider")) || "local";
  const checked = emb.checked !== false && (emb.ok === true || Boolean(emb.error));
  const word = !checked ? "Not checked yet" : emb.ok === true ? "Working" : "Not working";
  const line = st.error ? visible(st.error) : !checked ? "Branch hasn’t checked meaning search yet." : emb.ok === true ? "Meaning search answered." : visible(text(emb.error));
  return <>
    <span className="r1s-own-ctl">
      <span className="r1s-val g-label">{word}</span>
      <Needs engine={engine} need={["doctor.memory.status"]} where="Test meaning search">
        <button type="button" className="r1s-btn" onClick={() => void run(async () => setProbe(record(await engine.request("doctor.memory.status", { probe: true }))))}>Test</button>
      </Needs>
    </span>
    <small className="r1s-msg g-label" data-lines>{line} {PROVIDER[provider] ?? provider} · {LOCAL.has(provider) ? "on this computer" : "in the cloud"}</small>
    <Failed text={failed} />
  </>;
}

/** Also search past conversations: "sessions" in memory.search.sources (memory alone when nothing is saved). */
export function SearchSessions({ engine, row }: SlotControlProps) {
  const { store, snap, get } = useConfigSnap(engine);
  const [failed, run] = useFailure();
  const saved = get("memory.search.sources");
  const sources = Array.isArray(saved) ? saved.map(String) : ["memory"];
  const label = row.label ?? "Also search past conversations";
  const set = (on: boolean) => { const base = sources.filter((s) => s !== "sessions"); void run(() => store.set("memory.search.sources", on ? [...base, "sessions"] : base)); };
  return <>
    <Needs engine={engine} need={["config.patch"]} where={label}>
      <span className="r1s-own-ctl"><Toggle label={label} on={sources.includes("sessions")} disabled={!snap} onChange={set} /></span>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** Tidy by meaning each night: Last night opens History & backups, where each night's merges are listed. */
export function LastNight({ onPage }: SlotControlProps) {
  return <button type="button" className="r1s-btn" data-local="" disabled={!onPage} onClick={() => onPage?.("history")}>Last night</button>;
}

/** Learn from other coding agents' history: the engine copies their memory in once (it can't read it as you go), so the
 *  switch is Coming and Bring their memory in… is Classic's window on migrations.memory.plan / apply. */
export function OtherAgents({ engine, row }: SlotControlProps) {
  const [open, setOpen] = useState(false);
  const trunks = useResource<RecordValue>(engine, "agents.list", {});
  const agent = text(record(trunks.data).defaultId);
  const label = row.label ?? "Learn from other coding agents’ history on this computer";
  return <>
    <span className="r1s-own-ctl">
      <Coming engine={engine} need="config: reading other coding agents' history as you go" unwired reason="The engine copies their memory in once instead of reading it as you go." where={label}>
        <span className="r1s-own-ctl"><Toggle label={label} on={false} onChange={() => undefined} /></span>
      </Coming>
      <Needs engine={engine} need={["migrations.memory.plan", "migrations.memory.apply"]} where="Bring their memory in">
        <button type="button" className="r1s-btn" disabled={!agent} onClick={() => setOpen(true)}>Bring their memory in…</button>
      </Needs>
    </span>
    {open ? <KitProvider level={2} report={QUIET} scope={null}><MigrateDialog engine={engine} agent={agent} onClose={() => setOpen(false)} /></KitProvider> : null}
  </>;
}

/** Rewrite short notes: Try it opens the Library, where notes are rewritten. */
export function RewriteNotes(_props: SlotControlProps) {
  return <button type="button" className="r1s-btn" data-local="" onClick={() => openPlace("library")}>Try it</button>;
}

/** The Memory & documents page's own controls (plugged.ts). */
export const MEMORY_PAGE: PageSlot = {
  controls: {
    "memory.memory.meaning-check": MeaningSearch,
    "memory.memory.engine": MemoryEngine,
    "memory.memory.recall": pluginSwitch("active-memory"),
    "memory.memory.wiki": pluginSwitch("memory-wiki"),
    "memory.memory.tidy": LastNight,
    "memory.memory.sessions": SearchSessions,
    "memory.memory.extra-paths": listControl("memory.search.extraPaths", "D:\\Notes", "Add a folder"),
    "memory.memory.every": editSection("memory", "Every memory setting"),
    "memory.recall.other-agents": OtherAgents,
    "memory.library.rewrite": RewriteNotes,
  },
};
