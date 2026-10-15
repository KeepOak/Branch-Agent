// A grafted agent with no conversation on this Branch yet. Its row never opens another Trunk's conversation in its place.
import { Face } from "../../face/Face";
import "../chat/chat.css";

export type GraftedState = "looking" | "none" | "error";

export function GraftedEmpty({ name, state }: { name: string; state: GraftedState }) {
  if (state === "looking") return <div className="r1c-empty" data-testid="grafted-empty" aria-busy="true" />;
  return <div className="r1c-empty" data-testid="grafted-empty">
    <Face size={72} label={name} state="idle" />
    <h1 className="r1c-empty-title">{state === "error" ? `Couldn’t load the conversations with ${name}.` : `No conversation with ${name} yet.`}</h1>
    {state === "none" ? <p className="r1c-empty-line">{name} is a grafted agent. Its conversations show here once it talks with one of your Trunks.</p> : null}
  </div>;
}
