import { html } from "lit";
import { restoredInstantThreadPage } from "./instant-thread-restore.ts";
import { NewSessionPage } from "./new-session-page.ts";

if (!customElements.get("branch-new-session-page")) {
  customElements.define("branch-new-session-page", NewSessionPage);
}

export const render = (data: unknown) =>
  restoredInstantThreadPage(data) ??
  html`<branch-new-session-page .data=${data}></branch-new-session-page>`;
