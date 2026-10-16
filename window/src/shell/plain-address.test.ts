// @vitest-environment jsdom
// Card #1095, walkthrough B-026: restarting the engine showed "Can’t reach <the machine's hostname>" in a banner. At
// Regular no toast or banner shows a hostname, an IP address or a URL; Advanced keeps the exact words.
import { afterEach, describe, expect, it } from "vitest";
import { clearBanner, currentBanner, raiseBanner } from "./Banner";
import { dismiss, getToasts, notify } from "./notify";
import { plainAddresses, rememberHostnames } from "./plain-address";

afterEach(() => { clearBanner(); for (const toast of getToasts()) dismiss(toast.id); localStorage.clear(); });

describe("no hostnames, IP addresses or URLs at Regular", () => {
  it("the restart banner says this computer, not the hostname", () => {
    rememberHostnames("studio-box");
    raiseBanner({ icon: "alert", title: "Can’t reach studio-box", text: "Branch keeps trying.", sameAs: "reach:studio-box" });
    expect(currentBanner()?.title).toBe("Can’t reach this computer");
    expect(currentBanner()?.text).toBe("Branch keeps trying.");
  });

  it("a toast and its second line never show an address", () => {
    notify("Couldn’t connect to ws://10.0.0.5:18789/gateway", { line: "Tried studio.local and nas.tail1234.ts.net" });
    const [toast] = getToasts();
    expect(toast.text).toBe("Couldn’t connect to the link");
    expect(toast.line).toBe("Tried that computer and that computer");
  });

  it.each([
    ["Open https://example.com/setup?code=1", "Open the link"],
    ["Can’t reach 192.168.1.20", "Can’t reach that computer"],
    ["Can’t reach [fe80::1]:18789", "Can’t reach that computer"],
    ["Listening on localhost:18789", "Listening on that computer"],
    ["studio-box restarted.", "this computer restarted."],
  ])("%j reads %j", (raw, plain) => {
    rememberHostnames("studio-box");
    expect(plainAddresses(raw)).toBe(plain);
  });

  it("leaves times, file names and ordinary words alone", () => {
    rememberHostnames("studio-box");
    for (const words of ["Done at 12:30.", "Saved plan.md", "Version 2.4.1 is ready.", "studio-boxes are not hostnames", "Ratio 3:2"]) expect(plainAddresses(words)).toBe(words);
  });

  it("keeps the exact address from Advanced up", () => {
    localStorage.setItem("branch.level", "advanced");
    rememberHostnames("studio-box");
    raiseBanner({ icon: "alert", title: "Can’t reach studio-box", text: "Branch keeps trying." });
    expect(currentBanner()?.title).toBe("Can’t reach studio-box");
  });
});
