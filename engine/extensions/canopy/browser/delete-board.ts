import { html, nothing, render } from "lit";
import type { ControlUiHost } from "branch/plugin-sdk/control-ui";
import { t } from "./i18n/index.ts";
import { formatUiError } from "./lib/format-error.ts";
import { canopyBoardName } from "./lib/canopy/board-presentation.ts";
import type { CanopyBoardSummary } from "./lib/canopy/types.ts";

export function deleteCanopyBoard(
  host: ControlUiHost,
  board: Pick<CanopyBoardSummary, "id" | "name">,
  onDeleted: () => void,
): Promise<void> {
  if (host.signal.aborted || !host.connection.canWrite) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const container = document.createElement("div");
    const content = document.createElement("div");
    const title = t("canopy.deleteBoardTitle", { name: canopyBoardName(board) });
    let busy = false;
    let error = "";
    let closed = false;
    const finish = () => {
      if (closed) {
        return;
      }
      closed = true;
      host.signal.removeEventListener("abort", finish);
      dialog.dispose();
      render(nothing, content);
      container.remove();
      resolve();
    };
    const remove = async () => {
      if (busy || closed) {
        return;
      }
      busy = true;
      error = "";
      update();
      try {
        if (!host.connection.connected || !host.connection.canWrite) {
          throw new Error(t("canopy.deleteBoardUnavailable"));
        }
        await host.request("canopy.boards.delete", { id: board.id });
        if (!closed) {
          onDeleted();
          finish();
        }
      } catch (cause) {
        if (!closed) {
          busy = false;
          error = formatUiError(cause);
          update();
        }
      }
    };
    const update = () =>
      render(
        html`
          <div class="exec-approval-card">
            <div class="exec-approval-header">
              <div>
                <div class="exec-approval-title">${title}</div>
                <div class="exec-approval-sub">${t("canopy.deleteBoardHelp")}</div>
              </div>
            </div>
            ${error ? html`<div role="alert">${error}</div>` : nothing}
            <div class="exec-approval-actions">
              <button class="btn danger" type="button" ?disabled=${busy} @click=${remove}>
                ${t("canopy.deleteBoardConfirm")}
              </button>
              <button class="btn" type="button" autofocus ?disabled=${busy} @click=${finish}>
                ${t("common.cancel")}
              </button>
            </div>
          </div>
        `,
        content,
      );
    document.body.append(container);
    update();
    const dialog = host.components.mountDialog(container, {
      label: title,
      description: t("canopy.deleteBoardHelp"),
      content,
      onCancel: () => (busy ? false : finish()),
    });
    host.signal.addEventListener("abort", finish, { once: true });
  });
}
