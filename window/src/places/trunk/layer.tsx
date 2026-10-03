// The Trunk dialogs draw over the whole window, outside any place's own styles (a place's generic button rules
// would otherwise restyle the dialog's controls).
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export function Layer({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
