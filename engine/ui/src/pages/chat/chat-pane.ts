// Public custom-element entrypoint for the Control UI chat pane.
import { ChatPane } from "./chat-pane-render.ts";

if (!customElements.get("branch-chat-pane")) {
  customElements.define("branch-chat-pane", ChatPane);
}

declare global {
  interface HTMLElementTagNameMap {
    "branch-chat-pane": ChatPane;
  }
}
