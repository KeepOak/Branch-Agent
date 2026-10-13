// Settings pages re-hosted from Classic: the R1 Settings frame draws the Classic page's own sections (the same code the
// Classic frame draws, so every working control comes along) with the frame's engine and "How much to show", Classic's
// save line, setup lock and row pins, on R1 glass. A re-hosted page adds its Classic rows to the R1 row table, so the
// R1 search finds them and opens the page. A page moves to its own R1 rows later without losing anything on the way.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { SETTINGS_ROWS, SettingsPage } from "../../../places/settings";
import { errorText, visible } from "../../../places/settings/adapter";
import { KitProvider, SetupLock, type SaveReport } from "../../../places/settings/kit";
import { usePins, type Pin } from "../../../places/settings/pins";
import { HIDDEN_PAGES, SETUP_PAGES } from "../../../places-nav/settings-nav";
import { Icon } from "../../../shell/icons";
import { PAGES, pageFor, type PageId } from "../nav";
import type { Row } from "../rows";
import { useLevel } from "../SettingsFrame";
import type { PageSlot } from "../slots";
import "./classic-host.css";

const LEVEL_WORD = ["regular", "advanced", "technical"] as const;
/** A page Classic hides without operator.admin. */
export const ADMIN_ONLY = "This page needs a connection to Branch that may change its setup. Open it on the computer Branch runs on.";

type SaveState = { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string } | null;

/** Classic's save line: "Saving…", then "Saved" for 2 s, or what went wrong until the next change. */
function useSaveState(): [SaveState, SaveReport] {
  const [state, setState] = useState<SaveState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const report = useMemo<SaveReport>(() => ({
    saving: () => { clearTimeout(timer.current); setState({ kind: "saving" }); },
    saved: () => { clearTimeout(timer.current); setState({ kind: "saved" }); timer.current = setTimeout(() => setState(null), 2000); },
    failed: (message) => { clearTimeout(timer.current); setState({ kind: "failed", message }); },
  }), []);
  return [state, report];
}

/** The Classic page `classic`, drawn as the R1 page `page`. */
export function ClassicHost({ engine, page, classic, onPage }: { engine: WindowEngine; page: PageId; classic: string; onPage?: (page: PageId) => void }) {
  const [level] = useLevel(engine);
  const [save, report] = useSaveState();
  // Before the engine says hello the scopes aren't known yet: nothing is greyed until they are (as in Classic).
  const maySetup = engine.scopes.length === 0 || engine.scopes.includes("operator.admin");
  const open = useCallback((id: string) => onPage?.(pageFor(id)), [onPage]);
  const runSave = useCallback((run: () => Promise<unknown>) => {
    report.saving();
    run().then(report.saved, (error: unknown) => report.failed(errorText(error)));
  }, [report]);
  const goPin = useCallback((pin: Pin) => open(pin[0]), [open]);
  const pins = usePins(engine, classic, level, runSave, goPin);
  // Classic leaves these pages out without operator.admin; R1 keeps them in the nav, so the page says why it is empty.
  if (!maySetup && HIDDEN_PAGES.includes(classic)) {
    return (
      <div className="settings r1s-classic" data-classic={classic}>
        <div className="set-col">
          <h1>{PAGES[page].title}</h1>
          <p className="g-label" data-lines role="status">{ADMIN_ONLY}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="settings r1s-classic" data-classic={classic}>
      <div className="set-col">
        <p className={`set-save r1s-classic-save g-label${save?.kind === "failed" ? " bad" : ""}`} role="status" aria-live="polite" hidden={!save}>
          {save?.kind === "saved" ? <><Icon name="check" small />Saved</> : save?.kind === "saving" ? "Saving…" : save?.kind === "failed" ? `Not saved: ${visible(save.message)}` : null}
        </p>
        <KitProvider level={level} report={report} scope={null} pins={pins}>
          <SetupLock locked={!maySetup && SETUP_PAGES.includes(classic)}>
            <SettingsPage page={classic} title={PAGES[page].title} level={LEVEL_WORD[level]} engine={engine} openSettings={open} />
          </SetupLock>
        </KitProvider>
      </div>
    </div>
  );
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The Classic page's search rows as R1 rows of `page`, so the R1 search finds them: one per title and section. */
export function classicRows(page: PageId, classic: string): Row[] {
  const seen = new Set<string>();
  return SETTINGS_ROWS.filter((r) => r.page === classic).flatMap((r) => {
    const id = `${page}.classic.${slug(r.sec ?? r.group)}.${slug(r.title)}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, page, card: r.sec ?? r.group, label: r.title, level: r.lv, ownerLevel: true, control: "custom", source: { kind: "slot", calls: [], reason: "Drawn by the page." } } satisfies Row];
  });
}

/** A Settings slot that re-hosts the Classic page `classic` as the R1 page `page`. */
export function classicSlot(page: PageId, classic: string): PageSlot {
  return {
    component: ({ engine, onPage }) => <ClassicHost engine={engine} page={page} classic={classic} onPage={onPage} />,
    rows: classicRows(page, classic),
  };
}
