// A picture a reply names in its text (DESIGN-SPEC §4.2.2 "Pictures in messages"): `![alt](src)`, or a link to an
// image file. A path on the Trunk's computer (a screenshot it saved) shows inline, read through the engine's
// assistant-media route (`assistant.media.get`) with a short media ticket. A `data:` picture shows as is. A picture
// on the web is never fetched by itself: a reply can be steered by a page the Trunk read, and an image address can
// carry data out, so it stays a link the person can choose to open.
import { useEffect, useState } from "react";
import type { MediaPicture } from "../connect/session";
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

/** Whether a reply's picture shows inline; others stay links (see the file comment). */
export function showsInline(src: string): boolean {
  return isDataPicture(src) || isLocalPath(src);
}

const WHY: Record<"outside" | "unavailable", string> = { outside: "Outside allowed folders", unavailable: "Picture unavailable" };

/** Where a picture shows from: null while it loads. A local path goes to the engine as written (a `file:` address
 *  too: the engine reads it with its own file-URL rules). */
function usePicture(src: string, tick: number): MediaPicture | null {
  const { engine } = useThread();
  const [loaded, setLoaded] = useState<MediaPicture | null>(null);
  useEffect(() => {
    if (isDataPicture(src)) return;
    let live = true;
    setLoaded(null);
    const load = engine?.mediaPicture?.(src.trim()) ?? Promise.resolve<MediaPicture>({ error: "unavailable" });
    void load.then((result) => live && setLoaded(result));
    return () => {
      live = false;
    };
  }, [engine, src, tick]);
  return isDataPicture(src) ? { src: src.trim() } : loaded;
}

function Gone({ name, src, why, onRetry }: { name: string; src: string; why: "outside" | "unavailable"; onRetry: () => void }) {
  return (
    <span className="file-chip gone md-picture-gone" data-testid="picture-unavailable" title={src}>
      <span className="file-tile">IMG</span>
      <span className="file-text">
        <b>{name}</b>
        <small>{WHY[why]}</small>
      </span>
      {why === "unavailable" ? <button type="button" className="btn ghost sm" onClick={onRetry}>Try again</button> : null}
    </span>
  );
}

function LocalPicture({ src, name, inline }: { src: string; name: string; inline: boolean }) {
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  const picture = usePicture(src, tick);
  const retry = () => { setFailed(false); setTick((t) => t + 1); };
  if (!picture) return <span className={inline ? "md-inline-picture loading" : "md-picture-loading"} role="img" aria-label={`Loading ${name}`} data-testid="picture-loading" />;
  if ("error" in picture || failed) return <Gone name={name} src={src} why={"error" in picture ? picture.error : "unavailable"} onRetry={retry} />;
  if (inline) return <img className="md-inline-picture" src={picture.src} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  return <Attachments items={[{ kind: "image", name, src: picture.src, kept: true }]} onError={() => setFailed(true)} />;
}

export function MdImage({ src, alt, inline = false }: { src: string; alt: string; inline?: boolean }) {
  const name = alt.trim() || fileName(src);
  if (showsInline(src)) return <LocalPicture src={src} name={name} inline={inline} />;
  if (/^https?:\/\//i.test(src.trim())) return <a href={src.trim()} target="_blank" rel="noopener noreferrer" data-testid="picture-link">{name}</a>;
  return <span className="md-path" title={src}>{name}</span>;
}
