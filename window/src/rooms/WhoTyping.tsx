// Preview whoTypT5 (#31): "<name> is typing…" beside the dots in a group.
import { whoTypingLine } from "./who-typing";
import "./rooms.css";

export function WhoTyping({ name }: { name: string }) {
  return <small className="whoTypT5">{whoTypingLine(name)}</small>;
}
