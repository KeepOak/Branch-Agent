// The "Runs on" footer names the model's account in plain words, never the engine's `provider:email` profile id.
import { describe, expect, it } from "vitest";
import { footerAccount } from "./Row";

describe("the Runs on footer", () => {
  it("shows a plain display name", () => {
    expect(footerAccount({ displayName: "Work ChatGPT" })).toBe("Work ChatGPT");
  });

  it("never shows a raw profile id or an email", () => {
    expect(footerAccount({ displayName: "openai:digitalforgedlab@gmail.com" })).toBe("");
    expect(footerAccount({ displayName: "digitalforgedlab@gmail.com" })).toBe("");
    expect(footerAccount(undefined)).toBe("");
  });
});
