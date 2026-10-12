import { useEffect, useState } from "react";
import type { SaplingSession } from "../connect/session";
import { notify } from "./notify";
import { reorderedPins, type SidebarDrop } from "./sidebar-drag";

const KEY = "ui.window.contactPinOrder";

export function usePinOrder(engine: SaplingSession, ready: boolean) {
  const [order, setOrder] = useState<string[]>([]);
  const [canSave, setCanSave] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const load = async () => {
      try {
        const result = await engine.request("users.prefs.get", { keys: [KEY] }) as { status: string; entries?: Record<string, unknown> };
        if (!live) return;
        setCanSave(result.status === "ok");
        if (result.status === "ok") {
          const value = result.entries?.[KEY];
          setOrder(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
        }
      } catch (error) {
        console.warn("Pinned order could not load:", error);
      }
    };
    void load();
    const off = engine.onGatewayEvent((event) => { if (event === "users.prefs.changed") void load(); });
    return () => { live = false; off(); };
  }, [engine, ready]);
  const move = async (drop: SidebarDrop, visible: readonly string[]) => {
    if (!canSave) {
      notify("Sign in as a person to save the Pinned order.", { tone: "bad" });
      return;
    }
    const all = [...order.filter((key) => visible.includes(key)), ...visible.filter((key) => !order.includes(key))];
    const next = reorderedPins(all, drop.source, drop.target, drop.zone);
    if (next.every((key, i) => key === all[i])) return;
    setOrder(next);
    try {
      const result = await engine.request("users.prefs.set", { entries: { [KEY]: next } }) as { status: string };
      if (result.status !== "ok") throw new Error(result.status);
    } catch (error) {
      setOrder(order);
      notify(`Couldn't save the Pinned order: ${error instanceof Error ? error.message : String(error)}.`, { tone: "bad" });
    }
  };
  return { order, move };
}
