import { afterEach, expect, it, vi } from "vitest";
import { createCanopyCard } from "./lib/canopy/test/index-helpers.ts";
import { canopyTestHost } from "./test/host.setup.ts";
import { createViewContext } from "./test/host.ts";
import { createCanopyWidget } from "./widgets.ts";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  document.body.replaceChildren();
});

function mountWidget(canMutate = true, presented = true) {
  const fixture = canopyTestHost();
  fixture.connection.connected = true;
  const card = createCanopyCard();
  const request = vi.fn(async () => ({ cards: [card] }));
  fixture.host.request = request as typeof fixture.host.request;
  const container = document.createElement("div");
  document.body.append(container);
  const context = createViewContext(
    fixture.host,
    {
      sessionKey: "main",
      widget: { name: "Card", props: { cardId: card.id } },
      canMutate,
      canGrant: true,
    },
    presented,
  );
  const mounted = createCanopyWidget(fixture.host, "card")(container, context);
  disposers.push(() => mounted?.dispose?.());
  return { fixture, request, card, container, context, mounted };
}

it("renders the public card widget with read-only status controls", async () => {
  const widget = mountWidget(false);
  await vi.waitFor(() => expect(widget.container.textContent).toContain(widget.card.title));
  const select = widget.container.querySelector("select");
  expect(select?.disabled).toBe(true);
  select!.value = "done";
  select!.dispatchEvent(new Event("change", { bubbles: true }));
  expect(widget.request.mock.calls).toHaveLength(1);
});

it("starts visible widgets and releases hidden widget subscriptions", async () => {
  const widget = mountWidget(true, false);
  expect(widget.request).not.toHaveBeenCalled();
  widget.mounted?.update?.({ ...widget.context, presented: true });
  await vi.waitFor(() => expect(widget.container.textContent).toContain(widget.card.title));
  widget.mounted?.update?.({ ...widget.context, presented: false });
  expect(widget.fixture.listeners.size).toBe(0);
  expect(widget.fixture.events.get("plugin.canopy.changed")?.size).toBe(0);
  const count = widget.request.mock.calls.length;
  widget.fixture.emit("plugin.canopy.changed", {});
  expect(widget.request).toHaveBeenCalledTimes(count);
  widget.mounted?.update?.({ ...widget.context, presented: true });
  await vi.waitFor(() => expect(widget.request).toHaveBeenCalledTimes(count + 1));
});

it("offers retry after an owner request fails, then replaces the error with cards", async () => {
  const widget = mountWidget(true, false);
  widget.request.mockRejectedValueOnce(new Error("Catalog temporarily unavailable"));
  widget.mounted?.update?.({ ...widget.context, presented: true });
  await vi.waitFor(() =>
    expect(widget.container.textContent).toContain("Catalog temporarily unavailable"),
  );
  widget.container.querySelector<HTMLButtonElement>("button")!.click();
  await vi.waitFor(() => expect(widget.container.textContent).toContain(widget.card.title));
  expect(widget.container.querySelector('[role="alert"]')).toBeNull();
});
