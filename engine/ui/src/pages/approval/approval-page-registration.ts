import { ApprovalPage } from "./approval-page.ts";

if (!customElements.get("branch-approval-page")) {
  customElements.define("branch-approval-page", ApprovalPage);
}
