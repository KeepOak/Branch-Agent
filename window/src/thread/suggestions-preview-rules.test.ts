import { describe, expect, it } from "vitest";
import type { Block } from "./model";
import { suggestionsFor } from "./suggestions";

const user = (text: string): Block => ({ kind: "user", key: `u:${text}`, text });
const reply = (text: string): Block => ({ kind: "text", key: `r:${text}`, text, streaming: false });
const pending = (command: string): Block => ({
  kind: "approval",
  key: `a:${command}`,
  approval: { id: `a:${command}`, command, state: "pending" },
});

describe("preview chipsForT5 rules", () => {
  it("Want me to A and B offers Yes, do both / Just A / Not now", () => {
    expect(suggestionsFor(
      [user("Dinner?"), reply("Want me to book the table and add it to your calendar?")],
      false,
      false,
    )).toEqual(["Yes, do both", "Just book the table", "Not now"]);
  });

  it("pending email ask offers show / send / don’t send", () => {
    expect(suggestionsFor(
      [user("Send it"), reply("Ready when you are."), pending("send the invoice email")],
      false,
      false,
    )).toEqual(["Show me the email first", "Send it", "Don\u2019t send it yet"]);
  });

  it("invoice money words add waive / show invoice in preview order under the 3-chip cap", () => {
    expect(suggestionsFor(
      [user("Check this"), reply("We're $100 short on the invoice. Want me to ask them to waive it?")],
      false,
      false,
    )).toEqual(["Yes, please", "Not now", "Ask them to waive it"]);
  });

  it("your own last turn offers none", () => {
    expect(suggestionsFor(
      [user("Hi"), reply("Want me to book the table and add it to your calendar?"), user("Later")],
      false,
      false,
    )).toEqual([]);
  });
});
