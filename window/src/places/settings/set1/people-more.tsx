// Settings › People: Each person (shortcuts into People place) and, at Advanced, the records (audit.list).
import { useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { list, record, visible } from "../adapter";
import { useResource } from "../hooks";
import { Dialog } from "../../../shell/Dialog";
import { Acts, Btn, Ctl, Empty, Pill, Plist, Prow, Sec } from "../kit";
import { ago } from "./people-data";


/** Opens the People place at a tab (WindowShell's branch:navigate-place). Settings › People stays in Settings; this is the obvious way out. */
export function openPeople(tab?: string) {
  window.dispatchEvent(new CustomEvent("branch:navigate-place", { detail: { place: "people", ...(tab ? { tab } : {}) } }));
}

export function EachPerson() {
  return (
    <>
      <Sec title="Each person">
        <Ctl title="Open People" sub="The People place: who’s here now, groups, what you share, and signing in from other devices.">
          <Btn sm onClick={() => openPeople()}>Open People</Btn>
        </Ctl>
      </Sec>
      <Acts>
        <Btn ghost sm onClick={() => openPeople("Groups")}>Groups</Btn>
        <Btn ghost sm onClick={() => openPeople("Signing in")}>Signing in from other devices</Btn>
        <Btn ghost sm onClick={() => openPeople("Shared")}>What you share</Btn>
      </Acts>
    </>
  );
}

export function Records({ engine, trunks }: { engine: WindowEngine; trunks: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  return (
    <Sec title="Records">
      <Ctl title="Signed household records" sub="Sign people’s changes so you can see who did what." help="Changes people make are signed, so it’s clear who did what; code changes come as patches.">
        <Btn sm onClick={() => setOpen(true)}>See the last</Btn>
      </Ctl>
      {open ? <RecordsDialog engine={engine} trunks={trunks} onClose={() => setOpen(false)} /> : null}
    </Sec>
  );
}

const STATUS: Record<string, [string, "ok" | "warn" | "bad" | "idle" | "work"]> = {
  started: ["Started", "work"], succeeded: ["Done", "ok"], failed: ["Failed", "bad"], cancelled: ["Stopped", "idle"],
  timed_out: ["Timed out", "warn"], blocked: ["Blocked", "warn"], unknown: ["Unknown", "idle"],
};

function RecordsDialog({ engine, trunks, onClose }: { engine: WindowEngine; trunks: Map<string, string>; onClose: () => void }) {
  const res = useResource(engine, "audit.list", { limit: 20 });
  const events = list(record(res.data).events);
  return (
    <Dialog title="Signed household records" onClose={onClose}>
      {res.loading ? <p className="hint">Reading the record…</p> : res.error ? <p className="err-pp">{visible(res.error)}</p> : events.length ? (
        <>
          <p className="lede-pp">Recent:</p>
          <Plist>
            {events.map((e) => {
              const [word, tone] = STATUS[String(e.status)] ?? STATUS.unknown;
              const who = trunks.get(String(e.agentId)) ?? visible(e.agentId);
              const what = e.toolName ? visible(e.toolName) : e.kind === "agent_run" ? "A run" : "A tool";
              return <Prow key={String(e.eventId)} title={`${who} · ${what}`} sub={typeof e.occurredAt === "number" ? ago(e.occurredAt) : undefined}><Pill tone={tone}>{word}</Pill></Prow>;
            })}
          </Plist>
        </>
      ) : <Empty>Nothing recorded yet.</Empty>}
    </Dialog>
  );
}

