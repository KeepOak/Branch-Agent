import { useCallback, useEffect, useRef, useState } from "react";
import { historyToBlocks } from "../thread/history";
import type { Block } from "../thread/model";

type Segment = { sessionId: string; startedAt?: number; current: boolean };
export type EarlierPage = { sessionId: string; startedAt?: number; blocks: Block[] };
type Request = (method: string, params: unknown) => Promise<unknown>;

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

/** Read older generations under the same thread key without merging their session identities. */
export function useContactSegments(request: Request, threadKey: string | null) {
  const [state, setState] = useState<{ key: string; segments: Segment[]; pages: EarlierPage[]; loading: boolean; error: string } | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    if (!threadKey) return;
    let live = true;
    void request("sessions.segments.list", { sessionKey: threadKey }).then((raw) => {
      if (!live) return;
      const segments = record(raw).segments;
      setState({ key: threadKey, segments: Array.isArray(segments) ? segments as Segment[] : [], pages: [], loading: false, error: "" });
    }, (error: unknown) => {
      if (live) setState({ key: threadKey, segments: [], pages: [], loading: false, error: error instanceof Error ? error.message : String(error) });
    });
    return () => { live = false; };
  }, [request, threadKey]);
  const current = state?.key === threadKey ? state : null;
  const loadEarlier = useCallback(async () => {
    if (!current || !threadKey || pending.current) return;
    const next = current.segments.find((segment) => !segment.current && !current.pages.some((page) => page.sessionId === segment.sessionId));
    if (!next) return;
    pending.current = true;
    setState((value) => value?.key === threadKey ? { ...value, loading: true, error: "" } : value);
    try {
      const result = record(await request("chat.history", { sessionKey: threadKey, sessionId: next.sessionId }));
      const messages = Array.isArray(result.messages) ? result.messages : [];
      const page = { sessionId: next.sessionId, startedAt: next.startedAt, blocks: historyToBlocks(messages, [], threadKey, null) };
      setState((value) => value?.key === threadKey ? { ...value, pages: [...value.pages, page], loading: false } : value);
    } catch (error) {
      setState((value) => value?.key === threadKey ? { ...value, loading: false, error: error instanceof Error ? error.message : String(error) } : value);
    } finally { pending.current = false; }
  }, [current, request, threadKey]);
  return {
    pages: current?.pages ?? [],
    currentStartedAt: current?.segments.find((segment) => segment.current)?.startedAt,
    hasEarlier: Boolean(current?.segments.some((segment) => !segment.current && !current.pages.some((page) => page.sessionId === segment.sessionId))),
    loading: current?.loading ?? false,
    error: current?.error ?? "",
    loadEarlier,
  };
}
