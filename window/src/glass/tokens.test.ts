import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { color, glass, spring } from "./tokens";
// Vitest stubs CSS imports; supply the canonical source for the raw module.
vi.mock("../theme/tokens.css?raw", async () => ({ default: (await import("node:fs")).readFileSync("src/theme/tokens.css", "utf8") }));
const css = readFileSync("src/theme/tokens.css", "utf8").toLowerCase().replace(/\s/g, "");
it.each(["light", "dark"] as const)("keeps the %s Slate and glass JS tokens in the CSS module", mode => {
  expect(color.light.bg).toBe("#f6f8f9");
  expect(color.dark.bg).toBe("#0f1418");
  expect(glass.light.control.fill).toBe("rgba(255,255,255,.6)");
  expect(glass.dark.control.fill).toBe("rgba(30,30,32,.55)");
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
it("draws the face status dots in the preview's colours (pAvP17 st-online, st-away, st-phone)", () => {
  expect(css).toContain("--st-online:#34c759;");
  expect(css).toContain("--st-away:#e0a13a;");
  expect(css).toContain("--st-phone:#3b82f6;");
  const glassCss = readFileSync("src/glass/glass.css", "utf8").replace(/\s/g, "");
  for (const status of ["online", "away", "phone"]) expect(glassCss).toContain(`.g-av-status[data-status="${status}"]{background:var(--st-${status});}`);
});
