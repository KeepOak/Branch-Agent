// Trunk editor › GitHub: this Trunk's GitHub connection, using the same panel as Settings.
// Connecting or disconnecting GitHub is a live engine call, so it applies at once. The note on the tab says so.
import type { WindowEngine } from "../../connect/engine";
import { GitHubSettings } from "../settings/GitHubSettings";

export const GITHUB_NOTE = "Connecting or disconnecting GitHub applies right away.";

export function GitHubTab({ engine, agentId }: { engine: WindowEngine; agentId: string }) {
  return <div className="kit-page"><p className="tk-hint">{GITHUB_NOTE}</p><GitHubSettings engine={engine} agentId={agentId} /></div>;
}
