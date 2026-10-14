import { useEffect, useMemo, useRef, useState } from "react";
import type { PlaceProps } from "../../places-nav/PlaceFrame";
import { a2aVisit, officeRoster, officeToolEvent, type OfficeLink, type OfficeTools } from "./model";
import type { OfficeStore } from "./pixel/webview-ui/src/branch/storage";
import "./office.css";

type Layout = Record<string, unknown> | null;
type Office = import("./pixel/webview-ui/src/branch/types").PixelOfficeHandle;
type OfficeModule = typeof import("./pixel/webview-ui/src/branch/mount");
const META = "ui.pixelOffice.layout.meta";
const STORE_KEYS = { seats: "ui.pixelOffice.seats", looks: "ui.pixelOffice.looks", prefs: "ui.pixelOffice.prefs" } as const;
const part = (n: number) => `ui.pixelOffice.layout.${n}`;
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown): string => typeof v === "string" ? v : "";

async function encode(layout: Layout): Promise<string> {
  const source = new TextEncoder().encode(JSON.stringify(layout));
  const stream = new CompressionStream("gzip");
  const output = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  await writer.write(source); await writer.close();
  const bytes = new Uint8Array(await output);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function decode(value: string): Promise<Layout> {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const stream = new DecompressionStream("gzip");
  const output = new Response(stream.readable).text();
  const writer = stream.writable.getWriter();
  await writer.write(bytes); await writer.close();
  return JSON.parse(await output) as Layout;
}

export async function readLayout(engine: PlaceProps["engine"]): Promise<{ layout: Layout; count: number }> {
  const meta = obj(await engine.request("users.prefs.get", { keys: [META] }));
  if (meta.status !== "ok") throw new Error("The engine couldn't load the office layout.");
  const count = Number(obj(obj(meta.entries)[META]).parts) || 0;
  if (!count || count > 31) return { layout: null, count: 0 };
  const reply = obj(await engine.request("users.prefs.get", { keys: Array.from({ length: count }, (_, n) => part(n)) }));
  if (reply.status !== "ok") throw new Error("The engine couldn't load the office layout.");
  const value = Array.from({ length: count }, (_, n) => str(obj(reply.entries)[part(n)])).join("");
  try { return { layout: value ? await decode(value) : null, count }; }
  catch { return { layout: null, count }; }
}
export async function readOfficeStore(engine: PlaceProps["engine"]): Promise<{ store: OfficeStore; count: number }> {
  const [saved, reply] = await Promise.all([readLayout(engine), engine.request("users.prefs.get", { keys: Object.values(STORE_KEYS) })]);
  const result = obj(reply);
  if (result.status !== "ok") throw new Error("The engine couldn't load the office preferences.");
  const entries = obj(result.entries);
  return { count: saved.count, store: {
    layout: saved.layout as OfficeStore["layout"],
    seats: obj(entries[STORE_KEYS.seats]) as OfficeStore["seats"],
    looks: obj(entries[STORE_KEYS.looks]) as OfficeStore["looks"],
    prefs: obj(entries[STORE_KEYS.prefs]) as unknown as OfficeStore["prefs"],
  } };
}
export async function writeOfficeSetting(engine: PlaceProps["engine"], key: keyof typeof STORE_KEYS, value: unknown): Promise<void> {
  const reply = obj(await engine.request("users.prefs.set", { entries: { [STORE_KEYS[key]]: value } }));
  if (reply.status !== "ok") throw new Error(`The engine couldn't save office ${key}.`);
}
export async function writeLayout(engine: PlaceProps["engine"], layout: Layout, oldCount: number): Promise<number> {
  const value = await encode(layout);
  const parts = value.match(/.{1,3000}/g) ?? [];
  if (parts.length > 31) throw new Error("The office layout is too large to save to your profile.");
  const entries: Record<string, unknown> = { [META]: { parts: parts.length } };
  parts.forEach((chunk, n) => { entries[part(n)] = chunk; });
  for (let n = parts.length; n < oldCount; n++) entries[part(n)] = null;
  const reply = obj(await engine.request("users.prefs.set", { entries }));
  if (reply.status !== "ok") throw new Error("The engine couldn't save the office layout.");
  return parts.length;
}

export function OfficePlace({ engine, openConversation, createTrunk }: PlaceProps) {
  const host = useRef<HTMLDivElement>(null);
  const office = useRef<Office | null>(null);
  const count = useRef(0);
  const [data, setData] = useState<{ agents: unknown; sessions: unknown; contacts: unknown; outside: unknown; approvals: unknown } | null>(null);
  // The pixel office is a separate chunk: the stage stays "Opening the Grove…" until it has drawn.
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState("");
  const [layoutError, setLayoutError] = useState("");
  const [retry, setRetry] = useState(0);
  const [links, setLinks] = useState<OfficeLink[]>([]);
  const [tools, setTools] = useState<OfficeTools>(() => new Map());
  const roster = useMemo(() => data ? officeRoster(data.agents, data.sessions, data.contacts, data.outside, tools, data.approvals) : null, [data, tools]);
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  const createTrunkRef = useRef(createTrunk);
  createTrunkRef.current = createTrunk;

  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const [agents, sessions, contacts, outside, approvals] = await Promise.all([
          engine.request("agents.list", {}),
          engine.request("sessions.list", { includeGlobal: true, includeUnknown: true, configuredAgentsOnly: true, archived: "all" }),
          engine.request("contacts.list", { includeArchived: true }),
          engine.request("contacts.outside.list", {}).catch(() => ({})),
          Promise.all(["exec.approval.list", "plugin.approval.list", "branch.approval.list"].map(method =>
            engine.request(method, {}).catch((error: unknown) => { console.warn(`${method} failed`, error); return { items: [] }; }),
          )),
        ]);
        if (live) { setData({ agents, sessions, contacts, outside, approvals }); setError(""); }
      } catch (e) { if (live) setError(e instanceof Error ? e.message : String(e)); }
    };
    void refresh();
    const off = engine.onEvent(({ event, payload }) => {
      if (event === "session.tool" || event === "agent") setTools(current => officeToolEvent(current, event, payload));
      if (["agents.changed", "contacts.changed", "sessions.changed", "exec.approval.requested", "exec.approval.resolved", "plugin.approval.requested", "plugin.approval.resolved", "branch.approval.requested", "branch.approval.resolved"].includes(event) || event === "chat" && ["final", "error", "aborted"].includes(str(obj(payload).state))) void refresh();
      if (event === "session.message") {
        const visit = a2aVisit(payload);
        if (visit) setLinks(current => [...current.slice(-39), visit]);
      }
    });
    return () => { live = false; off(); };
  }, [engine, retry]);

  useEffect(() => { if (roster) office.current?.update(roster.agents, links); }, [roster, links]);
  useEffect(() => {
    if (!data || !host.current || office.current) return;
    let live = true;
    let writes = Promise.resolve();
    const motion = () => office.current?.setReducedMotion(document.documentElement.hasAttribute("data-still") ? true : "auto");
    const motionObserver = new MutationObserver(motion);
    motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-still"] });
    void (async () => {
      try {
        const saved = await readOfficeStore(engine);
        if (!live) return;
        count.current = saved.count;
        const module: OfficeModule = await import("./pixel/webview-ui/src/branch/mount");
        if (!live || !host.current) return;
        const current = rosterRef.current;
        const storage = new module.Storage(saved.store, (key, value) => {
          writes = writes.then(async () => {
            if (key === "layout") count.current = await writeLayout(engine, value as Layout, count.current);
            else await writeOfficeSetting(engine, key, value);
            if (live) setLayoutError("");
          }).catch(e => { if (live) setLayoutError(e instanceof Error ? e.message : String(e)); });
        });
        office.current = module.mountPixelOffice(host.current, {
          agents: current?.agents ?? [], links, theme: "auto", reducedMotion: document.documentElement.hasAttribute("data-still") ? true : "auto", storage,
          onOpen: (id: string) => { const key = rosterRef.current?.openKey.get(id); if (key) openConversation(key); },
          onNewAgent: () => createTrunkRef.current?.(),
        });
        setMounted(true);
      } catch (e) { if (live) setError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { live = false; motionObserver.disconnect(); office.current?.destroy(); office.current = null; setMounted(false); };
  }, [data !== null, engine, openConversation, retry]);

  return <section className="pixel-office-view" aria-label="Grove" data-testid="pixel-office">
    <header className="pixel-office-head"><b>Grove</b><span>Your Trunks at their desks. Click one to open its chat; drag one to another desk.</span></header>
    {error ? <p role="alert">The office didn’t load. {error} <button type="button" onClick={() => setRetry(n => n + 1)}>Try again</button></p> : null}
    {layoutError ? <p role="alert">{layoutError}</p> : null}
    {(!data || !mounted) && !error ? <p role="status" className="pixel-office-loading">Opening the Grove…</p> : null}
    <div className="pixel-office-stage" ref={host} />
  </section>;
}
