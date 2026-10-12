// Banners for problems (DESIGN-SPEC §4.10.1, the preview's problemPA18 and chWatchPA18): the computer Branch talks to
// can't be reached ("Open connection"), and a chat app that was connected has just disconnected ("Ask <Trunk>").
// Each is raised on a real change: the connection's phase, or channels.status read again.
import { useEffect, useRef } from "react";
import type { SaplingSession } from "../connect/session";
import { raiseBanner } from "./Banner";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The chat apps with a connected account, by id, with their names (channels.status). */
export function connectedApps(status: unknown): Map<string, string> {
  const s = rec(status);
  const labels = rec(s.channelLabels);
  const accounts = rec(s.channelAccounts);
  const out = new Map<string, string>();
  for (const [id, list] of Object.entries(accounts)) {
    if (Array.isArray(list) && list.some((a) => rec(a).connected === true)) out.set(id, str(labels[id]) || id);
  }
  return out;
}

type Props = {
  session: SaplingSession;
  phase: string;
  machineName: string;
  defaultName: string;
  openConnection: () => void;
  askDefault: (text: string) => void;
};

export function useProblemBanners({ session, phase, machineName, defaultName, openConnection, askDefault }: Props): void {
  const wasConnected = useRef(false);
  const latest = useRef({ machineName, defaultName, openConnection, askDefault });
  latest.current = { machineName, defaultName, openConnection, askDefault };
  useEffect(() => {
    if (phase === "connected") {
      wasConnected.current = true;
      return;
    }
    if (!wasConnected.current) return;
    wasConnected.current = false;
    const name = latest.current.machineName || "this computer";
    raiseBanner({ icon: "alert", title: `Can’t reach ${name}`, text: "Branch keeps trying.", sameAs: `reach:${name}`, action: { label: "Open connection", run: () => latest.current.openConnection() } });
  }, [phase]);
  const apps = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (phase !== "connected") return;
    let live = true;
    const read = () =>
      session.request("channels.status", { probe: false }).then(
        (r) => {
          if (!live) return;
          const now = connectedApps(r);
          const was = apps.current;
          apps.current = now;
          const gone = was ? [...was].find(([id]) => !now.has(id)) : undefined;
          if (!gone) return;
          const [, app] = gone;
          const who = latest.current.defaultName;
          raiseBanner({
            icon: "chat",
            title: `${app} just disconnected`,
            text: `Messages from ${app} won’t reach your Trunks until it’s back.`,
            sameAs: `app:${app}`,
            action: { label: `Ask ${who}`, run: () => latest.current.askDefault(`What happened to ${app}?`) },
          });
        },
        () => undefined, // channels.status unavailable: no chat apps to watch
      );
    void read();
    const off = session.onGatewayEvent((event) => {
      if (event === "channels.changed" || event === "channels.status") void read();
    });
    const timer = setInterval(read, 30_000);
    return () => {
      live = false;
      off();
      clearInterval(timer);
    };
  }, [session, phase]);
}
