import { MultiSelect } from "./multi-select.ts";

if (!customElements.get("branch-multi-select")) {
  customElements.define("branch-multi-select", MultiSelect);
}

declare global {
  interface HTMLElementTagNameMap {
    "branch-multi-select": MultiSelect;
  }
}
