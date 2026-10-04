// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { artifactKind, readChart, saveArtifact, sealedDocument } from "./artifact-preview";
import type { WindowEngine } from "../connect/engine";

describe("passive artifact contracts", () => {
  it("keeps ordinary scripts as code", () => {
    expect(artifactKind("SVG")).toBe("svg");
    expect(artifactKind("javascript")).toBeNull();
    expect(artifactKind("python")).toBeNull();
  });
  it("accepts zero and negative numbers without converting null to zero", () => {
    expect(readChart('{"data":[{"label":"zero","value":0},{"label":"loss","value":-3},{"label":"missing","value":null}]}').points)
      .toEqual([{ label: "zero", value: 0 }, { label: "loss", value: -3 }]);
    expect(() => readChart('{"type":"radar","data":[]}')).toThrow("cannot be shown");
    expect(() => readChart("oops")).toThrow("JSON");
  });
  it("blocks script, navigation, refresh and nested frames but keeps local SVG references", () => {
    const html = sealedDocument('<meta http-equiv="refresh" content="0;url=https://example.com"><script>bad()</script><a href="https://example.com">Link</a><iframe src="https://example.com"></iframe><svg><use href="#shape"/></svg><div onclick="bad()">Kept</div>');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("example.com");
    expect(html).not.toContain("bad()");
    expect(html).toContain('href="#shape"');
    expect(html).toContain("Kept");
  });
  it("saves exact Unicode source through the exclusive gateway and checks acknowledgement", async () => {
    const request = vi.fn(async (_method: string, params: { agentId: string; name: string; content: string }) => ({ agentId: params.agentId, file: { name: params.name, path: `Documents/${params.name}`, size: 2 } }));
    const engine = { request } as unknown as WindowEngine;
    const path = await saveArtifact(engine, "ada", "svg", "é");
    expect(path).toMatch(/^Documents\/artifact-.*\.svg$/);
    expect(request).toHaveBeenCalledWith("agents.documents.create", { agentId: "ada", name: path.slice(10), content: "é" });
    request.mockResolvedValueOnce({ agentId: "other", file: { name: "wrong", path: "wrong", size: 2 } });
    await expect(saveArtifact(engine, "ada", "svg", "é")).rejects.toThrow("did not confirm");
  });
});
