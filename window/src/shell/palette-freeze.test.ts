import { expect, it } from "vitest";
import type { PaletteRow } from "./palette-model";
import { paletteShown } from "./Palette";

const row = (id: string, group: string): PaletteRow => ({ id, group, label: id, hint: "", run: () => undefined });

it("keeps the rows already on screen in place when message results arrive", () => {
  const local = [row("a:new", "Actions"), row("c:builder", "Conversations"), row("s:models", "Settings"), row("t:builder", "Trunks")];
  const before = paletteShown(local, []).map((r) => r.id);
  const after = paletteShown(local, [row("msg:0", "Messages"), row("msg:1", "Messages")]).map((r) => r.id);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after.slice(before.length)).toEqual(["msg:0", "msg:1"]);
});
