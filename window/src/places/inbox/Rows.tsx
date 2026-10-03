// The Inbox's row and card anatomy (preview .prow / .rev17d stPD18): a lead (face or icon tile), a title and
// sub-line, then the row's buttons.
import type { ReactNode } from "react";
import { G, type Glyph } from "./glyphs";

export function Tile({ icon }: { icon: Glyph }) {
  return <span className="ib-tile"><G name={icon} /></span>;
}

export function InboxRow({ lead, title, sub, extra, unread, children, testid }: { lead: ReactNode; title: ReactNode; sub?: ReactNode; extra?: ReactNode; unread?: boolean; children?: ReactNode; testid?: string }) {
  return (
    <div className={unread ? "ib-row ib-unread" : "ib-row"} data-testid={testid}>
      {unread ? <i className="ib-udot" role="img" aria-label="Unread" /> : null}
      {lead}
      <span className="ib-grow"><b>{title}</b>{sub ? <small>{sub}</small> : null}{extra}</span>
      {children ? <span className="ib-acts">{children}</span> : null}
    </div>
  );
}

export function StatusCard({ icon, lead, title, sub, tone, children }: { icon: Glyph; lead?: ReactNode; title: string; sub: string; tone?: "warn" | "bad"; children?: ReactNode }) {
  return (
    <div className={tone ? `ib-card ${tone}` : "ib-card"} role="status">
      {lead ?? <Tile icon={icon} />}
      <span className="ib-grow"><b>{title}</b><small>{sub}</small></span>
      {children ? <span className="ib-acts">{children}</span> : null}
    </div>
  );
}

export function minutesAgo(at: number | undefined, now = Date.now()): string {
  if (at === undefined) return "";
  const m = Math.max(0, Math.round((now - at) / 6e4));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

export function minutesLeft(at: number | undefined, now = Date.now()): string {
  if (at === undefined) return "";
  const m = Math.max(0, Math.round((at - now) / 6e4));
  return m < 60 ? `expires in ${m} min` : `expires in ${Math.round(m / 60)} h`;
}
