import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { color, glass, spring } from "./tokens";
const css = readFileSync("src/theme/tokens.css", "utf8").toLowerCase().replace(/\s/g, "");
it.each(["light", "dark"] as const)("keeps the %s Slate and glass JS tokens in the CSS module", mode => {
  const aliases: Record<string, string> = { ink2: "ink-2", ink3: "ink-3", line2: "line-2", fill2: "fill-2", accentInk: "accent-ink", accentTint: "accent-tint", onBtn: "on-btn", mute: "mute17c" };
  for (const [key, value] of Object.entries(color[mode])) if (key !== "leaf") expect(css).toContain(`--${aliases[key] ?? key}:${value};`.toLowerCase());
  for (const [tier, prefix] of [["control", "gc"], ["floating", "gf"]] as const) for (const [key, token] of [["fill", "fill"], ["edge", "edge"], ["hi", "hi"], ["blur", "blur"], ["shadow", "sh"]] as const) expect(css).toContain(`--${prefix}-${token}:${glass[mode][tier][key]};`.replace(/\s/g, ""));
});
it("keeps JS spring durations and easing aligned with CSS", () => {
  for (const [name, value] of Object.entries(spring)) {
    const token = name === "exit" ? "ease-exit" : name === "fade" ? "fade" : `spring-${name}`;
    expect(css).toContain(`--${token}:${String(value.ms / 1000).replace(/^0/, "")}s${value.ease};`);
  }
});
