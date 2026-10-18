// @vitest-environment jsdom
// Private #1089: Overview › Who is using Branch named the Gateway's owner by its profile id ("gateway-owner"). An id never
// reaches visible text; a profile with a display name keeps it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonRow, type PersonLine } from "./People";
import { shownName } from "./person-name";
import { personFrom } from "./engine";

vi.mock("../../face/Face", () => ({ Face: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

function shown(person: PersonLine): string {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root!.render(<PersonRow person={person} rows={[]} agents={[]} open={vi.fn()} openPlace={vi.fn()} />));
  return (host.textContent ?? "") + " " + (host.querySelector("[aria-label]")?.getAttribute("aria-label") ?? "");
}

describe("Who is using Branch names (Private #1089)", () => {
  it("never shows the owner's profile id", () => {
    const text = shown(personFrom("gateway-owner", "gateway-owner", "owner", []));
    expect(text).toContain("Shared owner");
    expect(text).not.toContain("gateway-owner");
  });

  it("never shows another unnamed profile's id", () => {
    const id = "3f2b9c1e-7d4a-4b8e-9c2d-0a1b2c3d4e5f";
    const text = shown(personFrom(id, id, "member", []));
    expect(text).toContain("Someone");
    expect(text).not.toContain(id);
  });

  it("keeps a real display name", () => {
    expect(shown(personFrom("dana-1", "Dana Okafor", "member", []))).toContain("Dana Okafor");
    expect(shownName({ id: "gateway-owner", name: "Taofik" })).toBe("Taofik");
  });
});
