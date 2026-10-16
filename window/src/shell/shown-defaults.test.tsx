// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { useCheerOn, usePetLook } from "./shown";

const look = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ subscribe: () => () => undefined, get snap() { return { look: look.value }; } }) }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { document.body.innerHTML = ""; look.value = {}; });

function Probe() {
  const pet = usePetLook({} as WindowEngine);
  const cheer = useCheerOn({} as WindowEngine);
  return <p data-pet={pet.id} data-cheer={String(cheer)} />;
}

async function read(): Promise<{ pet: string | undefined; cheer: string | undefined }> {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<Probe />));
  const el = host.querySelector<HTMLElement>("p")!;
  const out = { pet: el.dataset.pet, cheer: el.dataset.cheer };
  await act(async () => root.unmount());
  return out;
}

describe("defaults: no pet and no done cheer until the person turns them on", () => {
  it("has no pet and no cheer when nothing is picked", async () => {
    look.value = {};
    expect(await read()).toEqual({ pet: "none", cheer: "false" });
  });

  it("shows the pet and the cheer once they are picked or switched on", async () => {
    look.value = { pet: "otter", cheer: true };
    expect(await read()).toEqual({ pet: "otter", cheer: "true" });
  });
});
