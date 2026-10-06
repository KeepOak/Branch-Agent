import { useEffect, useMemo, useRef, useState } from "react";
import type { PlaceProps } from "../../places-nav/PlaceFrame";
import { a2aVisit, officeRoster, type OfficeAgent, type OfficeLink } from "./model";
import "./office.css";

type Layout = Record<string, unknown> | null;
type Office = { update: (agents: OfficeAgent[], links: OfficeLink[]) => void; importLayout: (layout: Layout) => void; setReducedMotion: (value: boolean | "auto") => void; destroy: () => void };
type OfficeModule = { mountPixelOffice: (el: HTMLElement, options: Record<string, unknown>) => Office };
const META = "ui.pixelOffice.layout.meta";
const part = (n: number) => `ui.pixelOffice.layout.${n}`;
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown): string => typeof v === "string" ? v : "";

function readyCanvas(host: HTMLElement): Promise<void> {
  if (host.shadowRoot?.querySelector("canvas")) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const root = host.shadowRoot;
    if (!root) { reject(new Error("The office stage didn't open.")); return; }
    const watch = new MutationObserver(() => {
      if (root.querySelector("canvas")) { watch.disconnect(); resolve(); }
      else if (root.textContent?.includes("could not start")) { watch.disconnect(); reject(new Error("The office couldn't start.")); }
    });
    watch.observe(root, { childList: true, subtree: true });
  });
}

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

export async function readLayout(engine: PlaceProps["engine"]): Promise<{ layout: Layout; count: number } | null> {
  const meta = obj(await engine.request("users.prefs.get", { keys: [META] }));
  if (meta.status !== "ok") return null;
  const count = Number(obj(obj(meta.entries)[META]).parts) || 0;
  if (!count || count > 31) return { layout: null, count: 0 };
  const reply = obj(await engine.request("users.prefs.get", { keys: Array.from({ length: count }, (_, n) => part(n)) }));
  if (reply.status !== "ok") return null;
  const value = Array.from({ length: count }, (_, n) => str(obj(reply.entries)[part(n)])).join("");
  try { return { layout: value ? await decode(value) : null, count }; }
  catch { return { layout: null, count }; }
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
  const [data, setData] = useState<{ agents: unknown; sessions: unknown; contacts: unknown; outside: unknown } | null>(null);
  const [error, setError] = useState("");
  const [layoutError, setLayoutError] = useState("");
  const [retry, setRetry] = useState(0);
  const [links, setLinks] = useState<OfficeLink[]>([]);
  const roster = useMemo(() => data ? officeRoster(data.agents, data.sessions, data.contacts, data.outside) : null, [data]);
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  const createTrunkRef = useRef(createTrunk);
  createTrunkRef.current = createTrunk;

  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const [agents, sessions, contacts, outside] = await Promise.all([
          engine.request("agents.list", {}),
          engine.request("sessions.list", { includeGlobal: true, includeUnknown: true, configuredAgentsOnly: true, archived: "all" }),
          engine.request("contacts.list", { includeArchived: true }),
          engine.request("contacts.outside.list", {}).catch(() => ({})),
        ]);
        if (live) { setData({ agents, sessions, contacts, outside }); setError(""); }
      } catch (e) { if (live) setError(e instanceof Error ? e.message : String(e)); }
    };
    void refresh();
    const off = engine.onEvent(({ event, payload }) => {
      if (["agents.changed", "contacts.changed", "sessions.changed"].includes(event) || event === "chat" && ["final", "error", "aborted"].includes(str(obj(payload).state))) void refresh();
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
    let hydrating = true;
    let writes = Promise.resolve();
    const motion = () => office.current?.setReducedMotion(document.documentElement.hasAttribute("data-still") ? true : "auto");
    const motionObserver = new MutationObserver(motion);
    motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-still"] });
    void (async () => {
      try {
        const saved = await readLayout(engine);
        if (!live) return;
        count.current = saved?.count ?? 0;
        const officeUrl = "/pixel-office.js";
        const module = await import(/* @vite-ignore */ officeUrl) as OfficeModule;
        if (!live || !host.current) return;
        const current = rosterRef.current;
        office.current = module.mountPixelOffice(host.current, {
          agents: current?.agents ?? [], links, theme: "auto", reducedMotion: document.documentElement.hasAttribute("data-still") ? true : "auto", storageKey: "branch-pixel-office",
          onOpen: (id: string) => { const key = rosterRef.current?.openKey.get(id); if (key) openConversation(key); },
          onNewAgent: () => createTrunkRef.current?.(),
          onLayoutChange: (layout: Layout) => {
            if (hydrating || saved === null) return;
            writes = writes.then(() => writeLayout(engine, layout, count.current).then(n => { count.current = n; setLayoutError(""); }))
              .catch(e => setLayoutError(e instanceof Error ? e.message : String(e)));
          },
        });
        if (saved?.layout) {
          await readyCanvas(host.current);
          if (!live || !office.current) return;
          office.current.importLayout(saved.layout);
        }
        hydrating = false;
      } catch (e) { if (live) setError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { live = false; motionObserver.disconnect(); office.current?.destroy(); office.current = null; };
  }, [data !== null, engine, openConversation, retry]);

  return <section className="pixel-office-view" aria-label="Grove" data-testid="pixel-office">
    <header className="pixel-office-head"><b>Grove</b><span>Your Trunks at their desks. Click one to open its chat; drag one to another desk.</span></header>
    {error ? <p role="alert">The office didn’t load. {error} <button type="button" onClick={() => setRetry(n => n + 1)}>Try again</button></p> : null}
    {layoutError ? <p role="alert">{layoutError}</p> : null}
    {!data && !error ? <p role="status">Opening the office…</p> : null}
    <div className="pixel-office-stage" ref={host} />
  </section>;
}
