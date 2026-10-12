import { BranchFilePreviewModal } from "./file-preview-modal.ts";

if (!customElements.get("branch-file-preview-modal")) {
  customElements.define("branch-file-preview-modal", BranchFilePreviewModal);
}
