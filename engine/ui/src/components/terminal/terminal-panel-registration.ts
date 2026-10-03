import { BranchTerminalPanel } from "./terminal-panel.ts";

// Guarded define so shared registries can retain this module across reloads.
if (!customElements.get("branch-terminal-panel")) {
  customElements.define("branch-terminal-panel", BranchTerminalPanel);
}
