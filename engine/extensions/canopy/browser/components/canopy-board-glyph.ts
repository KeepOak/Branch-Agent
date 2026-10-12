import { nothing } from "lit";
import type { CanopyBoardSummary } from "../lib/canopy/index.ts";
import { renderAppearanceGlyph } from "./host-components.ts";

export function renderCanopyBoardGlyph(
  board: Pick<CanopyBoardSummary, "id" | "name" | "icon" | "color">,
  className = "",
) {
  if (!board.icon?.trim() && !board.color?.trim()) {
    return nothing;
  }
  return renderAppearanceGlyph(
    {
      icon: board.icon ?? null,
      color: board.color ?? null,
      fallback: "",
    },
    `canopy-board-glyph ${className}`,
  );
}
