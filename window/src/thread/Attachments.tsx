// Attachments and media in messages (DESIGN-SPEC §4.2.2 "Pictures in messages", "File chip"; §4.2.6 "Media",
// "Media not kept", "Picture viewer"). Only what the engine's history carries is shown.
import { useEffect, useRef, useState } from "react";
import { clockLeft } from "./format";
import { Icon, ICONS } from "./icons";
import type { Attachment } from "./model";
import { PictureViewer } from "./PictureViewer";
import { useThread } from "./context";
import { isManagedAttachment, useAttachmentSources } from "./attachment-sources";

function sizeText(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extension(a: Attachment): string {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(a.name)?.[1];
  return (fromName ?? a.mimeType?.split("/")[1] ?? a.kind).slice(0, 4).toUpperCase();
}

/** Only one sound or video plays at a time (§4.2.6 rule 6). */
let playing: HTMLMediaElement | null = null;

function Player({ item, onError }: { item: Attachment; onError?: () => void }) {
  const media = useRef<HTMLAudioElement & HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [t, setT] = useState({ at: 0, length: 0 });
  useEffect(() => {
    const m = media.current;
    if (!m) return;
    const sync = () => setT({ at: m.currentTime, length: Number.isFinite(m.duration) ? m.duration : 0 });
    const end = () => {
      m.currentTime = 0; // it rewinds to 0:00 when it ends
      setOn(false);
    };
    m.addEventListener("timeupdate", sync);
    m.addEventListener("loadedmetadata", sync);
    m.addEventListener("ended", end);
    m.addEventListener("pause", () => setOn(false));
    m.addEventListener("play", () => setOn(true));
    return () => {
      m.removeEventListener("timeupdate", sync);
      m.removeEventListener("loadedmetadata", sync);
      m.removeEventListener("ended", end);
    };
  }, []);
  const toggle = () => {
    const m = media.current;
    if (!m) return;
    if (m.paused) {
      if (playing && playing !== m) playing.pause();
      playing = m;
      void m.play();
    } else m.pause();
  };
  const seek = (fraction: number) => {
    const m = media.current;
    if (m && t.length) m.currentTime = Math.max(0, Math.min(t.length, fraction * t.length));
  };
  const pct = t.length ? (t.at / t.length) * 100 : 0;
  const Tag = item.kind === "video" ? "video" : "audio";
  return (
    <div className={`player ${item.kind}`} data-testid="media-player">
      <Tag ref={media} src={item.src} preload="metadata" onError={onError} className={item.kind === "video" ? "poster" : "vh"} />
      <div className="player-row">
        <button type="button" className="play" aria-label={on ? "Pause" : "Play"} onClick={toggle}>
          <Icon d={on ? ICONS.pause : ICONS.play} />
        </button>
        <div
          className="track"
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(t.length)}
          aria-valuenow={Math.round(t.at)}
          onPointerDown={(e) => seek((e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.clientWidth)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") seek((t.at + (e.key === "ArrowLeft" ? -5 : 5)) / (t.length || 1));
          }}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="player-time">
          {clockLeft(t.at * 1000)} / {clockLeft(t.length * 1000)}
        </span>
      </div>
      <p className="player-name">
        <Icon d={ICONS.clip} size={12} />
        {item.name}
      </p>
    </div>
  );
}

function FileChip({ item }: { item: Attachment }) {
  const size = sizeText(item.sizeBytes);
  if (!item.kept) {
    return (
      <span className="file-chip gone" data-testid="media-gone">
        <span className="file-tile">{extension(item)}</span>
        <span className="file-text">
          <b>{item.name}</b>
          <small>Not kept in the history{size ? ` · ${size}` : ""}</small>
        </span>
      </span>
    );
  }
  return (
    <a className="file-chip" href={item.src} download={item.name} data-testid="file-chip">
      <span className="file-tile">{extension(item)}</span>
      <span className="file-text">
        <b>{item.name}</b>
        <small>{size || item.mimeType || item.kind}</small>
      </span>
    </a>
  );
}

/** The pictures, sounds, videos and files of one message. */
/** `onError`: a picture that didn't load (the caller can say so and offer Try again). `onLoad`: one that did. */
export function Attachments({ items, mine = false, onError, onLoad }: { items: Attachment[]; mine?: boolean; onError?: () => void; onLoad?: () => void }) {
  const { engine } = useThread();
  const resolved = useAttachmentSources(items, engine);
  const { sources } = resolved;
  const [open, setOpen] = useState<number | null>(null);
  const ready = items.flatMap((item) => {
    if (!isManagedAttachment(item)) return [item];
    const source = sources[item.artifactId!];
    return source && "src" in source ? [{ ...item, src: source.src, kept: true }] : [];
  });
  const pictures = ready.filter((a) => a.kind === "image" && a.kept);
  const failed = (item: Attachment) => { if (isManagedAttachment(item)) resolved.failed(item.artifactId!); else onError?.(); };
  const loaded = (item: Attachment) => { if (isManagedAttachment(item)) resolved.loaded(item.artifactId!); else onLoad?.(); };
  return (
    <div className={mine ? "attachments mine" : "attachments"}>
      {items.filter(isManagedAttachment).map((item, i) => {
        const source = sources[item.artifactId!];
        if (source && "src" in source) return null;
        if (!source) return <span key={`loading${i}`} role="status">Loading {item.name}…</span>;
        return <span key={`gone${i}`} className="file-chip gone" data-testid="attachment-unavailable">
          <span className="file-tile">{extension(item)}</span>
          <span className="file-text"><b>{item.name}</b><small>Attachment unavailable</small></span>
          <button type="button" className="btn ghost sm" onClick={() => resolved.retry(item.artifactId!)}>Try again</button>
        </span>;
      })}
      {pictures.map((p, i) => (
        <button key={`p${i}`} type="button" className="picture" onClick={() => setOpen(i)} aria-label={`Open ${p.name}`}>
          <img src={p.src} alt={p.name} loading="lazy" referrerPolicy="no-referrer" onError={() => failed(p)} onLoad={() => loaded(p)} />
        </button>
      ))}
      {ready
        .filter((a) => !(a.kind === "image" && a.kept))
        .map((a, i) => (a.kept && (a.kind === "audio" || a.kind === "video") ? <Player key={`m${i}`} item={a} onError={() => failed(a)} /> : <FileChip key={`f${i}`} item={a} />))}
      {open !== null && pictures[open] ? <PictureViewer items={pictures} start={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
