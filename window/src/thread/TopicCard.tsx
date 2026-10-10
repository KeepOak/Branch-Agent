import { useState } from "react";
import type { Topic } from "@branch/gateway-protocol";
import { useThread } from "./context";
import { messageTime } from "./format";
import type { Block } from "./model";
import "./job-card.css";

export type TopicUpdate = {
  topic: Topic;
  text: string;
  at: number;
  unread: boolean;
  state?: "working" | "needs" | "done" | "stuck";
  reason?: string;
  steps?: string[];
};

/** Preview ST_T5 words (spec-v23:40794). `open` is the app stand-in for raw `active` / unknown. */
const ST_T5: Record<string, string> = {
  working: "working",
  needs: "needs your yes",
  done: "done",
  stuck: "stuck",
  moved: "moved to main",
  open: "open",
};

/** Working topics in the preview default to 40% (`jobFromTopicT5`) until WindowShell fills real progress. */
const WORKING_BAR = 40;

type JobState = "working" | "needs" | "done" | "stuck" | "moved" | "open";

/** Prefer the later `state` field; otherwise map `topic.status`. Never surface raw `active`. */
export function jobStateOf(update: TopicUpdate): JobState {
  if (update.state) return update.state;
  if (update.topic.status === "working") return "working";
  if (update.topic.status === "waiting") return "needs";
  if (update.topic.status === "done") return "done";
  return "open";
}

function jobSummary(update: TopicUpdate): string {
  return update.state === "stuck" && update.reason ? update.reason : update.text;
}

function stepParts(step: string): { lead: string; rest: string } {
  const [lead, ...rest] = step.split(" · ");
  return { lead: lead ?? step, rest: rest.join(" · ") };
}

/** Find the last thread item at or before a topic event; -1 means before the first item. */
export function topicPosition(history: readonly Block[], at: number, afterMessageId?: string): number {
  if (afterMessageId) {
    const exact = history.findIndex((block) => block.key === afterMessageId || ((block.kind === "user" || block.kind === "text") && block.meta?.entryId === afterMessageId));
    if (exact >= 0) return exact;
  }
  let position = -1;
  let observedTime = false;
  history.forEach((block, index) => {
    const stamp = block.kind === "user" || block.kind === "text" ? block.meta?.timestamp : undefined;
    const time = stamp ?? NaN;
    if (Number.isFinite(time)) observedTime = true;
    if (Number.isFinite(time) && time <= at) position = index;
  });
  return position < 0 && !observedTime && history.length ? history.length - 1 : position;
}

export function TopicOrigin({ topic, onOpen }: { topic: Topic; onOpen: (key: string) => void }) {
  return <button type="button" className="topic-origin" onClick={() => onOpen(topic.key)}>Started a thread: {topic.title}</button>;
}

export function TopicCard({ update, onOpen }: { update: TopicUpdate; onOpen: (key: string) => void }) {
  const { name } = useThread();
  const [open, setOpen] = useState(false);
  const state = jobStateOf(update);
  const working = state === "working";
  const time = Number.isFinite(update.at) && update.at > 0 ? messageTime(update.at) : "";
  return (
    <div className={`jobT5${open ? " open" : ""}`} data-testid={`topic-card-${update.topic.key}`}>
      <button type="button" className="jobTopT5" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="jobTitleT5">
          {working ? <span className="spinT5" aria-hidden="true" /> : null}
          <span>{update.topic.title}</span>
        </span>
        <span className={`pillT5 p-${state}`}>{ST_T5[state] ?? "open"}</span>
        <span className="jobSumT5">{jobSummary(update)}</span>
        {working ? <span className="barT5"><i style={{ width: `${WORKING_BAR}%` }} /></span> : null}
        <span className="chipsT5">
          {name ? <span className="chipT5">{name}</span> : null}
          {time ? <span className="chipT5">{time}</span> : null}
        </span>
      </button>
      <div className="jobBodyT5" hidden={!open}>
        {(update.steps ?? []).map((step, index) => {
          const parts = stepParts(step);
          return (
            <div className="stepT5" key={`${index}:${step}`}>
              <span>{parts.lead}</span>
              {parts.rest ? <> <small>{parts.rest}</small></> : null}
            </div>
          );
        })}
        <div className="jobActsT5">
          <button type="button" className="btn sm" onClick={() => onOpen(update.topic.key)}>Open the conversation</button>
        </div>
      </div>
    </div>
  );
}
