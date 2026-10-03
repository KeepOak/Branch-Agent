import { describe, expect, it } from "vitest";
import { CHARACTERS, EXTRA, trunkAppearance } from "./appearance";
import { FaceCap } from "./cap";
describe("preview character identity", () => {
  it("keeps Sapling and unknown Trunks classic", () => { expect(trunkAppearance(undefined,"Sapling")).toBeUndefined(); expect(trunkAppearance(undefined,"Oak")).toBeUndefined(); });
  it("uses the configured look rather than another Trunk's default", () => { expect(trunkAppearance("tide","Scout")?.still).toBe("/assets/agents/tide/still.webp"); expect(trunkAppearance("classic","Scout")).toBeUndefined(); });
  it("loads supplied extra characters and preserves outside avatars", () => { expect(trunkAppearance("branch:sorrel","Oak")?.states?.work).toBe("/assets/art17/agents/sorrel/work.webm"); expect(trunkAppearance("https://example.com/avatar.webp","Oak")?.still).toBe("https://example.com/avatar.webp"); });
  it("lists only characters whose art ships, including wisp and not willow", () => {
    const shipped = new Set(Object.keys(import.meta.glob("../../public/assets/**/*.{webp,webm}")).map((path) => path.replace("../../public", "")));
    expect(shipped.size).toBeGreaterThan(0);
    for (const id of [...CHARACTERS, ...EXTRA]) {
      const look = trunkAppearance(id, "Oak");
      for (const file of [look?.still, ...Object.values(look?.states ?? {})]) expect(shipped.has(file ?? ""), `${id}: ${file}`).toBe(true);
    }
    expect(trunkAppearance("wisp", "Oak")?.still).toBe("/assets/agents/wisp/still.webp");
    expect(trunkAppearance("willow", "Oak")).toBeUndefined();
  });
  it("rejects unsupported local paths", () => { expect(trunkAppearance("../../private.webp","Oak")).toBeUndefined(); });
});
describe("moving character priority", () => {
  it("reclaims a row's slot for the open Trunk and releases on close", () => { const cap=new FaceCap({video:1,pebble:12}); let revoked=false; expect(cap.request(1,"video",100,()=>{revoked=true})).toBe(true); expect(cap.request(2,"video",300,()=>{})).toBe(true); expect(revoked).toBe(true); expect(cap.playing("video")).toBe(1); cap.release(2); expect(cap.playing("video")).toBe(0); });
});
