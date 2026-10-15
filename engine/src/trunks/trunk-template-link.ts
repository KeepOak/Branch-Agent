/**
 * Trunk template links: the whole template, deflated and base64url-encoded, behind a fixed
 * prefix. A link carries exactly what the template file carries, so it holds no secrets either,
 * and pasting it on another computer needs no server.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { TrunkTemplate } from "./trunk-template.js";

export const TRUNK_TEMPLATE_LINK_PREFIX = "branch-template:1:";
/** The same cap the gateway puts on a template file. */
export const TRUNK_TEMPLATE_LIMIT_BYTES = 256 * 1024;

export function encodeTrunkTemplateLink(template: TrunkTemplate): string {
  const packed = deflateRawSync(Buffer.from(JSON.stringify(template), "utf8"));
  return `${TRUNK_TEMPLATE_LINK_PREFIX}${packed.toString("base64url")}`;
}

/** The template JSON a link holds, or an error in plain words. Never inflates past the size cap. */
export function decodeTrunkTemplateLink(link: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const text = link.trim();
  if (!text.startsWith(TRUNK_TEMPLATE_LINK_PREFIX)) {
    return { ok: false, error: `A template link starts with ${TRUNK_TEMPLATE_LINK_PREFIX}` };
  }
  try {
    const packed = Buffer.from(text.slice(TRUNK_TEMPLATE_LINK_PREFIX.length), "base64url");
    const json = inflateRawSync(packed, { maxOutputLength: TRUNK_TEMPLATE_LIMIT_BYTES }).toString("utf8");
    return { ok: true, value: JSON.parse(json) as unknown };
  } catch {
    return { ok: false, error: "This template link is damaged or larger than 256 KB." };
  }
}
