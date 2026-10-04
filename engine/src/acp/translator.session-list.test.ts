/** Tests ACP translator session-list cursor and page-size helpers. */
import { describe, expect, it } from "vitest";
import {
  ACP_LIST_SESSIONS_MAX_FETCH_LIMIT,
  decodeListSessionsCursor,
  encodeListSessionsCursor,
  resolveListSessionsPageSize,
  readAcpSessionListTypes,
  assertListSessionsTypeFilter,
} from "./translator.session-list.js";

describe("ACP translator session list helpers", () => {
  it("rejects invalid cursor payloads", () => {
    expect(() => decodeListSessionsCursor("not-base64-json")).toThrow(
      "Invalid ACP session list cursor.",
    );
    expect(() =>
      decodeListSessionsCursor(
        Buffer.from(
          JSON.stringify({ v: 1, offset: ACP_LIST_SESSIONS_MAX_FETCH_LIMIT }),
          "utf8",
        ).toString("base64url"),
      ),
    ).toThrow("Invalid ACP session list cursor offset.");
  });

  it("rejects altered and non-emitted cursor spellings", () => {
    const canonical = encodeListSessionsCursor({ offset: 25, cwd: "/tmp/work" });
    const extraField = Buffer.from(
      JSON.stringify({ v: 1, offset: 25, cwd: "/tmp/work", extra: true }),
      "utf8",
    ).toString("base64url");

    expect(decodeListSessionsCursor(canonical)).toEqual({ offset: 25, cwd: "/tmp/work" });
    for (const cursor of [`${canonical}$`, extraField]) {
      expect(() => decodeListSessionsCursor(cursor)).toThrow("Invalid ACP session list cursor.");
    }
  });

  it("clamps page size metadata to the bridge maximum", () => {
    expect(resolveListSessionsPageSize(null)).toBe(100);
    expect(resolveListSessionsPageSize({ limit: 2.9 })).toBe(2);
    expect(resolveListSessionsPageSize({ pageSize: 1_000 })).toBe(100);
    expect(resolveListSessionsPageSize({ limit: -1 })).toBe(1);
  });
});

it("uses source ACP discovery defaults and accepts only its visible type selection", () => {
  for (const meta of [undefined, null, {}, { types: null }, { types: [] }]) {
    expect(readAcpSessionListTypes(meta)).toEqual(["user", "scheduled", "acp"]);
  }
  expect(readAcpSessionListTypes({ types: ["user", "acp", "user"] })).toEqual(["acp", "user"]);
  for (const types of ["acp", ["hidden"], ["terminal"], ["wrong"], [3]]) {
    expect(() => readAcpSessionListTypes({ types })).toThrow(
      "types may only include user, scheduled, or acp",
    );
  }
});
it("binds emitted cursors to normalized type filters and keeps legacy default cursors", () => {
  const typed = decodeListSessionsCursor(encodeListSessionsCursor({ offset: 2, types: ["acp"] }));
  expect(() => assertListSessionsTypeFilter(typed, ["user"])).toThrow(
    "does not match the type filter",
  );
  expect(() => assertListSessionsTypeFilter(typed, ["acp"])).not.toThrow();
  const legacy = decodeListSessionsCursor(encodeListSessionsCursor({ offset: 2 }));
  expect(() =>
    assertListSessionsTypeFilter(legacy, readAcpSessionListTypes(undefined)),
  ).not.toThrow();
  expect(() => assertListSessionsTypeFilter(legacy, ["acp"])).toThrow(
    "does not match the type filter",
  );
});
