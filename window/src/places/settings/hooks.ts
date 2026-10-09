import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { errorText } from "./adapter";

/** How long a settings read may wait before the page says the engine did not answer. A late answer still lands. */
export const READ_WAIT_MS = 20_000;
export const NO_ANSWER = "The engine didn’t answer in time.";

/** A stale response never replaces a newer load or a different page's state. */
export function useResource<T>(engine: WindowEngine, method: string, params: unknown = {}) {
  const paramsKey = JSON.stringify(params);
  const generation = useRef(0);
  const [state, setState] = useState<{ data?: T; loading: boolean; error?: string }>({ loading: true });
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setState({ loading: true });
    const timer = setTimeout(() => {
      if (current === generation.current) setState((s) => (s.loading ? { loading: false, error: NO_ANSWER } : s));
    }, READ_WAIT_MS);
    try {
      const data = await engine.request<T>(method, JSON.parse(paramsKey));
      if (current === generation.current) setState({ data, loading: false });
    } catch (error) { if (current === generation.current) setState({ error: errorText(error), loading: false }); }
    finally { clearTimeout(timer); }
  }, [engine, method, paramsKey]);
  useEffect(() => { void reload(); return () => { generation.current++; }; }, [reload]);
  return { ...state, reload };
}

/** Serialize mutations even when clicks arrive before React has rerendered. */
export function useAction() {
  const locked = useRef(false);
  const generation = useRef(0);
  const [state, setState] = useState<{ busy: boolean; message?: string; error?: string }>({ busy: false });
  useEffect(() => { return () => { generation.current++; }; }, []);
  const run = async (action: () => Promise<unknown>, success = "Saved") => {
    if (locked.current) return;
    locked.current = true; const current = generation.current; setState({ busy: true });
    try { await action(); if (current === generation.current) setState({ busy: false, message: success }); }
    catch (error) { if (current === generation.current) setState({ busy: false, error: errorText(error) }); }
    finally { locked.current = false; }
  };
  return { ...state, run };
}
