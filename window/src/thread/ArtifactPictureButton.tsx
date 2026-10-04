import { useEffect, useRef, useState, type MouseEvent } from "react";
import { chartPng, downloadChartPicture } from "./artifact-chart-picture";

export function ArtifactPictureButton({ title }: { title: string }) {
  const [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const lifetime = useRef({ active: true }), pending = useRef(false);
  useEffect(() => {
    const ticket = { active: true }; lifetime.current = ticket; pending.current = false; setBusy(false); setNotice("");
    return () => { ticket.active = false; };
  }, [title]);
  async function save(event: MouseEvent<HTMLButtonElement>) {
    if (pending.current) return;
    const svg = event.currentTarget.closest(".artifact-chart")?.querySelector("svg");
    if (!svg) { setNotice("The chart is no longer available."); return; }
    const ticket = lifetime.current;
    pending.current = true; setBusy(true); setNotice("");
    try {
      const picture = await chartPng(svg);
      if (!ticket.active || lifetime.current !== ticket) return;
      downloadChartPicture(picture, title); setNotice("Picture download started.");
    } catch (error) {
      if (ticket.active && lifetime.current === ticket) setNotice(error instanceof Error ? error.message : String(error));
    } finally { if (ticket.active && lifetime.current === ticket) { pending.current = false; setBusy(false); } }
  }
  return <><button type="button" className="btn sm" disabled={busy} onClick={event => void save(event)}>{busy ? "Making picture…" : "Save as a picture"}</button>
    {notice && <p className="artifact-preview-note" role="status">{notice}</p>}</>;
}
