// Which Overview widgets have something real to show. Two reads the engine already answers: the GitHub connection
// (tools.github.status, the account the default Trunk uses) and the connectors in config (mcp.servers, by name). The
// activity counts (contributions, unread mail, calendar events, files) have no engine method yet, so those cards say
// Coming rather than showing numbers.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { record, text } from "./engine";

export type GitHubLink = { linked: boolean; login: string };
export type ConnectorLinks = { github: GitHubLink | null; gmail: boolean | null; drive: boolean | null; calendar: boolean | null };

/** GitHub is linked when the default Trunk's account is available and has a login. */
export function githubLink(status: unknown): GitHubLink {
  const facts = record(record(status).effective);
  const login = text(record(facts.account).login);
  return { linked: text(facts.credentialState) === "available" && login !== "", login };
}

/** A connector is linked when the engine's config has an enabled server whose name matches. */
export function connectorLinked(config: unknown, name: RegExp): boolean {
  const servers = record(record(record(config).config).mcp).servers;
  return Object.entries(record(servers)).some(([key, value]) => name.test(key) && record(value).enabled !== false);
}

/** Reads the links once for the page; each value is null until its read answers. */
export function useConnectorLinks(engine: WindowEngine, agentId: string): ConnectorLinks {
  const [links, setLinks] = useState<ConnectorLinks>({ github: null, gmail: null, drive: null, calendar: null });
  useEffect(() => {
    let live = true;
    const set = (next: Partial<ConnectorLinks>) => { if (live) setLinks(current => ({ ...current, ...next })); };
    engine.request("config.get", {}).then(
      config => set({
        gmail: connectorLinked(config, /gmail/i),
        drive: connectorLinked(config, /drive/i),
        calendar: connectorLinked(config, /calendar/i),
      }),
      () => set({ gmail: false, drive: false, calendar: false }),
    );
    if (agentId) {
      engine.request("tools.github.status", { agentId, selectedScope: "system" }).then(
        status => set({ github: githubLink(status) }),
        () => set({ github: { linked: false, login: "" } }),
      );
    } else set({ github: { linked: false, login: "" } });
    return () => { live = false; };
  }, [engine, agentId]);
  return links;
}
