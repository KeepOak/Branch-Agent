// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { loadLine } from "./queue";
import { useWaitingLine } from "./useWaitingLine";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(async () => {
  await act(async () => root.unmount());
  localStorage.clear();
  document.body.innerHTML = "";
});

it("keeps an offline steer request saved until the connection returns", async () => {
  const deliver = vi.fn();
  let queue: ReturnType<typeof useWaitingLine>;
  function Harness({ offline }: { offline: boolean }) {
    queue = useWaitingLine("conversation", true, offline, deliver);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness offline />));
  await act(async () => queue.add("Keep the native camera", []));
  const item = queue!.line[0];
  await act(async () => queue.steerNow(item.id));
  expect(deliver).not.toHaveBeenCalled();
  expect(queue!.line).toEqual([item]);
  expect(loadLine(localStorage, "conversation")).toEqual([item]);
  await act(async () => root.render(<Harness offline={false} />));
  await act(async () => queue.steerNow(item.id));
  expect(deliver).toHaveBeenCalledOnce();
  expect(deliver).toHaveBeenCalledWith(item, true);
  expect(queue!.line).toEqual([]);
  expect(loadLine(localStorage, "conversation")).toEqual([]);
});

it("drains the preserved row normally once the idle conversation reconnects", async () => {
  const deliver = vi.fn();
  let queue: ReturnType<typeof useWaitingLine>;
  function Harness({ offline }: { offline: boolean }) {
    queue = useWaitingLine("conversation", false, offline, deliver);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness offline />));
  await act(async () => queue.add("Continue when connected", []));
  const item = queue!.line[0];
  await act(async () => queue.steerNow(item.id));
  expect(deliver).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness offline={false} />));
  expect(deliver).toHaveBeenCalledOnce();
  expect(deliver).toHaveBeenCalledWith(item, false);
  expect(queue!.line).toEqual([]);
});
