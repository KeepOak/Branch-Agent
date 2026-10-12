import { useState } from "react";
import type { Conversation } from "../connect/conversations";
import { Dialog } from "./Dialog";

const ASK_KEY = "branch.askBeforeDelete";

/** Whether to ask before deleting (§4.1.6 rule 2; the dialog's "Don't ask me again"). */
export function askBeforeDelete(): boolean {
  try {
    return localStorage.getItem(ASK_KEY) !== "0";
  } catch {
    return true; // storage blocked: always ask
  }
}

/** "Delete “<name>”?" (DESIGN-SPEC §4.1.6 Parity adds, Delete…). */
export function ConfirmDelete({ row, count = 1, onCancel, onDelete }: { row: Conversation; count?: number; onCancel: () => void; onDelete: () => void }) {
  const [dontAsk, setDontAsk] = useState(false);
  return (
    <Dialog
      title={count > 1 ? `Delete ${count} conversations?` : `Delete “${row.title || "New conversation"}”?`}
      onClose={onCancel}
      testid="confirm-delete"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn bad"
            data-testid="confirm-delete-yes"
            onClick={() => {
              if (dontAsk) {
                try {
                  localStorage.setItem(ASK_KEY, "0");
                } catch {
                  // storage blocked: the dialog keeps asking
                }
              }
              onDelete();
            }}
          >
            Delete
          </button>
        </>
      }
    >
      <p className="dlg-p">
        {count > 1
          ? `Delete ${count} conversations and their messages? Anything still running for them is stopped safely first.`
          : "Its messages are deleted. Anything still running for it is stopped safely first."}
      </p>
      <label className="check">
        <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
        Don't ask me again
      </label>
    </Dialog>
  );
}

/** Deleting another assistant's conversation (the preview's extdelPA18): it may only be archived where it lives. */
export function ConfirmCatalogDelete({ onCancel, onDelete }: { name: string; onCancel: () => void; onDelete: () => void }) {
  return (
    <Dialog
      title="Delete this conversation?"
      onClose={onCancel}
      testid="confirm-catalog-delete"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn bad" onClick={onDelete}>
            Delete
          </button>
        </>
      }
    >
      <p className="dlg-p">
        Delete this conversation from Branch? Make sure nothing else is using it. Conversations sent here are deleted for good; ones kept by another app, such as Codex, are archived there and may come back.
      </p>
    </Dialog>
  );
}
