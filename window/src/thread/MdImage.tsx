// A picture a reply names in its text (DESIGN-SPEC §4.2.2 "Pictures in messages"): `![alt](src)`, or a link to an
// image file. A web or data address shows as is; a path on the Trunk's computer (a screenshot it saved) is read
// through the conversation's file access (`sessions.files.get`, base64 for images) and shown as a picture card.
import { useEffect, useState } from "react";
import { Attachments } from "./Attachments";
import { useThread } from "./context";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/** A path on the Trunk's computer rather than a web address: /…, ~/…, C:\…, file:… */
export function isLocalPath(src: string): boolean {
  return /^(\/(?!\/)|~[\\/]|[A-Za-z]:[\\/]|file:)/.test(src.trim());
}

/** Whether a link's target is a picture (by its file type), so it shows as one instead of as a link. */
export function isImageTarget(src: string): boolean {
  return IMAGE_EXT.test(src.trim().replace(/[?#].*$/, ""));
}

function fileName(src: string): string {
  return src.replace(/[?#].*$/, "").split(/[\\/]/).filter(Boolean).at(-1) || "Picture";
}

type Loaded = { src: string } | { error: string } | null;

function reasonOf(error: unknown): string {
  const details = rec(rec(error).details);
  return str(details.reason) === "outside_session_boundary" ? "Outside allowed folders" : "Picture unavailable";
}

/** Reads a local picture as a data address, or says why it can't show. */
function useLocalPicture(src: string, tick: number): Loaded {
  const { engine } = useThread();
  const [loaded, setLoaded] = useState<Loaded>(null);
  useEffect(() => {
    if (!isLocalPath(src)) return;
    if (!engine?.sessionKey) {
      setLoaded({ error: "Picture unavailable" });
      return;
    }
    let live = true;
    setLoaded(null);
    const path = src.trim().replace(/^file:\/\//i, "");
    engine.request("sessions.files.get", { sessionKey: engine.sessionKey, path, ...(engine.agentId ? { agentId: engine.agentId } : {}) }).then(
      (result) => {
        const file = rec(rec(result).file);
        const mime = str(file.mimeType);
        if (!live) return;
        if (file.contentEncoding === "base64" && mime.startsWith("image/") && str(file.content)) setLoaded({ src: `data:${mime};base64,${str(file.content)}` });
        else setLoaded({ error: file.missing === true ? "Picture not found" : "Picture unavailable" });
      },
      (error: unknown) => live && setLoaded({ error: reasonOf(error) }),
    );
    return () => {
      live = false;
    };
  }, [engine, src, tick]);
  return isLocalPath(src) ? loaded : { src };
}

export function MdImage({ src, alt }: { src: string; alt: string }) {
  const [tick, setTick] = useState(0);
  const loaded = useLocalPicture(src, tick);
  const name = alt.trim() || fileName(src);
  if (!loaded) return <span className="md-picture-loading" role="img" aria-label={`Loading ${name}`} data-testid="picture-loading" />;
  if ("error" in loaded) {
    return (
      <span className="file-chip gone md-picture-gone" data-testid="picture-unavailable" title={src}>
        <span className="file-tile">IMG</span>
        <span className="file-text">
          <b>{name}</b>
          <small>{loaded.error}</small>
        </span>
        {loaded.error === "Picture unavailable" ? <button type="button" className="btn ghost sm" onClick={() => setTick((t) => t + 1)}>Try again</button> : null}
      </span>
    );
  }
  return <Attachments items={[{ kind: "image", name, src: loaded.src, kept: true }]} />;
}
