import { useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { Popover } from "../shell/Popover";
import type { MenuAnchor } from "../shell/Menu";
import { runCommandsOn, type Computer, type Placement } from "./computers";
import { SIcon } from "./stage-icons";

/** Where a picked row sends the conversation: the host, a paired device, a cloud profile or any free device. */
export type MoveTarget = { kind: "gateway" } | { kind: "device"; deviceId: string } | { kind: "profile"; profileId: string } | { kind: "free" };

/** sessions.dispatch from this PC, sessions.move between computers (the engine checks the placement it expects). */
export async function moveConversation(engine: WindowEngine, placement: Placement | undefined, target: MoveTarget): Promise<void> {
  const key = engine.sessionKey;
  const active = placement?.state === "active" && placement.environmentId && placement.generation !== undefined && placement.ownerEpoch !== undefined;
  if (active) {
    if (target.kind === "free") throw new Error("This conversation already runs on a computer. Pick one by name.");
    await engine.request("sessions.move", {
      key,
      expected: { generation: placement.generation, environmentId: placement.environmentId, ownerEpoch: placement.ownerEpoch },
      target,
    });
    return;
  }
  if (target.kind === "gateway") return;
  await engine.request(
    "sessions.dispatch",
    target.kind === "device" ? { key, deviceId: target.deviceId } : target.kind === "profile" ? { key, profileId: target.profileId } : { key, autoDevice: true },
  );
}

function Busy({ busy }: { busy: NonNullable<Computer["busy"]> }) {
  const words = `${busy.used} of ${busy.total} busy`;
  return (
    <span className="mi-s busy-st">
      {words}{" "}
      <i className="meter-st" role="meter" aria-valuemin={0} aria-valuemax={busy.total} aria-valuenow={busy.used} aria-label={words}>
        <b style={{ width: `${Math.round((busy.used / Math.max(1, busy.total)) * 100)}%` }} />
      </i>
    </span>
  );
}

/** Under a computer that only runs commands: the chat itself stays on this computer. */
const COMMANDS_ONLY = "Runs its commands; the chat stays here";

function Row({ c, checked, onPick, commandsOnly }: { c: Computer; checked: boolean; onPick?: () => void; commandsOnly?: boolean }) {
  const sub = [c.sub, commandsOnly ? COMMANDS_ONLY : ""].filter(Boolean).join(" · ");
  return (
    <button type="button" className="mi pick-st" role="menuitemradio" aria-checked={checked} disabled={!onPick} onClick={onPick}>
      <span className="mi-tick">{checked ? <SIcon name="check" small /> : null}</span>
      <span className="mi-text">
        <span>{c.name}</span>
        {sub ? <span className="mi-s">{sub}</span> : null}
        {c.busy ? <Busy busy={c.busy} /> : null}
      </span>
    </button>
  );
}

type Props = {
  at: MenuAnchor;
  engine: WindowEngine;
  name: string;
  computers: Computer[];
  profiles: { id: string; name: string }[];
  placement: Placement | undefined;
  /** The paired computer running this conversation's commands, when one is set. */
  execNode?: string;
  current: string | null;
  onClose: () => void;
  onAdd: () => void;
  onManage: () => void;
  onMoved: () => void;
};

/** The computer chip's popover: where this conversation runs, add and manage. */
export function ComputerPicker({ at, engine, name, computers, profiles, placement, execNode, current, onClose, onAdd, onManage, onMoved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const local = placement?.state !== "active";
  const move = (target: MoveTarget | { kind: "commands"; deviceId: string | null }) => {
    setBusy(true);
    setError("");
    const run = target.kind === "commands" ? runCommandsOn(engine, target.deviceId)
      : target.kind === "gateway" && local && execNode ? runCommandsOn(engine, null)
      : moveConversation(engine, placement, target);
    run.then(
      () => {
        setBusy(false);
        onMoved();
        onClose();
      },
      () => {
        setBusy(false);
        setError(target.kind === "free" ? "No other computer is free right now." : "Couldn't move this conversation. Try again or pick another computer.");
      },
    );
  };
  const usable = (c: Computer) => c.available && (c.id === "gateway" || (c.deviceId && c.sessionHost === true && (!c.busy || c.busy.used < c.busy.total)));
  // A ready paired computer without session hosting (a linux-host, say) can still run this conversation's commands.
  const commandsOnly = (c: Computer) => local && c.available && Boolean(c.deviceId) && c.sessionHost !== true;
  const pickFor = (c: Computer): (() => void) | undefined =>
    busy ? undefined : c.id === current ? onClose : c.id === "gateway" ? () => move({ kind: "gateway" })
      : commandsOnly(c) ? () => move({ kind: "commands", deviceId: c.deviceId! })
      : c.deviceId ? () => move({ kind: "device", deviceId: c.deviceId! }) : undefined;
  const otherFree = computers.some((c) => c.id !== current && c.deviceId && usable(c));
  return (
    <Popover at={at} onClose={onClose} label={`${name}'s computers`} testid="computer-picker" width={330}>
      <div className="ph">This conversation uses</div>
      {computers.filter((c) => c.id === current || usable(c) || commandsOnly(c)).map((c) => (
        <Row
          key={c.id}
          c={c}
          checked={c.id === current}
          onPick={pickFor(c)}
          commandsOnly={commandsOnly(c)}
        />
      ))}
      {profiles.map((p) => (
        <button key={p.id} type="button" className="mi pick-st" role="menuitemradio" aria-checked={false} disabled={busy} onClick={() => move({ kind: "profile", profileId: p.id })}>
          <span className="mi-tick" />
          <span className="mi-text">
            <span>A new cloud computer</span>
            <span className="mi-s">{p.name}</span>
          </span>
        </button>
      ))}
      {local && otherFree ? (
        <button type="button" className="mi pick-st" role="menuitem" disabled={busy} onClick={() => move({ kind: "free" })}>
          <span className="mi-tick" />
          <span>Whichever is free</span>
        </button>
      ) : null}
      {error ? <p className="pp err-st" role="alert">{error}</p> : null}
      <hr className="msep" />
      <button type="button" className="mi" role="menuitem" onClick={onAdd}>
        <span className="mi-tick"><SIcon name="plus" small /></span>
        <span>Add a computer</span>
      </button>
      <button type="button" className="mi" role="menuitem" onClick={onManage}>
        <span className="mi-tick"><SIcon name="monitor" small /></span>
        <span>Manage computers</span>
      </button>
    </Popover>
  );
}
