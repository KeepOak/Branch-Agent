// The parts every setup step shares (DESIGN-SPEC §4.8.1 "Shell"): the 260 px rail with the 11 steps and
// "Skip for now", the body with its heading, and the footer. Focus moves to the heading on each new step;
// Tab stays inside; Escape skips except on Welcome.
import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "../shell/icons";
import { STEPS } from "./setup-model";
import { SetupBrand, StepPose } from "./SetupBrand";
import "./setup.css";

type Props = {
  step: number;
  /** The furthest step the rail lets the person jump to (later ones are disabled). */
  reach: number;
  /** Why later steps are disabled, as their tooltip. */
  reachReason?: string;
  done: (i: number) => boolean;
  onStep: (i: number) => void;
  onSkip: (() => void) | null;
  title: string;
  lede?: ReactNode;
  hero?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
};

function Rail({ step, reach, reachReason, done, onStep, onSkip }: Pick<Props, "step" | "reach" | "reachReason" | "done" | "onStep" | "onSkip">) {
  const current = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [step]);
  return (
    <aside className="ob-rail">
      <SetupBrand />
      <ol>
        {STEPS.map((name, i) => (
          <li key={name} className={i === step ? "now" : done(i) ? "done" : ""}>
            <button ref={i === step ? current : undefined} type="button" disabled={i > reach} title={i > reach ? reachReason : undefined} aria-current={i === step ? "step" : undefined} onClick={() => onStep(i)}>
              <em>{done(i) && i !== step ? <Icon name="check" size={12} /> : i + 1}</em>
              {name}
            </button>
          </li>
        ))}
      </ol>
      {onSkip ? (
        <button type="button" className="link ob-skip" data-testid="setup-skip" onClick={onSkip}>
          Skip for now
        </button>
      ) : null}
    </aside>
  );
}

/** Tab and Shift+Tab stay inside setup (§4.8.1 Keyboard). */
function trapTab(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "Tab") {
    return;
  }
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea, select, [tabindex='0']"));
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (e.shiftKey && i <= 0) {
    e.preventDefault();
    items[items.length - 1]?.focus();
  } else if (!e.shiftKey && i === items.length - 1) {
    e.preventDefault();
    items[0]?.focus();
  }
}

export function SetupShell(p: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [p.step]);
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && p.onSkip) {
      const box = e.target as HTMLElement;
      if ((box.tagName === "INPUT" || box.tagName === "TEXTAREA") && (box as HTMLInputElement).value) {
        box.blur(); // the first Escape only leaves a box that has text
        return;
      }
      e.preventDefault();
      p.onSkip();
      return;
    }
    trapTab(e);
  };
  return (
    <div className="ob9" role="dialog" aria-label="Set up Branch" data-testid="setup" onKeyDown={onKey}>
      <Rail {...p} />
      <section className="ob-main">
        <div className="ob-body">
          {p.hero ?? <StepPose step={p.step} />}
          <h2 tabIndex={-1} ref={heading}>
            {p.title}
          </h2>
          {p.lede ? <p>{p.lede}</p> : null}
          {p.children}
        </div>
        <footer className="ob-foot">{p.footer}</footer>
      </section>
    </div>
  );
}
