// Settings › every row › pin (UI-DESKTOP-0369): a small pin on each Settings row; pinned rows show at the top of
// General with "Go to it" and "Unpin". The list is the person's own, kept in users.prefs "ui.window.look" as "pins"
// ([page, row title, level] each), through the window's look store, so it follows them to every device.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { WindowEngine } from "../../connect/engine";
import { pageName } from "../../places-nav/settings-nav";
import { lookStore } from "./set1/appearance-store";
import { Btn, Ctl, Sec, type Lv } from "./kit";

export type Pin = [page: string, title: string, lv: Lv];
/** What a row needs to draw its pin, and what the Pinned list needs. */
export type Pins = {
  page: string;
  list: Pin[];
  has: (title: string) => boolean;
  toggle: (title: string) => void;
  go: (pin: Pin) => void;
  unpin: (pin: Pin) => void;
};

/** Rows with longer titles than this get no pin (the preview's limit). */
export const PIN_MAX = 70;

/** The pins from a look record: well-formed entries only. */
export function pinsOf(look: Record<string, unknown>): Pin[] {
  const raw = Array.isArray(look.pins) ? look.pins : [];
  return raw.flatMap((p): Pin[] => (Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string" ? [[p[0], p[1], p[2] === 1 || p[2] === 2 ? p[2] : 0]] : []));
}

/** The pins for the shown page; `save` reports the change on the frame's save line, `go` opens a pinned row. */
export function usePins(engine: WindowEngine, page: string, level: Lv, save: (run: () => Promise<unknown>) => void, go: (pin: Pin) => void): Pins {
  const store = lookStore(engine);
  const look = useSyncExternalStore((fn) => store.subscribe(fn), () => store.snap.look, () => store.snap.look);
  const list = useMemo(() => pinsOf(look), [look]);
  const put = useCallback((next: Pin[]) => save(() => store.set("pins", next.length ? next : null)), [save, store]);
  const has = useCallback((title: string) => list.some((p) => p[0] === page && p[1] === title), [list, page]);
  const unpin = useCallback((pin: Pin) => put(list.filter((p) => !(p[0] === pin[0] && p[1] === pin[1]))), [list, put]);
  const toggle = useCallback((title: string) => (has(title) ? unpin([page, title, level]) : put([...list, [page, title, level]])), [has, unpin, put, list, page, level]);
  return { page, list, has, toggle, go, unpin };
}

/** General's Pinned section: each pinned row with the page it lives on. */
export function PinnedSection({ pins }: { pins?: Pins }) {
  if (!pins?.list.length) return null;
  return (
    <Sec title="Pinned">
      {pins.list.map((p) => (
        <Ctl key={`${p[0]}|${p[1]}`} title={p[1]} sub={pageName(p[0])} noPin>
          <Btn sm ghost onClick={() => pins.go(p)}>Go to it</Btn>
          <Btn sm ghost onClick={() => pins.unpin(p)}>Unpin</Btn>
        </Ctl>
      ))}
    </Sec>
  );
}
