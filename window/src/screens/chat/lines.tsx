// The conversation's quiet lines (HANDOFF §2 #18–20): a centred time divider, the thin notice and the typing line.
import { useState, type ReactNode } from "react";
import { Face } from "../../face/Face";
import { Coming } from "../../glass/coming";
import { fullTime } from "../../thread/format";
import { dividerLabel } from "./chat-logic";

export function TimeDivider({ at }: { at: number }) {
  return <div className="r1c-time" role="separator" title={fullTime(at)} data-testid="time-divider">{dividerLabel(at)}</div>;
}

/** A link with "need" calls the engine and goes through Coming; without it the link is local. */
export type NoticeLink = { label: string; onClick: () => void; need?: string; reason?: string };

/** One centred line in --ink-3 with inline "· link" actions; glass only on hover. "details" opens below it. */
export function NoticeLine({ icon, text, links, details, tone, testid }: { icon?: ReactNode; text: ReactNode; links?: NoticeLink[]; details?: string; tone?: "bad"; testid?: string }) {
  const [open, setOpen] = useState(false);
  return <div className="r1c-notice" data-tone={tone} data-open={open || undefined} role={tone === "bad" ? "alert" : "status"} data-testid={testid ?? "notice-line"}>
    {icon ? <span className="r1c-notice-icon" aria-hidden="true">{icon}</span> : null}
    <span className="r1c-notice-text">{text}</span>
    {links?.map((link) => link.need
      ? <Coming key={link.label} need={link.need} reason={link.reason} where={link.label}><button type="button" className="r1c-link" onClick={link.onClick}>{link.label}</button></Coming>
      : <button key={link.label} type="button" className="r1c-link" data-local="" onClick={link.onClick}>{link.label}</button>)}
    {details ? <button type="button" className="r1c-link" data-local="" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Details</button> : null}
    {details && open ? <pre className="r1c-notice-details">{details}</pre> : null}
  </div>;
}

/** "Scout is thinking" and three dots, with the agent's 22 px face. People use the same words. */
export function TypingLine({ name }: { name: string }) {
  return <div className="r1c-typing" role="status" aria-label={(name || "The agent") + " is thinking"} data-testid="typing">
    <span className="r1c-typing-face"><Face size={22} label={name} state="think" priority={300} /></span>
    <span>{(name || "It") + " is thinking"}</span>
    <i /><i /><i />
  </div>;
}
