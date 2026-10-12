// Plugin update selection tests cover CLI plugin update target selection.
import { describe, expect, it } from "vitest";
import type { HookInstallRecord } from "../config/types.hooks.js";
import type { PluginInstallRecord } from "../config/types.plugins.js";
import {
  resolveHookPackUpdateSelection,
  resolvePluginUpdateSelection,
} from "./plugins-update-selection.js";

function createNpmInstall(params: {
  spec: string;
  installPath?: string;
  resolvedName?: string;
}): PluginInstallRecord {
  return {
    source: "npm",
    spec: params.spec,
    installPath: params.installPath ?? "/tmp/plugin",
    ...(params.resolvedName ? { resolvedName: params.resolvedName } : {}),
  };
}

function createNpmHookInstall(params: {
  spec: string;
  installPath?: string;
  resolvedName?: string;
}): HookInstallRecord {
  return {
    source: "npm",
    spec: params.spec,
    installPath: params.installPath ?? "/tmp/hook-pack",
    ...(params.resolvedName ? { resolvedName: params.resolvedName } : {}),
  };
}

describe("resolvePluginUpdateSelection", () => {
  it.each(["@acme/missing-plugin@beta", "constructor"])(
    "does not select the untracked plugin target %s",
    (rawId) => {
      expect(resolvePluginUpdateSelection({ installs: {}, rawIds: [rawId] })).toEqual({
        pluginIds: [],
        unmatchedIds: [rawId],
      });
    },
  );

  it("does not guess an owner when an npm package maps to multiple tracked plugins", () => {
    expect(
      resolvePluginUpdateSelection({
        installs: {
          alpha: createNpmInstall({ spec: "@acme/shared", resolvedName: "@acme/shared" }),
          beta: createNpmInstall({ spec: "@acme/shared", resolvedName: "@acme/shared" }),
        },
        rawIds: ["@acme/shared@beta"],
      }),
    ).toEqual({ pluginIds: [], unmatchedIds: ["@acme/shared@beta"] });
  });

  it.each([
    {
      title: "maps an explicit unscoped npm dist-tag update to the tracked plugin id",
      pluginId: "branch-codex-app-server",
      packageNameWithSpec: "branch-codex-app-server",
      installPath: "/tmp/branch-codex-app-server",
      packageName: "branch-codex-app-server",
      requestedSpec: "branch-codex-app-server@beta",
      expectedPluginId: "branch-codex-app-server",
      expectedTrackedId: "branch-codex-app-server",
      expectedSpec: "branch-codex-app-server@beta",
    },
    {
      title: "maps an explicit scoped npm dist-tag update to the tracked plugin id",
      pluginId: "voice-call",
      packageNameWithSpec: "@branch/voice-call",
      installPath: "/tmp/voice-call",
      packageName: "@branch/voice-call",
      requestedSpec: "@branch/voice-call@beta",
      expectedPluginId: "voice-call",
      expectedTrackedId: "voice-call",
      expectedSpec: "@branch/voice-call@beta",
    },
    {
      title: "maps an explicit npm version update to the tracked plugin id",
      pluginId: "branch-codex-app-server",
      packageNameWithSpec: "branch-codex-app-server",
      installPath: "/tmp/branch-codex-app-server",
      packageName: "branch-codex-app-server",
      requestedSpec: "branch-codex-app-server@0.2.0-beta.4",
      expectedPluginId: "branch-codex-app-server",
      expectedTrackedId: "branch-codex-app-server",
      expectedSpec: "branch-codex-app-server@0.2.0-beta.4",
    },
    {
      title: "maps a bare scoped npm package update to the tracked plugin id",
      pluginId: "lossless-grove",
      packageNameWithSpec: "@martian-engineering/lossless-grove@0.9.0",
      installPath: "/tmp/lossless-grove",
      packageName: "@martian-engineering/lossless-grove",
      requestedSpec: "@martian-engineering/lossless-grove",
      expectedPluginId: "lossless-grove",
      expectedTrackedId: "lossless-grove",
      expectedSpec: "@martian-engineering/lossless-grove",
    },
  ])(
    "$title",
    ({
      pluginId,
      packageNameWithSpec,
      installPath,
      packageName,
      requestedSpec,
      expectedPluginId,
      expectedTrackedId,
      expectedSpec,
    }) => {
      expect(
        resolvePluginUpdateSelection({
          installs: {
            [pluginId]: createNpmInstall({
              spec: packageNameWithSpec,
              installPath,
              resolvedName: packageName,
            }),
          },
          rawIds: [requestedSpec],
        }),
      ).toEqual({
        pluginIds: [expectedPluginId],
        specOverrides: {
          [expectedTrackedId]: expectedSpec,
        },
      });
    },
  );

  it("keeps recorded npm tags when update is invoked by plugin id", () => {
    expect(
      resolvePluginUpdateSelection({
        installs: {
          "branch-codex-app-server": createNpmInstall({
            spec: "branch-codex-app-server@beta",
            installPath: "/tmp/branch-codex-app-server",
            resolvedName: "branch-codex-app-server",
          }),
        },
        rawIds: ["branch-codex-app-server"],
      }),
    ).toEqual({
      pluginIds: ["branch-codex-app-server"],
    });
  });

  it("resolves a packed child update to its tracked package owner", () => {
    expect(
      resolvePluginUpdateSelection({
        installs: {
          pack: createNpmInstall({ spec: "@acme/pack", resolvedName: "@acme/pack" }),
        },
        installOwnerByPluginId: new Map([
          ["pack/one", "pack"],
          ["pack/two", "pack"],
        ]),
        rawIds: ["pack/two"],
      }),
    ).toEqual({ pluginIds: ["pack"] });
  });

  it("deduplicates packed children and retains an explicit selector in input order", () => {
    expect(
      resolvePluginUpdateSelection({
        installs: {
          pack: createNpmInstall({ spec: "@acme/pack@stable" }),
          other: createNpmInstall({ spec: "@acme/other" }),
        },
        installOwnerByPluginId: new Map([
          ["pack/one", "pack"],
          ["pack/two", "pack"],
        ]),
        rawIds: ["pack/one", "other", "@acme/pack@beta", "pack/two", "@acme/pack@beta"],
      }),
    ).toEqual({ pluginIds: ["pack", "other"], specOverrides: { pack: "@acme/pack@beta" } });
  });

  it("does not infer a packed child owner when owner metadata is missing", () => {
    expect(
      resolvePluginUpdateSelection({
        installs: {
          pack: createNpmInstall({ spec: "@acme/pack", resolvedName: "@acme/pack" }),
        },
        rawIds: ["pack/two"],
      }),
    ).toEqual({ pluginIds: [], unmatchedIds: ["pack/two"] });
  });

  it("rejects an ambiguous child before exact install-record selection", () => {
    expect(
      resolvePluginUpdateSelection({
        installs: {
          "pack/one": createNpmInstall({ spec: "@acme/pack" }),
          "pack/two": createNpmInstall({ spec: "@acme/pack" }),
        },
        rejectedPluginIds: new Map([
          ["pack/one", "ambiguous pack/one"],
          ["pack/two", "ambiguous pack/two"],
        ]),
        rawIds: ["pack/one"],
      }),
    ).toEqual({ pluginIds: [], error: "ambiguous pack/one" });
  });

  it("rejects an ambiguous package owner for targeted and update-all selection", () => {
    const installs = {
      pack: createNpmInstall({ spec: "@acme/pack" }),
      stable: createNpmInstall({ spec: "@acme/stable" }),
    };
    const rejectedPluginIds = new Map([["pack", "ambiguous pack"]]);

    expect(resolvePluginUpdateSelection({ installs, rejectedPluginIds, rawIds: ["pack"] })).toEqual(
      {
        pluginIds: [],
        error: "ambiguous pack",
      },
    );
    expect(
      resolvePluginUpdateSelection({ installs, rejectedPluginIds, rawIds: [], all: true }),
    ).toEqual({
      pluginIds: [],
      error: "ambiguous pack",
    });
  });

  it("maps prototype-named npm packages by own install records", () => {
    expect(
      resolvePluginUpdateSelection({
        installs: {
          "tracked-constructor": createNpmInstall({
            spec: "constructor",
            resolvedName: "constructor",
          }),
        },
        rawIds: ["constructor"],
      }),
    ).toEqual({
      pluginIds: ["tracked-constructor"],
      specOverrides: {
        "tracked-constructor": "constructor",
      },
    });
  });
});

describe("resolveHookPackUpdateSelection", () => {
  it.each([
    { packageName: "branch-demo-hooks", requestedSpec: "branch-demo-hooks" },
    { packageName: "@acme/demo-hooks", requestedSpec: "@acme/demo-hooks@beta" },
  ])(
    "maps npm package spec $requestedSpec to its tracked hook pack",
    ({ packageName, requestedSpec }) => {
      expect(
        resolveHookPackUpdateSelection({
          installs: {
            "demo-hooks": createNpmHookInstall({
              spec: `${packageName}@1.0.0`,
              resolvedName: packageName,
            }),
          },
          rawIds: [requestedSpec],
        }),
      ).toEqual({
        hookIds: ["demo-hooks"],
        specOverrides: { "demo-hooks": requestedSpec },
      });
    },
  );

  it("preserves the tracked npm spec when updating by exact hook-pack id", () => {
    expect(
      resolveHookPackUpdateSelection({
        installs: {
          "demo-hooks": createNpmHookInstall({ spec: "@acme/demo-hooks@beta" }),
        },
        rawIds: ["demo-hooks"],
      }),
    ).toEqual({ hookIds: ["demo-hooks"] });
  });

  it("does not guess an owner when an npm package maps to multiple tracked hook packs", () => {
    expect(
      resolveHookPackUpdateSelection({
        installs: {
          alpha: createNpmHookInstall({ spec: "@acme/shared" }),
          beta: createNpmHookInstall({ spec: "@acme/shared" }),
        },
        rawIds: ["@acme/shared"],
      }),
    ).toEqual({ hookIds: [], unmatchedIds: ["@acme/shared"] });
  });

  it("does not treat inherited prototype keys as installed hook ids", () => {
    expect(
      resolveHookPackUpdateSelection({
        installs: {},
        rawIds: ["constructor"],
      }),
    ).toEqual({
      hookIds: [],
      unmatchedIds: ["constructor"],
    });
  });

  it("keeps own prototype-named hook ids selectable", () => {
    expect(
      resolveHookPackUpdateSelection({
        installs: {
          constructor: createNpmHookInstall({
            spec: "branch-hooks-constructor",
            resolvedName: "branch-hooks-constructor",
          }),
        },
        rawIds: ["constructor"],
      }),
    ).toEqual({
      hookIds: ["constructor"],
    });
  });
});
