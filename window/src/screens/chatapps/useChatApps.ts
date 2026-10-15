import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { canAll, requestOrComing } from "../../connect/capabilities";
import { errorText } from "../../places/settings/adapter";
import type { ChannelsStatus } from "../../places/settings/set1/chatapps-data";
import type { Pairing } from "../../places/settings/set1/chatapps-asking";

/** Live snapshots, refreshed on channel events; an old connection cannot overwrite a new one. */
export function useChatApps(engine: WindowEngine) {
  const [status, setStatus] = useState<ChannelsStatus>();
  const [pairing, setPairing] = useState<Pairing>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    const reads = await Promise.allSettled([
      requestOrComing<ChannelsStatus>(engine, "channels.status", {}),
      canAll(engine, ["channels.pairing.list"]) ? requestOrComing<Pairing>(engine, "channels.pairing.list", {}) : Promise.resolve(undefined),
    ]);
    if (current !== generation.current) return;
    const [channels, requests] = reads;
    setStatus(channels.status === "fulfilled" ? channels.value : undefined);
    setPairing(requests.status === "fulfilled" ? requests.value : undefined);
    setError(reads.filter(r => r.status === "rejected").map(r => errorText(r.reason)).join(" · "));
    setLoading(false);
  }, [engine]);
  useEffect(() => {
    void reload();
    const off = engine.onEvent(e => { if (["channels.status", "channels.changed", "channels.pairing.changed"].includes(e.event)) void reload(); });
    return () => { generation.current++; off(); };
  }, [engine, reload]);
  return { status, pairing, error, loading, reload };
}
