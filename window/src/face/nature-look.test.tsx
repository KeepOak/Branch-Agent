import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { identityKey, lookKey, natureLook, completePebbleLook } from "./appearance";
import { Face } from "./Face";

describe("the nature look for a Trunk or grafted agent with no look of its own", () => {
  it("folds case, spaces and hyphens into one identity key", () => {
    expect(identityKey("NAS  Builders")).toBe("nas builders");
    expect(identityKey("nas-builders")).toBe("nas builders");
    expect(natureLook(lookKey("NAS Builders"))).toEqual(natureLook(lookKey("nas-builders")));
  });

  it("pins the key for sample names, and keeps a name and a name-plus-computer pair apart", () => {
    expect(lookKey("NAS Builders")).toBe('["nas builders",null]');
    expect(lookKey("Oak", "Mac mini")).toBe('["oak","mac mini"]');
    expect(lookKey("x@y")).not.toBe(lookKey("x", "y"));
    expect(lookKey("x", "y")).not.toBe(lookKey("x@y"));
  });

  it("gives the same name on the same computer the same look, and the same name on another computer its own", () => {
    expect(natureLook(lookKey("Oak", "Mac mini"))).toEqual(natureLook(lookKey("oak", "mac-mini")));
    expect(natureLook(lookKey("Oak", "Mac mini"))).not.toEqual(natureLook(lookKey("Oak", "NAS")));
  });

  it("gives the same name the same look every time, from a nature palette", () => {
    const first = natureLook(lookKey("Juniper"));
    expect(natureLook(lookKey("Juniper"))).toEqual(first);
    expect(first.colour).toMatch(/^#[0-9A-F]{6}$/i);
    expect(["Circle", "Stone", "Leaf", "Acorn", "Shield"]).toContain(first.shape);
    expect(first.eyes).toBe("Round");
  });

  it("keeps the fields a look already has and fills only the gaps", () => {
    const filled = completePebbleLook({ colour: "#123456" }, "Maple");
    expect(filled.colour).toBe("#123456");
    expect(filled.shape).toBe(natureLook(lookKey("Maple")).shape);
    expect(filled.eyes).toBe("Round");
  });

  it("paints a small face in its nature colour, not the grey placeholder", () => {
    const markup = renderToStaticMarkup(<Face size={20} label="Maple grafted" />);
    expect(markup).toContain(`background:${natureLook(lookKey("Maple grafted")).colour}`);
  });
});
