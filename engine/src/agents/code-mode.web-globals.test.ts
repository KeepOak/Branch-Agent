import { expectDefined } from "@branch/normalization-core";
import { afterEach, describe, expect, it } from "vitest";
import { applyCodeModeCatalog } from "./code-mode.js";
import {
  createCodeModeHarness,
  pluginTool,
  resetCodeModeTestState,
  resultDetails,
} from "./code-mode.test-support.js";

afterEach(resetCodeModeTestState);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function codeModeTools(executor: "node" | "quickjs") {
  const { ctx, config, tools } = createCodeModeHarness({ codeMode: { executor } });
  const compacted = applyCodeModeCatalog({
    ...ctx,
    config,
    tools: [...tools, pluginTool("fake_lookup", "Lookup"), pluginTool("crypto", "Collide")],
  });
  return {
    exec: expectDefined(tools[0], "exec"),
    wait: expectDefined(tools[1], "wait"),
    description: compacted.tools[0]?.description ?? "",
  };
}

describe.each(["node", "quickjs"] as const)("Code Mode web globals (%s executor)", (executor) => {
  it("runs atob, btoa and crypto.randomUUID inside exec", async () => {
    const { exec, description } = codeModeTools(executor);
    const details = resultDetails(
      await exec.execute("web-globals", {
        code: `const id = crypto.randomUUID();
          const bytes = crypto.getRandomValues(new Uint8Array(16));
          return {
            encoded: btoa("Branch"),
            decoded: atob("QnJhbmNo"),
            id,
            unique: id !== crypto.randomUUID(),
            bytes: bytes.length,
          };`,
      }),
    );
    expect(details).toMatchObject({
      status: "completed",
      value: { encoded: "QnJhbmNo", decoded: "Branch", unique: true, bytes: 16 },
    });
    expect((details.value as { id: string }).id).toMatch(UUID_V4);
    // A tool named crypto must not shadow the global.
    expect(description).toMatch(/- crypto_[a-f0-9]{8} /u);
    expect(description).toContain("`atob`/`btoa` handle base64");
  });

  it("handles base64 and getRandomValues edge cases", async () => {
    const { exec } = codeModeTools(executor);
    const details = resultDetails(
      await exec.execute("web-globals-edges", {
        code: String.raw`const bytes = crypto.getRandomValues(new Uint8Array(32));
          const words = crypto.getRandomValues(new Uint32Array(4));
          const errorName = (run) => { try { run(); return "none"; } catch (error) { return error.name; } };
          return {
            encoded: btoa("hello, world"),
            decoded: atob("aGVsbG8sIHdvcmxk"),
            padding: [btoa(""), btoa("a"), btoa("ab"), btoa("abc"), atob("YQ"), atob(" YW I=\n")],
            latin1: atob(btoa("\u00ff\u0000\u0080")) === "\u00ff\u0000\u0080",
            sameArray: crypto.getRandomValues(bytes) === bytes,
            varied: new Set(bytes).size > 1 && words.some((word) => word !== 0),
            bigInts: crypto.getRandomValues(new BigUint64Array(2)).length,
            errors: [
              errorName(() => btoa("\u{1F33F}")),
              errorName(() => atob("a")),
              errorName(() => atob("ab=")),
              errorName(() => crypto.getRandomValues([1, 2])),
              errorName(() => crypto.getRandomValues(new Float64Array(2))),
              errorName(() => crypto.getRandomValues(new Uint8ClampedArray(2))),
              errorName(() => crypto.getRandomValues(new Uint8Array(65_537))),
            ],
            hostHidden: typeof __branchHostRandomHex,
          };`,
      }),
    );
    expect(details).toMatchObject({ status: "completed" });
    expect(details.value).toEqual({
      encoded: "aGVsbG8sIHdvcmxk",
      decoded: "hello, world",
      padding: ["", "YQ==", "YWI=", "YWJj", "a", "ab"],
      latin1: true,
      sameArray: true,
      varied: true,
      bigInts: 2,
      errors: [
        "InvalidCharacterError",
        "InvalidCharacterError",
        "InvalidCharacterError",
        "TypeMismatchError",
        "TypeMismatchError",
        "TypeMismatchError",
        "QuotaExceededError",
      ],
      hostHidden: "undefined",
    });
  });

  it("refuses a flipping byteLength getter and throws only guest-realm errors", async () => {
    const { exec } = codeModeTools(executor);
    const details = resultDetails(
      await exec.execute("web-globals-realm", {
        code: String.raw`const caught = (run) => { try { run(); return null; } catch (error) { return error; } };
          // Small for the quota check, huge for the next read: the old code passed the
          // huge count to the host, whose host-realm Error reached the guest.
          let reads = 0;
          const flipping = new Uint8Array(4);
          Object.defineProperty(flipping, "byteLength", {
            get() { reads += 1; return reads === 1 ? 4 : 1_048_576; },
          });
          const flipError = caught(() => {
            if (crypto.getRandomValues(flipping) !== flipping) throw new Error("not the same array");
          });
          // An own getter must not hide the real length from the quota check.
          const hidden = new Uint8Array(65_537);
          Object.defineProperty(hidden, "byteLength", { get: () => 16 });
          const lookalike = {
            byteLength: 4, byteOffset: 0, buffer: new ArrayBuffer(4),
            [Symbol.toStringTag]: "Uint8Array",
          };
          const errors = [
            caught(() => crypto.getRandomValues(hidden)),
            caught(() => crypto.getRandomValues(lookalike)),
            caught(() => crypto.getRandomValues(new Uint8ClampedArray(4))),
            caught(() => crypto.getRandomValues()),
            caught(() => btoa("\u{1F33F}")),
            caught(() => atob("a")),
            caught(() => atob()),
          ];
          // Native encoders run in the host on the node executor; their errors must be guest copies.
          const encoderErrors = [
            caught(() => new TextEncoder().encodeInto("x", {})),
            caught(() => new TextEncoder().encode(Symbol("x"))),
            caught(() => new TextDecoder().decode(42)),
            caught(() => new TextDecoder("no-such-encoding")),
          ];
          const guestRealm = (error) =>
            error !== null &&
            [Error, TypeError, RangeError].includes(error.constructor) &&
            error.constructor.constructor === Function;
          return {
            flipError: flipError === null ? null : String(flipError && flipError.message),
            flipErrorGuestRealm: flipError === null || guestRealm(flipError),
            reads,
            names: errors.map((error) => error && error.name),
            guestRealm: errors.map(guestRealm),
            encoderGuestRealm: encoderErrors.map((error) => error === null || guestRealm(error)),
          };`,
      }),
    );
    expect(details).toMatchObject({ status: "completed" });
    expect(details.value).toEqual({
      flipError: null,
      flipErrorGuestRealm: true,
      reads: 0,
      names: [
        "QuotaExceededError",
        "TypeMismatchError",
        "TypeMismatchError",
        "TypeMismatchError",
        "InvalidCharacterError",
        "InvalidCharacterError",
        "TypeError",
      ],
      guestRealm: [true, true, true, true, true, true, true],
      encoderGuestRealm: [true, true, true, true],
    });
  });

  it("keeps crypto working after a wait resume", async () => {
    const { exec, wait } = codeModeTools(executor);
    const first = resultDetails(
      await exec.execute("park", {
        code: 'text("parked"); await yield_control(); return crypto.randomUUID();',
      }),
    );
    expect(first).toMatchObject({ status: "waiting" });
    const resumed = resultDetails(await wait.execute("resume", { runId: first.runId }));
    expect(resumed).toMatchObject({ status: "completed" });
    expect(resumed.value).toMatch(UUID_V4);
  });

  it("lists available globals when a script uses a name Code Mode does not provide", async () => {
    const { exec } = codeModeTools(executor);
    const details = resultDetails(
      await exec.execute("missing", { code: "return automations.list();" }),
    );
    expect(details).toMatchObject({ status: "failed" });
    const error = String(details.error);
    expect(error).toContain("ReferenceError: automations is not defined");
    expect(error).toContain("`automations` is not a Code Mode global.");
    expect(error).toMatch(/Tool globals: .*fake_lookup/u);
    expect(error).toContain("atob, btoa, crypto");
  });
});
