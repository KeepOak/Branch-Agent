// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BranchOverlay } from "./pixel/webview-ui/src/branch/BranchOverlay";
import { generateBranchLayout } from "./pixel/webview-ui/src/branch/branchLayout";
import type { BranchServer } from "./pixel/webview-ui/src/branch/branchServer";
import type { OfficeState } from "./pixel/webview-ui/src/office/engine/officeState";
import { overlayProjection } from "./pixel/webview-ui/src/office/projection";
import { CharacterState, Direction, TILE_SIZE, type Seat } from "./pixel/webview-ui/src/office/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Footprints from the bundled furniture manifests (DESK, PC, CUSHIONED_CHAIR), so the test does not decode PNGs.
vi.mock("./pixel/webview-ui/src/office/layout/furnitureCatalog", () => {
  const sizes: Record<string, [number, number]> = { DESK_FRONT: [3, 2], PC_BACK: [1, 2], CUSHIONED_CHAIR_FRONT: [1, 1] };
  return {
    getCatalogEntry: (type: string) => {
      const s = sizes[type] ?? [1, 1];
      return { type, footprintW: s[0], footprintH: s[1] };
    },
  };
});

afterEach(() => { document.body.replaceChildren(); });

const NAMES = ["C3-PO", "Builder", "Planner", "Researcher"];
const ZOOM = 3;

function office(walking: Set<number>) {
  const layout = generateBranchLayout({ trunks: NAMES.length, guests: 0, wide: true });
  const seats = new Map<string, Seat>();
  for (const f of layout.furniture) {
    if (f.uid.startsWith("seat-")) seats.set(f.uid, { uid: f.uid, seatCol: f.col, seatRow: f.row, facingDir: Direction.DOWN, assigned: true });
  }
  const characters = new Map(NAMES.map((_, id) => {
    const seat = seats.get(`seat-${id}`)!;
    const path = walking.has(id) ? [{ col: seat.seatCol, row: seat.seatRow + 2 }] : [];
    return [id, {
      id, state: walking.has(id) ? CharacterState.WALK : CharacterState.TYPE, seatId: seat.uid, path,
      tileCol: seat.seatCol, tileRow: seat.seatRow,
      x: seat.seatCol * TILE_SIZE + TILE_SIZE / 2, y: seat.seatRow * TILE_SIZE + TILE_SIZE / 2,
      isSubagent: false, parentAgentId: null, matrixEffect: null,
    }];
  }));
  const officeState = { characters, seats, getLayout: () => layout, hoveredAgentId: null, selectedAgentId: null } as unknown as OfficeState;
  const server = {
    agentFor: (n: number) => ({ id: `t${n}`, name: NAMES[n], kind: "trunk", state: "working" }),
    groups: () => [],
  } as unknown as BranchServer;
  return { layout, officeState, server };
}

async function plates(walking = new Set<number>()) {
  const { layout, officeState, server } = office(walking);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<BranchOverlay officeState={officeState} server={server} subagentCharacters={[]} containerRef={{ current: container }}
      zoom={ZOOM} panRef={{ current: { x: 0, y: 0 } }} showNames hidden={false} onOpen={() => undefined} />);
  });
  const project = overlayProjection(layout, container.getBoundingClientRect(), ZOOM, { x: 0, y: 0 }, window.devicePixelRatio || 1);
  const bottomOf = (uid: string) => {
    const f = layout.furniture.find((x) => x.uid === uid)!;
    return project.toScreenY((f.row + 2) * TILE_SIZE);
  };
  const found = [...container.querySelectorAll<HTMLElement>("[data-testid=name-plate]")].map((el, i) => ({
    name: el.textContent, top: parseFloat(el.style.top), deskBottom: bottomOf(`desk-${i}`), pcBottom: bottomOf(`pc-${i}`),
    feet: project.toScreenY(layout.furniture.find((x) => x.uid === `seat-${i}`)!.row * TILE_SIZE + TILE_SIZE / 2),
  }));
  await act(async () => root.unmount());
  return found;
}

it("hangs each seated Trunk's name plate under its desk and monitor, never over them", async () => {
  const found = await plates();
  expect(found.map((p) => p.name)).toEqual(NAMES);
  for (const p of found) {
    expect(p.top, `${p.name} plate top vs desk bottom`).toBeGreaterThanOrEqual(p.deskBottom);
    expect(p.top, `${p.name} plate top vs monitor bottom`).toBeGreaterThanOrEqual(p.pcBottom);
  }
});

it("keeps the plate at the feet of a Trunk walking away from its desk", async () => {
  const found = await plates(new Set([1]));
  expect(found[1]!.top).toBeLessThan(found[1]!.deskBottom);
  expect(found[0]!.top).toBeGreaterThanOrEqual(found[0]!.deskBottom);
});
