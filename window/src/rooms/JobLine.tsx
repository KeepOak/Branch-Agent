// A Trunk job in a group room (rooms/job-feed.ts): one calm line with the job's latest state in plain words, and
// each transition with its time one click away. Hooks for the scripts: data-testid="job-line" and "job-steps".
import { useState } from "react";
import { fullTime, messageTime } from "../thread/format";
import type { Block } from "../thread/model";
import "./rooms.css";

type JobNotice = Extract<Block, { kind: "notice" }>;

export function JobLine({ block }: { block: JobNotice }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="jf" data-testid="job-line">
      <button type="button" className="jf-head" aria-expanded={open} title={block.at ? fullTime(block.at) : undefined} onClick={() => setOpen((on) => !on)}>
        {block.text}
      </button>
      {open ? (
        <ol className="jf-steps" data-testid="job-steps">
          {(block.steps ?? []).map((step) => (
            <li key={step.key}>
              <span>{step.text}</span>
              {step.at ? <time title={fullTime(step.at)}>{messageTime(step.at)}</time> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
