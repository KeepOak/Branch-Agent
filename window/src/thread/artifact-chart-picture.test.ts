// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { chartPictureSource, chartPng, downloadChartPicture } from "./artifact-chart-picture";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function chart(): SVGSVGElement {
  return new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 80"><text>Été 🦆</text><rect fill="var(--ink)" width="10" height="10" /></svg>', "image/svg+xml").documentElement as unknown as SVGSVGElement;
}
it("embeds actual Unicode labels and resolved theme in a local SVG image", () => {
  vi.spyOn(globalThis, "getComputedStyle").mockReturnValue({ getPropertyValue: (property: string) => property === "fill" ? "rgb(10, 20, 30)" : "" } as CSSStyleDeclaration);
  const svg = chart(), source = chartPictureSource(svg);
  const decoded = new TextDecoder().decode(Uint8Array.from(atob(source.split(",")[1]), c => c.charCodeAt(0)));
  expect(decoded).toContain("Été 🦆");
  expect(decoded).toContain("rgb(10, 20, 30)");
  expect(svg.querySelector('rect')?.getAttribute("style")).toBeNull();
});
it("rasterizes the real viewBox at double resolution into PNG", async () => {
  vi.stubGlobal("Image", class { onload?: () => void; set src(_value: string) { this.onload?.(); } });
  const fillRect = vi.fn(), drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect, drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
  await expect(chartPng(chart())).resolves.toBe("data:image/png;base64,AAAA");
  expect(fillRect).toHaveBeenCalledWith(0, 0, 1120, 160);
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1120, 160);
});
it("reports image decode and unavailable canvas errors", async () => {
  vi.stubGlobal("Image", class { onerror?: () => void; set src(_value: string) { this.onerror?.(); } });
  await expect(chartPng(chart())).rejects.toThrow("turned into a picture");
  vi.stubGlobal("Image", class { onload?: () => void; set src(_value: string) { this.onload?.(); } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  await expect(chartPng(chart())).rejects.toThrow("could not create");
});
it("starts an actual named PNG download", () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  downloadChartPicture("data:image/png;base64,AAAA", "Costs / October");
  expect(click).toHaveBeenCalledOnce();
  const link = click.mock.instances[0] as HTMLAnchorElement;
  expect(link.download).toBe("Costs-October.png");
  expect(link.href).toBe("data:image/png;base64,AAAA");
});
