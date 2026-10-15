import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { coalesce } from "./coalesce";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("runs once for a burst of calls, after the window", () => {
  const run = vi.fn();
  const soon = coalesce(run, 2_000);
  for (let i = 0; i < 10; i++) soon();
  expect(run).not.toHaveBeenCalled();
  vi.advanceTimersByTime(2_000);
  expect(run).toHaveBeenCalledOnce();
});

it("keeps running during a steady stream, at most once per window", () => {
  const run = vi.fn();
  const soon = coalesce(run, 2_000);
  for (let second = 0; second < 10; second++) { soon(); vi.advanceTimersByTime(1_000); }
  expect(run).toHaveBeenCalledTimes(5);
});

it("cancel drops the pending run", () => {
  const run = vi.fn();
  const soon = coalesce(run, 2_000);
  soon();
  soon.cancel();
  vi.advanceTimersByTime(5_000);
  expect(run).not.toHaveBeenCalled();
});
