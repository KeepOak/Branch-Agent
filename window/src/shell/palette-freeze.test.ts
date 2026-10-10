import { expect, it } from "vitest";
import type { PaletteRow } from "./palette-model";
import { paletteShown } from "./Palette";

const row = (id: string, group: string): PaletteRow => ({ id, group, label: id, hint: "", run: () => undefined });

it("keeps the rows already listed in their order when message results arrive", () => {
  const local = [row("a:new", "Actions"), row("c:builder", "Conversations"), row("s:models", "Settings"), row("t:builder", "Trunks")];
  const before = paletteShown(local, []).map((r) => r.id);
  const after = paletteShown(local, [row("msg:0", "Messages"), row("msg:1", "Messages")]).map((r) => r.id);
  expect(after.filter((id) => !id.startsWith("msg:"))).toEqual(before);
});

it("puts message rows before Trunks, as GROUPS orders them", () => {
  const local = [row("a:new", "Actions"), row("s:models", "Settings"), row("t:builder", "Trunks")];
  const after = paletteShown(local, [row("msg:0", "Messages")]).map((r) => r.id);
  expect(after).toEqual(["a:new", "s:models", "msg:0", "t:builder"]);
});

it("lists nothing extra when there are no message rows", () => {
  const local = [row("a:new", "Actions"), row("t:builder", "Trunks")];
  expect(paletteShown(local, [])).toEqual(local);
});
