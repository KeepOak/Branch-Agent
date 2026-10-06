// A picture a reply names in its text (DESIGN-SPEC §4.2.2 "Pictures in messages"): `![alt](src)`, or a link to an
// image file. A path on the Trunk's computer (a screenshot it saved) shows inline, read through the engine's
// assistant-media route (`assistant.media.get`), which serves pictures of any real size. A `data:` picture shows as
// is. A picture on the web is never fetched by itself: a reply can be steered by a page the Trunk read, and an
// image address can carry data out, so it stays a link the person can choose to open.
import { useState } from "react";
import { Attachments } from "./Attachments";
import { useThread } from "./context";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/** A path on the Trunk's computer rather than a web address: /…, ~/…, C:\…, file:… */
export function isLocalPath(src: string): boolean {
  return /^(\/(?!\/)|~[\\/]|[A-Za-z]:[\\/]|file:)/.test(src.trim());
}

/** Whether a link's target is a picture (by its file type). */
export function isImageTarget(src: string): boolean {
  return IMAGE_EXT.test(src.trim().replace(/[?#].*$/, ""));
}

/** A picture whose bytes are already in the reply. */
const isDataPicture = (src: string): boolean => /^data:image\//i.test(src.trim());

function fileName(src: string): string {
  return src.replace(/[?#].*$/, "").split(/[\\/]/).filter(Boolean).at(-1) || "Picture";
}

/** Where a picture shows from, or null when it doesn't show by itself (a web address, or nothing to read it with). */
function useShownSource(src: string, tick: number): string | null {
  const { engine } = useThread();
  if (isDataPicture(src)) return src.trim();
  if (!isLocalPath(src)) return null;
  const url = engine?.mediaUrl?.(src.trim().replace(/^file:\/\//i, ""));
  return url ? (tick ? `${url}&try=${tick}` : url) : null;
}

/** Whether a reply's picture shows inline; others stay links (see the file comment). */
export function showsInline(src: string): boolean {
  return isDataPicture(src) || isLocalPath(src);
}

export function MdImage({ src, alt, inline = false }: { src: string; alt: string; inline?: boolean }) {
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  const shown = useShownSource(src, tick);
  const name = alt.trim() || fileName(src);
  if (!shown) {
    if (/^https?:\/\//i.test(src.trim())) return <a href={src.trim()} target="_blank" rel="noopener noreferrer" data-testid="picture-link">{name}</a>;
    return <span className="md-path" title={src}>{name}</span>;
  }
  if (failed) {
    return (
      <span className="file-chip gone md-picture-gone" data-testid="picture-unavailable" title={src}>
        <span className="file-tile">IMG</span>
        <span className="file-text">
          <b>{name}</b>
          <small>Picture unavailable</small>
        </span>
        <button type="button" className="btn ghost sm" onClick={() => { setFailed(false); setTick((t) => t + 1); }}>Try again</button>
      </span>
    );
  }
  if (inline) {
    return <img className="md-inline-picture" src={shown} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  return <Attachments items={[{ kind: "image", name, src: shown, kept: true }]} onError={() => setFailed(true)} />;
}
