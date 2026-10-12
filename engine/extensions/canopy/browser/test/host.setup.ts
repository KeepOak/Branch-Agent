import { afterEach, beforeEach } from "vitest";
import { bindCanopyHost } from "../host.ts";
import { createCanopyTestHost } from "./host.ts";

let fixture: ReturnType<typeof createCanopyTestHost>;
let unbind: (() => void) | undefined;

beforeEach(() => {
  fixture = createCanopyTestHost();
  unbind = bindCanopyHost(fixture.host);
});

afterEach(() => {
  unbind?.();
  fixture.dispose();
});

export function canopyTestHost() {
  return fixture;
}
