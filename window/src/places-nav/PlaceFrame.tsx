import { useRef, type ReactNode } from "react";
import type { WindowEngine } from "../connect/engine";
import type { Level } from "./level";
import type { PlaceId } from "./routes";
import { useScrollMemory } from "./scroll-memory";

/** What the shell hands every place (§4.6). Places add what they need; the shell keeps these working. */
export type PlaceProps = {
  engine: WindowEngine;
  /** Facts the shell already holds, so a place never shows a claim it cannot check. */
  facts: { running: number; waiting: number };
  openConversation: (key: string) => void;
  openPlace: (place: PlaceId) => void;
  openSettings?: (page: string) => void;
  /** Starts a new conversation with a Trunk (the shell's own "new conversation"), e.g. right after Add a Trunk. */
  startConversation?: (agentId?: string) => void;
  /** Opens the shell's real New Trunk flow, including preview and first conversation. */
  createTrunk?: () => void;
  /** "How much to show" (Settings): rows marked [A] show from Advanced, [T] only at Technical. */
  level: Level;
};

/** The shared overflow for every place, including Library and Canopy which draw their own head. */
export function PlaceScroll({ children }: { children?: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  useScrollMemory(scroller);
  return (
    <div className="place-scroll" data-testid="place" ref={scroller}>
      {children}
    </div>
  );
}

/** The shared place frame (DESIGN-SPEC §4.6.0): one h1, one lede, then the place's own content. `top` spans the
 *  whole area above the place column (Overview's "Finish setting up", as the preview puts it at the top of main). */
/*  `before` sits inside the place column above the h1 (the recommendation bar on Overview and Inbox). */
export function PlaceFrame({ title, lede, wide, children, top, before }: { title: string; lede: string; wide?: "overview" | "tools"; children?: ReactNode; top?: ReactNode; before?: ReactNode }) {
  return (
    <PlaceScroll>
      {top}
      <div className={wide ? `place wide-${wide}` : "place"}>
        {before}
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        {children}
      </div>
    </PlaceScroll>
  );
}

/** A tab's empty line (§4.6.0 Empty line): a line icon above plain words. */
export function EmptyLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="empty-line">
      {icon}
      <p>{children}</p>
    </div>
  );
}
