import { AgentSelect } from "./agent-select.ts";

if (!customElements.get("branch-agent-select")) {
  customElements.define("branch-agent-select", AgentSelect);
}

declare global {
  interface HTMLElementTagNameMap {
    "branch-agent-select": AgentSelect;
  }
}
