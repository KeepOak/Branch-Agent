import path from "node:path";
import { expect, it } from "vitest";
import { withTempHome } from "./test-helpers.js";
import { validateConfigObject } from "./validation.js";

it.each([
  "bolt",
  "ember",
  "juniper",
  "kite",
  "lumen",
  "morel",
  "pebble",
  "tide",
  "tock",
  "wisp",
  "nib",
  "skein",
  "sorrel",
])(
  "accepts the shipped Branch character %s without treating it as a file or remote URL",
  async (character) => {
    await withTempHome(async (home) => {
      expect(
        validateConfigObject({
          agents: {
            entries: {
              main: {
                workspace: path.join(home, "branch"),
                identity: { avatar: `branch:${character}` },
              },
            },
          },
        }).ok,
      ).toBe(true);
    });
  },
);

it.each([
  "branch:unknown",
  "branch:../ember",
  "branch:ember/../private",
  "branch:ember?file=private",
  "file:///private/avatar.png",
])("does not accept an unknown character or arbitrary URI: %s", async (avatar) => {
  await withTempHome(async (home) => {
    expect(
      validateConfigObject({
        agents: {
          entries: {
            main: {
              workspace: path.join(home, "branch"),
              identity: { avatar },
            },
          },
        },
      }).ok,
    ).toBe(false);
  });
});

it("rejects avatar paths outside the agent workspace", async () => {
  await withTempHome(async (home) => {
    expect(
      validateConfigObject({
        agents: {
          entries: {
            main: {
              workspace: path.join(home, "branch"),
              identity: { avatar: "../oops.png" },
            },
          },
        },
      }),
    ).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          path: "agents.entries.main.identity.avatar",
          pathSegments: ["agents", "entries", "main", "identity", "avatar"],
        }),
      ],
    });
  });
});
