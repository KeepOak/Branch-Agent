// What the engine holds for this conversation: its session row, the defaults for new ones, the Trunks and the
// models it may use. Read again after every change and on sessions.changed, so the composer shows the engine's state.
import { useCallback, useEffect, useRef, useState } from "react";
import { agentOf, errorText, list, rec, str, type Rec, type WindowEngine } from "./engine";
import { readModels, type ModelChoice } from "./model";

export type Trunk = { id: string; name: string; defaultMode: string; theme: string; model: string };

export type Conversation = {
  loaded: boolean;
  row: Rec;
  defaults: Rec;
  trunks: Trunk[];
  defaultTrunkId: string;
  models: ModelChoice[];
  /** models.list answered at least once for this conversation */
  modelsLoaded: boolean;
  modelsLoading: boolean;
  modelsError: string | null;
  error: string | null;
};

const EMPTY: Conversation = {
  loaded: false,
  row: {},
  defaults: {},
  trunks: [],
  defaultTrunkId: "",
  models: [],
  modelsLoaded: false,
  modelsLoading: false,
  modelsError: null,
  error: null,
};

/** No model set up: the engine names no default model, or none it names is connected (models.list has none usable). */
export function hasNoModel(conv: Conversation, currentRef: string): boolean {
  return conv.loaded && (!currentRef || (conv.modelsLoaded && !conv.models.some((m) => m.available)));
}

function readTrunks(result: unknown): { trunks: Trunk[]; defaultId: string } {
  const r = rec(result);
  const trunks = list(r.agents).map((a) => ({
    id: str(a.id),
    name: str(rec(a.identity).name) || str(a.name) || str(a.id),
    defaultMode: str(a.defaultPermissionMode),
    theme: str(rec(a.identity).theme),
    model: str(rec(a.model).primary),
  }));
  return { trunks, defaultId: str(r.defaultId) };
}

function touches(payload: unknown, key: string): boolean {
  const p = rec(payload);
  const keys = [str(p.key), str(p.sessionKey), ...list(p.sessions).map((s) => str(s.key))].filter(Boolean);
  return keys.length === 0 || keys.includes(key);
}

export function useConversation(engine: WindowEngine | undefined, draftAgentId?: string) {
  const [state, setState] = useState<Conversation>(EMPTY);
  const key = engine?.sessionKey ?? null;
  const live = useRef(key);
  live.current = key;

  const readRow = useCallback(async () => {
    if (!engine || !key) return;
    const [described, listed] = await Promise.all([
      draftAgentId ? Promise.resolve({ session: null }) : engine.request("sessions.describe", { key }),
      engine.request("sessions.list", { limit: 1 }),
    ]);
    if (live.current === key) {
      setState((s) => ({ ...s, loaded: true, row: rec(rec(described).session), defaults: rec(rec(listed).defaults), error: null }));
    }
  }, [engine, key, draftAgentId]);

  const readModelList = useCallback(async () => {
    if (!engine || !key) return;
    setState((s) => ({ ...s, modelsLoading: true, modelsError: null }));
    try {
      const result = await engine.request("models.list", { sessionKey: key, includeDetails: true });
      if (live.current === key) setState((s) => ({ ...s, models: readModels(result), modelsLoaded: true, modelsLoading: false }));
    } catch (error) {
      if (live.current === key) setState((s) => ({ ...s, modelsLoading: false, modelsError: errorText(error) }));
    }
  }, [engine, key]);

  const load = useCallback(async () => {
    if (!engine || !key) return;
    try {
      const agents = await engine.request("agents.list", {});
      const { trunks, defaultId } = readTrunks(agents);
      if (live.current === key) setState((s) => ({ ...s, trunks, defaultTrunkId: defaultId }));
      await Promise.all([readRow(), readModelList()]);
    } catch (error) {
      if (live.current === key) setState((s) => ({ ...s, loaded: true, error: errorText(error) }));
    }
  }, [engine, key, readRow, readModelList]);

  useEffect(() => {
    setState(EMPTY);
    void load();
  }, [load]);

  useEffect(() => {
    if (!engine || !key) return;
    return engine.onEvent(({ event, payload }) => {
      if ((event === "sessions.changed" && touches(payload, key)) || (event === "chat" && str(rec(payload).state) === "final")) {
        readRow().catch((error: unknown) => setState((s) => ({ ...s, error: errorText(error) })));
      }
    });
  }, [engine, key, readRow]);

  /** sessions.patch on this conversation, then the row read back. Returns the engine's error words, or null. */
  const patch = useCallback(
    async (fields: Record<string, unknown>): Promise<string | null> => {
      if (!engine || !key) return "Not connected to a conversation.";
      try {
        await engine.request("sessions.patch", { key, ...fields });
        await readRow();
        return null;
      } catch (error) {
        return errorText(error);
      }
    },
    [engine, key, readRow],
  );

  const trunkId = draftAgentId ?? engine?.agentId ?? agentOf(key) ?? state.defaultTrunkId;
  const trunk = state.trunks.find((t) => t.id === trunkId);
  return { ...state, key, trunk, trunkId, patch, reload: load, readModelList };
}
