import { describe, expect, it } from "vitest";
import { accountsOf, type Provider } from "../places/settings/set1/accounts";
import { currentModelAccount, modelAccountTooltip, shortAccountEmail } from "./useModelAccount";

const provider: Provider = {
  provider: "openai",
  displayName: "OpenAI",
  status: "ok",
  profileOrder: ["openai:elm", "openai:ash"],
  lastGoodProfileId: "openai:ash",
  profiles: [
    { profileId: "openai:ash", type: "oauth", status: "ok", email: "ash@example.test" },
    { profileId: "openai:elm", type: "oauth", status: "ok", email: "elm@example.test" },
  ],
  usage: { accountEmail: "ash@example.test", windows: [{ label: "5 hours", usedPercent: 30 }] },
};

describe("composer model account", () => {
  it("shows the last successful account, except when a conversation pins another", () => {
    const accounts = accountsOf([provider]);
    expect(currentModelAccount(accounts, "openai", {})?.a.email).toBe("ash@example.test");
    expect(currentModelAccount(accounts, "openai", { authProfileOverride: "openai:elm" })?.a.email).toBe("elm@example.test");
    expect(shortAccountEmail(currentModelAccount(accounts, "openai", {}))).toBe("ash@…");
    expect(modelAccountTooltip(currentModelAccount(accounts, "openai", {}))).toContain("5 hours: 30% used");
    expect(modelAccountTooltip(currentModelAccount(accounts, "openai", { authProfileOverride: "openai:elm" }))).not.toContain("5 hours");
  });
});
