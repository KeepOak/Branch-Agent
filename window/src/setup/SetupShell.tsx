// The parts every setup step shares (DESIGN-SPEC §4.8.1 "Shell"): the 260 px rail with the 11 steps and
// "Skip for now", or the preview's centred glass card with step dots (no left rail). Focus moves to the heading
// on the rail and to the primary button on the card; Tab stays inside; Escape is Set up later when that is offered.
import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "../shell/icons";
import { STEPS } from "./setup-model";
import { SetupBrand, StepPose } from "./SetupBrand";
import "./setup.css";
import "./setup-card.css";

type Props = {
  /** The rail's step names; the full setup has eleven, the first-run card draws the preview's four. */
  steps?: readonly string[];
  /** Centred glass card with dots (first-run Welcome) instead of the 260 px rail. */
  variant?: "rail" | "card";
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
  /** Under the primary button: Set up later on every step, and Set up by talking on Welcome. */
  later?: ReactNode;
  /** A sheet (Where Branch runs) is open over the card; the card steps aside. */
  sheet?: boolean;
  overlay?: ReactNode;
  children: ReactNode;
};

function Rail({ steps = STEPS, step, reach, reachReason, done, onStep, onSkip }: Pick<Props, "steps" | "step" | "reach" | "reachReason" | "done" | "onStep" | "onSkip">) {
  return (
    <aside className="ob-rail">
      <SetupBrand />
      <ol>
        {steps.map((name, i) => (
          <li key={name} className={i === step ? "now" : done(i) ? "done" : ""}>
            <button type="button" disabled={i > reach} title={i > reach ? reachReason : undefined} aria-current={i === step ? "step" : undefined} onClick={() => onStep(i)}>
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
  const card = useRef<HTMLDivElement>(null);
  const cardLayout = p.variant === "card";
  useEffect(() => {
    if (cardLayout) {
      card.current?.querySelector<HTMLButtonElement>(".ob-foot .btn.pri")?.focus({ preventScroll: true });
      return;
    }
    heading.current?.focus({ preventScroll: true });
  }, [p.step, cardLayout]);
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
  const names = p.steps ?? STEPS;
  const later = p.later ? <div className="ob-later">{p.later}</div> : null;
  if (cardLayout) {
    return (
      <div className="ob9 ob-p37" role="dialog" aria-modal="true" aria-label="Set up Branch" data-testid="setup" data-sheet={p.sheet || undefined} onKeyDown={onKey}>
        <div className="ob-card" ref={card}>
          <div className="ob-dots" role="progressbar" aria-valuemin={1} aria-valuemax={names.length} aria-valuenow={p.step + 1} aria-label={`Step ${p.step + 1} of ${names.length}`}>
            {names.map((name, j) => (
              <i key={name} className={j === p.step ? "on" : j < p.step ? "done" : undefined} title={name} />
            ))}
          </div>
          <div className="ob-body">
            {p.hero ?? <StepPose step={p.step} />}
            <h1 tabIndex={-1} ref={heading}>
              {p.title}
            </h1>
            {p.lede ? <p className="ob-lede">{p.lede}</p> : null}
            {p.children}
          </div>
          <footer className="ob-foot">{p.footer}</footer>
          {later}
        </div>
        {p.overlay}
      </div>
    );
  }
  return (
    <div className="ob9" role="dialog" aria-label="Set up Branch" data-testid="setup" onKeyDown={onKey}>
      <Rail {...p} onSkip={p.later ? null : p.onSkip} />
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
        {later}
      </section>
      {p.overlay}
    </div>
  );
}
