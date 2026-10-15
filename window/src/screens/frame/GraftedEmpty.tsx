// A grafted agent with no conversation on this Branch yet. Its row never opens another Trunk's conversation in its place.
import type { CSSProperties } from "react";
import { InitialsFace } from "../../glass/Avatar";
import "../chat/chat.css";

export type GraftedState = "looking" | "none" | "error";

/** A grafted agent's face: the sidebar's dashed initials disc, never a Trunk's character. */
export function GraftedFace({ name, size }: { name: string; size: number }) {
  return <span style={{ width: size, height: size, display: "grid", "--s": `${size}px` } as CSSProperties}><InitialsFace name={name} kind="grafted" /></span>;
}

export function GraftedEmpty({ name, state }: { name: string; state: GraftedState }) {
  if (state === "looking") return <div className="r1c-empty" data-testid="grafted-empty" aria-busy="true" />;
  return <div className="r1c-empty" data-testid="grafted-empty">
    <GraftedFace name={name} size={72} />
    <h1 className="r1c-empty-title">{state === "error" ? `Couldn’t load the conversations with ${name}.` : `No conversation with ${name} yet.`}</h1>
    {state === "none" ? <p className="r1c-empty-line">{name} is a grafted agent. Its conversations show here once it talks with one of your Trunks.</p> : null}
  </div>;
}
