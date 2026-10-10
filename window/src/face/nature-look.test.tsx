import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { identityKey, natureLook, withNatureFallback } from "./appearance";
import { Face } from "./Face";

describe("the nature look for a Trunk or grafted agent with no look of its own", () => {
  it("folds case, spaces and hyphens into one identity key", () => {
    expect(identityKey("NAS  Builders")).toBe("nas builders");
    expect(identityKey("nas-builders")).toBe("nas builders");
    expect(natureLook("NAS Builders")).toEqual(natureLook("nas-builders"));
  });

  it("gives the same name the same look every time, from a nature palette", () => {
    const first = natureLook("Juniper");
    expect(natureLook("Juniper")).toEqual(first);
    expect(first.colour).toMatch(/^#[0-9A-F]{6}$/i);
    expect(["Circle", "Stone", "Leaf", "Acorn", "Shield"]).toContain(first.shape);
    expect(first.eyes).toBe("Round");
  });

  it("keeps the fields a look already has and fills only the gaps", () => {
    const filled = withNatureFallback({ colour: "#123456" }, "Maple");
    expect(filled.colour).toBe("#123456");
    expect(filled.shape).toBe(natureLook("Maple").shape);
    expect(filled.eyes).toBe("Round");
  });

  it("paints a small face in its nature colour, not the grey placeholder", () => {
    const markup = renderToStaticMarkup(<Face size={20} label="Maple grafted" />);
    expect(markup).toContain(`background:${natureLook("Maple grafted").colour}`);
  });
});
