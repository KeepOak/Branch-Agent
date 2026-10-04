// A part that failed to draw (DESIGN-SPEC §5.6, the preview's loadfailPA18): one place, Settings page, the side panel
// or the stage shows "This part didn't load" with Try again and Reload Branch, and the rest of the window keeps working.
// Moving to another place or page (a new `resetKey`) clears it.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { readLevel } from "../places-nav/SettingsFrame";

type Props = { children: ReactNode; label: string; resetKey?: string };
type State = { error: Error | null; tries: number; key: string | undefined };

export class PartBoundary extends Component<Props, State> {
  state: State = { error: null, tries: 0, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.label} didn't load`, error, info.componentStack);
  }

  render(): ReactNode {
    const { error, tries } = this.state;
    if (!error) return <PartKey key={tries}>{this.props.children}</PartKey>;
    return (
      <div className="status part-failed" role="alert" data-testid="part-failed">
        <span className="sdot bad" aria-hidden="true" />
        <div>
          <b>This part didn’t load</b>
          <p>Something went wrong while loading it.</p>
          <div className="acts">
            <button type="button" className="btn primary sm" onClick={() => this.setState({ error: null, tries: tries + 1 })}>Try again</button>
            <button type="button" className="btn ghost sm" onClick={() => location.reload()}>Reload Branch</button>
          </div>
          {readLevel() === "technical" ? (
            <details className="part-raw">
              <summary>Raw error</summary>
              <pre>{`${this.props.label}: ${error.message}`}</pre>
            </details>
          ) : null}
        </div>
      </div>
    );
  }
}

/** Remounts the part on Try again, so it reads the engine afresh. */
function PartKey({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
