// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Thread } from "./Thread";
import { suggestionsFor } from "./suggestions";
import type { Block } from "./model";

vi.mock("../face/Face", () => ({ Face: () => <span data-testid="face" /> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const user = (text: string): Block => ({ kind: "user", key: `u:${text}`, text });
const reply = (text: string): Block => ({ kind: "text", key: `r:${text}`, text, streaming: false });

describe("P54 one relevant suggestion row", () => {
  it("uses only the latest real reply and none while a turn runs", () => {
    expect(suggestionsFor([user("Hi"), reply("Should I send the report?")], false, false)).toEqual(["Yes, please", "Not now"]);
    expect(suggestionsFor([user("Hi"), reply("Should I send the report?")], true, false)).toEqual([]);
    expect(suggestionsFor([user("Hi"), reply("Should I send the report?")], false, true)).toEqual([]);
    expect(suggestionsFor([user("Hi"), reply("Should I send the report?"), user("Later")], false, false)).toEqual([]);
    expect(suggestionsFor([user("Hi"), reply("The work is done.")], false, false)).toEqual([]);
  });

  it.each([
    "Hey! What’s up?",
    "What would you like to work on?",
    "How can I help?",
    "Which computer should I use?",
    "Do you prefer Windows or Linux?",
    "Should I use Windows or Linux?",
    "Want me to open the file or the folder?",
    "Can you tell me what happened?",
    "Could you describe the problem?",
    "Ready?",
    "¿Cómo puedo ayudarte?",
  ])("does not invent binary answers for %s", (text) => {
    expect(suggestionsFor([user("Hi"), reply(text)], false, false)).toEqual([]);
  });

  it.each([
    "Is this correct?",
    "Are you ready?",
    "Did you receive it?",
    "Have you tried restarting?",
    "Does that work for you?",
  ])("keeps yes/no replies for direct confirmations: %s", (text) => {
    expect(suggestionsFor([user("Hi"), reply(text)], false, false)).toEqual(["Yes", "No"]);
  });

  it("renders the greeting without a suggestion row", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<Thread name="Research" history={[user("Hi"), reply("Hey! What’s up?")]} live={[]} pendingUser={null} running={false} onAnswer={() => {}} onStart={vi.fn()} />));
    expect(host.textContent).toContain("Hey! What’s up?");
    expect(host.querySelector('[aria-label="Suggested replies"]')).toBeNull();
  });

  it("shows one left-aligned row and clears it immediately when a chip sends", async () => {
    const sent = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<Thread name="Research" history={[user("Question"), reply("Should I check the invoice?")]} live={[]} pendingUser={null} running={false} onAnswer={() => {}} onStart={sent} />));
    expect(host.querySelectorAll('[aria-label="Suggested replies"]')).toHaveLength(1);
    expect(host.querySelectorAll('[aria-label="Suggested replies"] button')).toHaveLength(2);
    expect(host.querySelector('[aria-label="Suggested replies"] button')?.getAttribute("aria-label")).toBe("Reply: Yes, please");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Suggested replies"] button')?.click());
    expect(sent).toHaveBeenCalledWith("Yes, please");
    expect(host.querySelector('[aria-label="Suggested replies"]')).toBeNull();
  });
});
