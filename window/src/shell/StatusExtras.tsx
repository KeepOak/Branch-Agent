// The status bar's other items (DESIGN-SPEC §4.9): paused Trunks (agents.list paused), a live phone call or meeting
// (voicecall.status), the pet when Appearance puts it in the status bar, and the graphics and memory readout
// (system.info; Appearance › What's shown turns it on). Each shows only when the engine says it applies.
import { useEffect, useState, type MouseEvent } from "react";
import type { SaplingSession } from "../connect/session";
import { readLevel } from "../places-nav/SettingsFrame";
import { Icon } from "./icons";
import type { MenuItem } from "./Menu";
import { notify } from "./notify";
import { PETS, PIXEL, PixelPet } from "../places/settings/set1/appearance-pet";
import { PetReactionArt } from "./PetReaction";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type LiveCall = { id: string; state: string; startedAt: number; direction: string };
export type Vitals = { memUsed: number; memTotal: number; cpus: number; load: number[] | null; diskFree: number | null; diskTotal: number | null; upMs: number | null; node: string; pid: number | null };

/** The engine has no method that resumes a paused Trunk, so Resume stays greyed with this reason. */
export const RESUME_MISSING = "Resuming a paused Trunk isn't available yet";

const GB = 1024 ** 3;
const gb = (b: number) => (b / GB).toFixed(1).replace(/\.0$/, "");

/** Calls the engine has going now (voicecall.status with no id lists the active ones). */
function useCalls(session: SaplingSession, ready: boolean): LiveCall[] {
  const [calls, setCalls] = useState<LiveCall[]>([]);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    let off = false;
    const read = () =>
      session.request("voicecall.status", {}).then(
        (r) => live && setCalls((Array.isArray(rec(r).calls) ? (rec(r).calls as unknown[]).map(rec) : [])
          .filter((c) => !c.endedAt && str(c.state) !== "ended")
          .map((c) => ({ id: str(c.callId), state: str(c.state), startedAt: num(c.startedAt) ?? Date.now(), direction: str(c.direction) }))),
        () => {
          off = true; // the voice call plugin isn't installed or isn't set up: no call can be live
          if (live) setCalls([]);
        },
      );
    void read();
    const timer = setInterval(() => !off && void read(), 15_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [session, ready]);
  return calls;
}

/** This computer's memory and the rest of the readout (system.info), read every 10 s while it shows. */
function useVitals(session: SaplingSession, on: boolean): Vitals | null {
  const [v, setV] = useState<Vitals | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const read = () =>
      session.request("system.info", {}).then(
        (r) => {
          const x = rec(r);
          const total = num(x.memoryTotalBytes);
          const free = num(x.memoryFreeBytes);
          if (!live || total === null || free === null) return;
          setV({
            memUsed: total - free,
            memTotal: total,
            cpus: num(x.cpuCount) ?? 0,
            load: Array.isArray(x.loadAverage) ? (x.loadAverage as number[]) : null,
            diskFree: num(x.diskAvailableBytes),
            diskTotal: num(x.diskTotalBytes),
            upMs: num(x.uptimeMs),
            node: str(x.nodeVersion),
            pid: num(x.pid),
          });
        },
        () => live && setV(null),
      );
    void read();
    const timer = setInterval(read, 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [session, on]);
  return v;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const upWords = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

/** The readout's tooltip: memory always; processor, disk and uptime at Advanced; runtime and process at Technical. */
export function vitalsTip(v: Vitals | null, level: string): string {
  const parts = ["This computer’s graphics card and memory"];
  if (!v || level === "regular") return parts[0];
  if (v.load) parts.push(`load ${v.load.map((n) => n.toFixed(1)).join(" / ")} on ${v.cpus} cores`);
  if (v.diskFree !== null && v.diskTotal !== null) parts.push(`Disk ${gb(v.diskFree)} GB free of ${gb(v.diskTotal)} GB`);
  if (v.upMs !== null) parts.push(`Up ${upWords(v.upMs)}`);
  if (level === "technical") parts.push(`Runtime Node ${v.node.replace(/^v/, "")}${v.pid !== null ? ` · process ${v.pid}` : ""}`);
  return parts.join(" · ");
}

type Props = {
  session: SaplingSession;
  ready: boolean;
  /** Trunks the engine reports paused (agents.list paused). */
  paused: { id: string; name: string }[];
  allPaused: boolean;
  gfx: boolean;
  /** The pet from Appearance (look keys pet, petWhere, petName); it shows here when it walks in the status bar. */
  pet: { where: string; id: string; name: string } | null;
  onMenu: (e: MouseEvent<HTMLElement>, id: string, items: MenuItem[], label: string) => void;
  onSettings: (page: string) => void;
};

/** Items that go after "N running", on the left. */
export function StatusLeftExtras(p: Props) {
  const calls = useCalls(p.session, p.ready);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!calls.length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [calls.length]);
  return (
    <>
      {p.paused.length ? (
        <button type="button" className="sb pzsb" title="Paused Trunks" aria-label="Paused Trunks" data-testid="sb-paused"
          onClick={(e) => p.onMenu(e, "paused", [{ kind: "head", label: "Paused" }, ...p.paused.map((t): MenuItem => ({ label: `Resume ${t.name}`, run: () => {}, disabled: RESUME_MISSING, sub: RESUME_MISSING }))], "Paused Trunks")}>
          <Icon name="pause" small />
          {p.allPaused ? "All Trunks paused" : `${p.paused.length} paused`}
        </button>
      ) : null}
      {calls.map((c) => (
        <button key={c.id} type="button" className="sb live-call" title="Open the live call" data-testid="sb-call"
          onClick={(e) => p.onMenu(e, `call:${c.id}`, [
            { kind: "info", label: `Live call · ${c.state}` },
            { label: "End the call", danger: true, run: () => void p.session.request("voicecall.end", { callId: c.id }).catch((err: unknown) => notify(`Couldn't end the call: ${reason(err)}.`, { tone: "bad" })) },
          ], "Live call")}>
          <Icon name="phone" small />
          <span>Live call · {clock(now - c.startedAt)}</span>
        </button>
      ))}
    </>
  );
}

/** The graphics and memory readout, after the spacer (§4.9.10). */
export function StatusGfx(p: Props) {
  const v = useVitals(p.session, p.ready && p.gfx);
  const level = readLevel();
  if (!p.gfx) return null;
  const tight = v ? v.memUsed / v.memTotal > 0.9 : false;
  const words = v ? `memory ${gb(v.memUsed)}/${gb(v.memTotal)} GB` : "—";
  return (
    <button type="button" className="sb hide-sm hw" data-hide="gfx" title={vitalsTip(v, level)} aria-label={vitalsTip(v, level)} data-testid="sb-gfx" onClick={() => p.onSettings("local")}>
      <Icon name="monitor" small />
      <span>{tight ? <b className="warn-hw">{words}</b> : words}</span>
    </button>
  );
}

/** The status pet rests as a still and reacts once when patted (§6.5). */
export function StatusPet({ pet }: { pet: Props["pet"] }) {
  if (!pet || pet.where !== "status" || pet.id === "none") return null;
  const still = PETS.find((x) => x.id === pet.id)?.still;
  return (
    <button type="button" className="sb pet" aria-label={`Pat ${pet.name}`} title={pet.name} data-testid="sb-pet">
      <PetReactionArt key={pet.id} id={pet.id} still={still}><PetStill id={pet.id} /></PetReactionArt>
    </button>
  );
}

/** The pet's still: a painted picture, or a pixel pet drawn from its map. */
function PetStill({ id }: { id: string }) {
  const still = PETS.find((x) => x.id === id)?.still;
  if (still) return <img src={still} alt="" width={22} height={22} draggable={false} />;
  return PIXEL[id] ? <span className="pet-px"><PixelPet p={PIXEL[id]} /></span> : null;
}
