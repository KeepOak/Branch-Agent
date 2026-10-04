import type { WindowEngine } from "../connect/engine";

export type ArtifactKind = "html" | "svg" | "chart";
export type ChartSpec = { type: "bar" | "line" | "pie"; title: string; points: { label: string; value: number }[] };
export function artifactKind(language: string): ArtifactKind | null {
  const kind = language.toLowerCase();
  return kind === "html" || kind === "svg" || kind === "chart" ? kind : null;
}

/** Adapted from the original charts.js contract; no generated code is evaluated. */
export function readChart(source: string): ChartSpec {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error("A chart block holds the chart written as JSON."); }
  const spec = value as Partial<{ type: string; title: string; data: { label: unknown; value: unknown }[] }> | null;
  const type = spec?.type ?? "bar";
  if (type !== "bar" && type !== "line" && type !== "pie") throw new Error(`This chart type cannot be shown: ${String(type)}.`);
  const points = (Array.isArray(spec?.data) ? spec.data : []).flatMap(row => {
    if (!row || row.label == null || row.value == null || row.value === "") return [];
    const label = String(row.label), number = Number(row.value);
    return label && Number.isFinite(number) ? [{ label, value: number }] : [];
  });
  if (!points.length) throw new Error("This chart has no numbers to draw.");
  return { type, title: String(spec?.title ?? "Chart"), points };
}

/** Empty sandbox plus a first CSP prevents network loads and execution inside raw markup. */
export function sealedDocument(source: string): string {
  const document = new DOMParser().parseFromString(source, "text/html");
  document.querySelectorAll("script, meta, base, iframe, object, embed").forEach(node => node.remove());
  document.querySelectorAll("animate, set").forEach(node => {
    if (/^(?:href|xlink:href)$/i.test(node.getAttribute("attributeName") ?? "")) node.remove();
  });
  document.querySelectorAll("*").forEach(node => {
    for (const attribute of Array.from(node.attributes)) {
      if (/^(?:href|xlink:href)$/i.test(attribute.name) && attribute.value.startsWith("#")) continue;
      if (/^(?:on.*|href|xlink:href|action|formaction|srcdoc)$/i.test(attribute.name)) node.removeAttribute(attribute.name);
    }
  });
  const markup = document.head.innerHTML + document.body.innerHTML;
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src data:; form-action \'none\'; base-uri \'none\'"><meta name="referrer" content="no-referrer"></head><body>' + markup + "</body></html>";
}

export async function saveArtifact(engine: WindowEngine, agentId: string, kind: ArtifactKind, source: string): Promise<string> {
  const name = `artifact-${crypto.randomUUID()}.${kind === "chart" ? "json" : kind}`;
  const result = await engine.request<{ agentId?: string; file?: { name?: string; path?: string; size?: number } }>(
    "agents.documents.create", { agentId, name, content: source });
  const path = `Documents/${name}`;
  if (result?.agentId !== agentId || result.file?.name !== name || result.file.path !== path || result.file.size !== new TextEncoder().encode(source).length) {
    throw new Error("The engine did not confirm the saved document.");
  }
  return path;
}
