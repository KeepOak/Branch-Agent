import path from "node:path";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lstat: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, lstat: mocks.lstat, default: { ...actual, lstat: mocks.lstat } };
});

vi.mock("../../infra/fs-safe.js", () => ({
  root: async (parentPath: string) => ({
    rootReal: parentPath,
    stat: async () => ({ isSymbolicLink: false, isFile: false, nlink: 1 }),
  }),
  FsSafeError: class extends Error {},
}));

const { cleanupPathIdentity, persistedCleanupPathIdentity, statAgentCleanupPath } =
  await import("./agents-delete-identity.js");

it.each([
  {
    name: "matching 64-bit identity",
    dev: "1311768467463790320",
    ino: "9223372036854775809",
    currentDev: 0x1234_5678_9abc_def0n,
    currentIno: 0x8000_0000_0000_0001n,
    matches: true,
  },
  {
    name: "adjacent 64-bit replacement",
    dev: "1311768467463790320",
    ino: "9223372036854775809",
    currentDev: 0x1234_5678_9abc_def0n,
    currentIno: 0x8000_0000_0000_0002n,
    matches: false,
  },
  {
    name: "legacy numeric journal identity",
    dev: 12,
    ino: 34,
    currentDev: 12n,
    currentIno: 34n,
    matches: true,
  },
])("checks $name before cleanup", async ({ dev, ino, currentDev, currentIno, matches }) => {
  const parentPath = path.resolve("/journal");
  const trashPath = path.join(parentPath, "agent");
  const preparedIdentity = persistedCleanupPathIdentity(dev, ino);
  const cleanupPath = { parentPath, trashPath, kind: "target" as const, preparedIdentity };
  mocks.lstat.mockReset().mockResolvedValue({ dev: currentDev, ino: currentIno });

  expect(cleanupPathIdentity({ dev: currentDev, ino: currentIno })).toEqual({
    dev: String(currentDev),
    ino: String(currentIno),
  });
  if (matches) {
    await expect(statAgentCleanupPath(cleanupPath)).resolves.toBeUndefined();
  } else {
    await expect(statAgentCleanupPath(cleanupPath)).rejects.toThrow(
      "cleanup path identity changed before deletion",
    );
  }
  expect(mocks.lstat).toHaveBeenCalledWith(trashPath, { bigint: true });
});
