// Canopy's shared state: one read of every source, the act wrapper and the context its views read. Canopy's Now tab
// and Automations › Board both use it, so they draw from the same reads.
import { useCallback, useMemo } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import type { PlaceId } from "../../places-nav/routes";
import { canApprove, canWrite, usePlaceData } from "../automations/runtime";
import { openBoard } from "../automations/board-route";
import { computers, loadCanopy } from "./data";
import { buildRuns } from "./runs";
import type { Ctx } from "./ui";

export function useCanopy(engine: WindowEngine, level: Level, openConversation: (key: string) => void, openPlace: (place: PlaceId) => void) {
  const state = usePlaceData(engine, loadCanopy);
  const act = useCallback(async (op: () => Promise<unknown>, message: string) => {
    const ok = await state.act(op, message);
    if (!ok) void state.refresh();
    return ok;
  }, [state]);
  const d = state.data, now = Date.now();
  const comps = useMemo(() => d ? computers(d) : [], [d]);
  const all = useMemo(() => d ? buildRuns(d, now) : [], [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const ctx: Ctx | null = d ? {
    engine, d, level, comps, now, write: canWrite(engine), approve: canApprove(engine), busy: state.busy, act, openConversation, openPlace,
    openCard: id => openBoard(id),
  } : null;
  return { state, d, ctx, act, all };
}
