import { describe, expect, it } from "vitest";
import { connectProblem, hostOf } from "./connect-problems";

describe("connect-problems logic", () => {
  describe("connectProblem", () => {
    it("AUTH_REQUIRED needs the matching key", () => {
      const p = connectProblem("AUTH_REQUIRED", "127.0.0.1:18789");
      expect(p.title).toBe("127.0.0.1:18789 needs its key");
      expect(p.line).toBe("127.0.0.1:18789 answers, but needs the matching key before this window can connect.");
      expect(p.steps).toEqual([
        "Paste the key from that computer into Gateway key.",
        "Or type the password set for that computer.",
        "Then choose Connect again.",
      ]);
      expect(p.needsKey).toBe(true);
    });

    it("AUTH_TOKEN_MISSING needs the matching key", () => {
      const p = connectProblem("AUTH_TOKEN_MISSING", "pc:1");
      expect(p.title).toBe("pc:1 needs its key");
      expect(p.line).toBe("pc:1 answers, but needs the matching key before this window can connect.");
      expect(p.steps).toEqual([
        "Paste the key from that computer into Gateway key.",
        "Or type the password set for that computer.",
        "Then choose Connect again.",
      ]);
      expect(p.needsKey).toBe(true);
    });

    it("AUTH_PASSWORD_MISSING needs the matching key", () => {
      const p = connectProblem("AUTH_PASSWORD_MISSING", "desktop:9999");
      expect(p.title).toBe("desktop:9999 needs its key");
      expect(p.line).toBe("desktop:9999 answers, but needs the matching key before this window can connect.");
      expect(p.steps).toEqual([
        "Paste the key from that computer into Gateway key.",
        "Or type the password set for that computer.",
        "Then choose Connect again.",
      ]);
      expect(p.needsKey).toBe(true);
    });

    it("AUTH_TOKEN_NOT_CONFIGURED suggests generating a token", () => {
      const p = connectProblem("AUTH_TOKEN_NOT_CONFIGURED", "localhost:18789");
      expect(p.title).toBe("localhost:18789 needs its key");
      expect(p.line).toBe("localhost:18789 answers, but needs the matching key before this window can connect.");
      expect(p.steps).toEqual([
        "No key is set on that computer yet. Ask whoever runs it to set one.",
        "Then choose Connect again.",
      ]);
      expect(p.needsKey).toBe(true);
    });

    it("AUTH_PASSWORD_NOT_CONFIGURED suggests generating a token", () => {
      const p = connectProblem("AUTH_PASSWORD_NOT_CONFIGURED", "192.168.1.5:8080");
      expect(p.title).toBe("192.168.1.5:8080 needs its key");
      expect(p.line).toBe("192.168.1.5:8080 answers, but needs the matching key before this window can connect.");
      expect(p.steps).toEqual([
        "No key is set on that computer yet. Ask whoever runs it to set one.",
        "Then choose Connect again.",
      ]);
      expect(p.needsKey).toBe(true);
    });

    it("AUTH_TOKEN_MISMATCH means the key was refused", () => {
      const p = connectProblem("AUTH_TOKEN_MISMATCH", "pc:1");
      expect(p.title).toBe("pc:1 refused this key");
      expect(p.line).toBe("Check it belongs to this computer.");
      expect(p.steps).toEqual([
        "Ask whoever runs that computer for its current key.",
        "Replace the key with the one for this address.",
      ]);
      expect(p.needsKey).toBe(true);
    });

    it("AUTH_PASSWORD_MISMATCH means the key was refused", () => {
      const p = connectProblem("AUTH_PASSWORD_MISMATCH", "home:3000");
      expect(p.title).toBe("home:3000 refused this key");
      expect(p.line).toBe("Check it belongs to this computer.");
      expect(p.steps).toEqual([
        "Ask whoever runs that computer for its current key.",
        "Replace the key with the one for this address.",
      ]);
      expect(p.needsKey).toBe(true);
    });

    it("AUTH_UNAUTHORIZED means the key was refused", () => {
      const p = connectProblem("AUTH_UNAUTHORIZED", "server:5000");
      expect(p.title).toBe("server:5000 refused this key");
      expect(p.line).toBe("Check it belongs to this computer.");
      expect(p.steps).toEqual([
        "Ask whoever runs that computer for its current key.",
        "Replace the key with the one for this address.",
      ]);
      expect(p.needsKey).toBe(true);
    });

    it("AUTH_DEVICE_TOKEN_MISMATCH means the key was refused", () => {
      const p = connectProblem("AUTH_DEVICE_TOKEN_MISMATCH", "box:7777");
      expect(p.title).toBe("box:7777 refused this key");
      expect(p.line).toBe("Check it belongs to this computer.");
      expect(p.steps).toEqual([
        "Ask whoever runs that computer for its current key.",
        "Replace the key with the one for this address.",
      ]);
      expect(p.needsKey).toBe(true);
    });

    it("AUTH_BOOTSTRAP_TOKEN_INVALID means the link expired", () => {
      const p = connectProblem("AUTH_BOOTSTRAP_TOKEN_INVALID", "main:4000");
      expect(p.title).toBe("This link no longer works");
      expect(p.line).toBe("It expired or was already used. Ask for a fresh link; don't change the key.");
      expect(p.steps).toEqual([
        "Ask for a fresh link, then open it here. Links work once and expire after ten minutes.",
      ]);
      expect(p.needsKey).toBe(false);
    });

    it("AUTH_RATE_LIMITED means too many tries", () => {
      const p = connectProblem("AUTH_RATE_LIMITED", "work:6000");
      expect(p.title).toBe("Too many tries");
      expect(p.line).toBe("work:6000 is pausing sign-ins from here for a moment.");
      expect(p.steps).toEqual(["Stop retrying for a moment.", "Wait, then connect with the right key."]);
      expect(p.needsKey).toBe(false);
    });

    it("OPERATOR_ACCESS_DENIED means no access", () => {
      const p = connectProblem("OPERATOR_ACCESS_DENIED", "shared:8888");
      expect(p.title).toBe("No access to shared:8888");
      expect(p.line).toBe("You're signed in, but this computer hasn't given your account access, or it has ended.");
      expect(p.steps).toEqual([
        "Ask an admin to give you a role.",
        "This connects by itself once access is given.",
      ]);
      expect(p.needsKey).toBe(false);
    });

    it("CONTROL_UI_ORIGIN_NOT_ALLOWED means origin not allowed", () => {
      const p = connectProblem("CONTROL_UI_ORIGIN_NOT_ALLOWED", "locked:9000");
      expect(p.title).toBe("That computer won't let this window in");
      expect(p.line).toBe("It only talks to windows it has been told about, and this one hasn't been.");
      expect(p.steps).toEqual(["Ask whoever runs that computer to let this window in.", "Then choose Connect again."]);
      expect([p.title, p.line, ...p.steps].join("\n")).not.toMatch(/gateway\.|allowedOrigins|restart the gateway/);
      expect(p.needsKey).toBe(false);
    });

    it("PROTOCOL_MISMATCH means versions don't match", () => {
      const p = connectProblem("PROTOCOL_MISMATCH", "old:1234");
      expect(p.title).toBe("Versions don't match");
      expect(p.line).toBe("This window and that computer speak different versions.");
      expect(p.steps).toEqual(["Update Branch on both."]);
      expect(p.needsKey).toBe(false);
    });

    it("CLIENT_VERSION_MISMATCH means versions don't match", () => {
      const p = connectProblem("CLIENT_VERSION_MISMATCH", "remote:5555");
      expect(p.title).toBe("Versions don't match");
      expect(p.line).toBe("This window and that computer speak different versions.");
      expect(p.steps).toEqual(["Update Branch on both."]);
      expect(p.needsKey).toBe(false);
    });

    it("CONTROL_UI_BUILD_MISMATCH means versions don't match", () => {
      const p = connectProblem("CONTROL_UI_BUILD_MISMATCH", "dev:3333");
      expect(p.title).toBe("Versions don't match");
      expect(p.line).toBe("This window and that computer speak different versions.");
      expect(p.steps).toEqual(["Update Branch on both."]);
      expect(p.needsKey).toBe(false);
    });

    it("unknown code falls back to generic didn't answer and keeps the raw code out of Regular copy", () => {
      const p = connectProblem("SOME_UNKNOWN_ERROR", "mystery:2222");
      expect(p.title).toBe("mystery:2222 didn't answer");
      expect(p.line).toBe("Nothing was changed.");
      expect(p.steps).toEqual(["Check that Branch is running on that computer, then choose Connect again."]);
      expect(p.needsKey).toBe(true);
      expect([p.title, p.line, ...p.steps].join("\n")).not.toContain("SOME_UNKNOWN_ERROR");
    });

    it("undefined code falls back to generic didn't answer", () => {
      const p = connectProblem(undefined, "down:1111");
      expect(p.title).toBe("down:1111 didn't answer");
      expect(p.line).toBe("Nothing was changed.");
      expect(p.steps).toEqual(["Check that Branch is running on that computer, then choose Connect again."]);
      expect(p.needsKey).toBe(true);
    });

    it("no fix steps contain raw error codes", () => {
      const codes = [
        "AUTH_REQUIRED",
        "AUTH_TOKEN_MISSING",
        "AUTH_PASSWORD_MISSING",
        "AUTH_TOKEN_NOT_CONFIGURED",
        "AUTH_PASSWORD_NOT_CONFIGURED",
        "AUTH_TOKEN_MISMATCH",
        "AUTH_PASSWORD_MISMATCH",
        "AUTH_UNAUTHORIZED",
        "AUTH_DEVICE_TOKEN_MISMATCH",
        "AUTH_BOOTSTRAP_TOKEN_INVALID",
        "AUTH_RATE_LIMITED",
        "OPERATOR_ACCESS_DENIED",
        "CONTROL_UI_ORIGIN_NOT_ALLOWED",
        "PROTOCOL_MISMATCH",
        "CLIENT_VERSION_MISMATCH",
        "CONTROL_UI_BUILD_MISMATCH",
      ];
      for (const code of codes) {
        const p = connectProblem(code, "test:1234");
        for (const step of p.steps) {
          expect(step).not.toContain("AUTH_");
          expect(step).not.toContain("CONTROL_");
          expect(step).not.toContain("PROTOCOL_");
          expect(step).not.toContain("CLIENT_");
          expect(step.toUpperCase()).not.toContain("MISMATCH");
          expect(step.toUpperCase()).not.toContain("UNAUTHORIZED");
        }
      }
    });

    it("no titles or lines contain raw error codes", () => {
      const codes = [
        "AUTH_REQUIRED",
        "AUTH_TOKEN_MISSING",
        "AUTH_PASSWORD_MISSING",
        "AUTH_TOKEN_NOT_CONFIGURED",
        "AUTH_PASSWORD_NOT_CONFIGURED",
        "AUTH_TOKEN_MISMATCH",
        "AUTH_PASSWORD_MISMATCH",
        "AUTH_UNAUTHORIZED",
        "AUTH_DEVICE_TOKEN_MISMATCH",
        "AUTH_BOOTSTRAP_TOKEN_INVALID",
        "AUTH_RATE_LIMITED",
        "OPERATOR_ACCESS_DENIED",
        "CONTROL_UI_ORIGIN_NOT_ALLOWED",
        "PROTOCOL_MISMATCH",
        "CLIENT_VERSION_MISMATCH",
        "CONTROL_UI_BUILD_MISMATCH",
      ];
      for (const code of codes) {
        const p = connectProblem(code, "test:1234");
        expect(p.title).not.toContain("AUTH_");
        expect(p.title).not.toContain("CONTROL_");
        expect(p.title).not.toContain("PROTOCOL_");
        expect(p.title).not.toContain("CLIENT_");
        expect(p.line).not.toContain("AUTH_");
        expect(p.line).not.toContain("CONTROL_");
        expect(p.line).not.toContain("PROTOCOL_");
        expect(p.line).not.toContain("CLIENT_");
      }
    });
  });

  describe("hostOf", () => {
    it("strips ws:// scheme", () => {
      expect(hostOf("ws://127.0.0.1:18789")).toBe("127.0.0.1:18789");
    });

    it("strips wss:// scheme", () => {
      expect(hostOf("wss://secure.example.com:443")).toBe("secure.example.com:443");
    });

    it("handles bare host without scheme", () => {
      expect(hostOf("localhost:18789")).toBe("localhost:18789");
    });

    it("handles host with port", () => {
      expect(hostOf("192.168.1.1:8080")).toBe("192.168.1.1:8080");
    });

    it("strips trailing slash", () => {
      expect(hostOf("ws://example.com:3000/")).toBe("example.com:3000");
    });

    it("handles wss with trailing slash", () => {
      expect(hostOf("wss://api.branch.com:9999/")).toBe("api.branch.com:9999");
    });

    it("handles IPv6 address", () => {
      expect(hostOf("ws://[::1]:8080")).toBe("[::1]:8080");
    });

    it("never asks a stranger to type a terminal command", () => {
      const codes = ["AUTH_REQUIRED", "AUTH_TOKEN_NOT_CONFIGURED", "AUTH_TOKEN_MISMATCH", "AUTH_BOOTSTRAP_TOKEN_INVALID", "OPERATOR_ACCESS_DENIED", "PROTOCOL_MISMATCH", "UNKNOWN_CODE"];
      for (const code of codes) {
        const p = connectProblem(code, "127.0.0.1:18789");
        expect([p.line, ...p.steps].join("\n")).not.toMatch(/`branch |\bbranch (dashboard|gateway|doctor)\b/);
      }
    });
    it("handles bare IPv4", () => {
      expect(hostOf("10.0.0.1:5000")).toBe("10.0.0.1:5000");
    });
  });
});
