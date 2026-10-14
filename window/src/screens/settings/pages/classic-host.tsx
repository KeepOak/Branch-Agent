// Settings pages re-hosted from Classic: the R1 Settings frame draws the Classic page's own sections (the same code the
// Classic frame draws, so every working control comes along) with the frame's engine and "How much to show", Classic's
// save line, setup lock and row pins, on R1 glass. A re-hosted page adds its Classic rows to the R1 row table, so the
// R1 search finds them and opens the page. A page moves to its own R1 rows later without losing anything on the way.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Coming } from "../../../glass/coming";
import { SETTINGS_ROWS, SettingsPage } from "../../../places/settings";
import { errorText, visible } from "../../../places/settings/adapter";
import { KitProvider, SetupLock, type SaveReport } from "../../../places/settings/kit";
import { usePins, type Pin } from "../../../places/settings/pins";
import { HIDDEN_PAGES, SETUP_PAGES, pageName } from "../../../places-nav/settings-nav";
import { Icon } from "../../../shell/icons";
import { PAGES, pageFor, sectionNeed, type PageId } from "../nav";
import type { Row } from "../rows";
import { SECTION_COMING, useLevel } from "../SettingsFrame";
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

/** Classic page ids a hosted Classic page draws in place as its own tab, so choosing that tab stays on the R1 page:
 *  Models' Local tab (Classic models, local and accounts share one tabbed page; Accounts opens the R1 Accounts page). */
export const IN_PLACE: Readonly<Record<string, readonly string[]>> = { models: ["local"] };

/** The Classic pages a hosted R1 page draws, in order. */
export const classicList = (classic: string | readonly string[]): readonly string[] => (typeof classic === "string" ? [classic] : classic);

/** The Classic page `classic` (or pages, one after another), drawn as the R1 page `page`. `coming` names the page's
 *  cards no Classic control does yet: each is Coming after the Classic sections, naming the call it waits for. */
export function ClassicHost({ engine, page, classic, coming, onPage }: { engine: WindowEngine; page: PageId; classic: string | readonly string[]; coming?: readonly string[]; onPage?: (page: PageId) => void }) {
  const list = classicList(classic);
  const [level] = useLevel(engine);
  const [save, report] = useSaveState();
  // Before the engine says hello the scopes aren't known yet: nothing is greyed until they are (as in Classic).
  const maySetup = engine.scopes.length === 0 || engine.scopes.includes("operator.admin");
  const inPlace = list.flatMap((id) => IN_PLACE[id] ?? []).join(" ");
  const open = useCallback((id: string) => { if (!inPlace.split(" ").includes(id)) onPage?.(pageFor(id)); }, [onPage, inPlace]);
  const runSave = useCallback((run: () => Promise<unknown>) => {
    report.saving();
    run().then(report.saved, (error: unknown) => report.failed(errorText(error)));
  }, [report]);
  const goPin = useCallback((pin: Pin) => open(pin[0]), [open]);
  const pins = usePins(engine, list[0], level, runSave, goPin);
  return (
    <div className="settings r1s-classic" data-classic={list.join(" ")}>
      <div className="set-col">
        <p className={`set-save r1s-classic-save g-label${save?.kind === "failed" ? " bad" : ""}`} role="status" aria-live="polite" hidden={!save}>
          {save?.kind === "saved" ? <><Icon name="check" small />Saved</> : save?.kind === "saving" ? "Saving…" : save?.kind === "failed" ? `Not saved: ${visible(save.message)}` : null}
        </p>
        <KitProvider level={level} report={report} scope={null} pins={pins}>
          {list.map((id, i) => {
            const title = i === 0 ? PAGES[page].title : pageName(id);
            // Classic leaves these pages out without operator.admin; R1 keeps the page in the nav, so it says why it is empty.
            if (!maySetup && HIDDEN_PAGES.includes(id)) {
              return <div key={id} className="r1s-classic-part"><h1>{title}</h1><p className="g-label" data-lines role="status">{ADMIN_ONLY}</p></div>;
            }
            return (
              <div key={id} className="r1s-classic-part">
                <SetupLock locked={!maySetup && SETUP_PAGES.includes(id)}>
                  <SettingsPage page={id} title={title} level={LEVEL_WORD[level]} engine={engine} openSettings={open} />
                </SetupLock>
              </div>
            );
          })}
        </KitProvider>
        {coming?.map((card) => (
          <section key={card} className="sec r1s-classic-coming" aria-label={card}>
            <h2>{card}</h2>
            <Coming engine={engine} need={sectionNeed(page, card)} unwired reason={SECTION_COMING(card)} where={`${PAGES[page].title} › ${card}`}>
              <div className="r1s-row"><b className="g-label">Coming</b><small className="r1s-note g-label" data-lines>{SECTION_COMING(card)}</small></div>
            </Coming>
          </section>
        ))}
      </div>
    </div>
  );
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The Classic pages' search rows as R1 rows of `page`, so the R1 search finds them: one per title and section. */
export function classicRows(page: PageId, classic: string | readonly string[]): Row[] {
  const seen = new Set<string>();
  const list = classicList(classic);
  return SETTINGS_ROWS.filter((r) => list.includes(r.page)).flatMap((r) => {
    const id = `${page}.classic.${slug(r.sec ?? r.group)}.${slug(r.title)}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, page, card: r.sec ?? r.group, label: r.title, level: r.lv, ownerLevel: true, control: "custom", source: { kind: "slot", calls: [], reason: "Drawn by the page." } } satisfies Row];
  });
}

/** A Settings slot that re-hosts the Classic page `classic` (or pages) as the R1 page `page`, with its `coming` cards. */
export function classicSlot(page: PageId, classic: string | readonly string[], coming?: readonly string[]): PageSlot {
  return {
    component: ({ engine, onPage }) => <ClassicHost engine={engine} page={page} classic={classic} coming={coming} onPage={onPage} />,
    rows: classicRows(page, classic),
  };
}
