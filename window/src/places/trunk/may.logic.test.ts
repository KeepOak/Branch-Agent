import { describe, expect, it } from "vitest";
import { ENGINE_DEFAULTS, NUMBER_KEYS, mayChanges, readDefaults, readMay } from "./may";
import { readConfig } from "./model";

/** Wording from `readMay` (preview mayHTMLC18 / mayMorePC18 have no lock copy; these are the engine-backed reasons). */
const EVERY_TRUNK_LOCK = "Turned off for every Trunk in the engine’s tool settings.";
const ALLOW_LIST_LOCK = "Its own tool list leaves the browser out. Change it in the engine’s tool settings.";
const GROUP_UI_LOCK = "Its own tool list turns off the screen tools, the browser with them. Change it in the engine’s tool settings.";

function snap(config: Record<string, unknown>) {
  return readConfig({ hash: "h1", config });
}

describe("readMay", () => {
  it("reads workspace-only, denied tools, exec host/node and the decision model from a config entry", () => {
    const loaded = snap({
      agents: {
        entries: {
          oak: {
            decisionModel: "openai/gpt-4o",
            model: { fallbacks: ["anthropic/claude-3.5"] },
            tools: { fs: { workspaceOnly: true }, deny: ["browser"], exec: { host: "node", node: "n1" } },
          },
        },
      },
    });
    expect(readMay(loaded, "oak")).toEqual({
      read: false,
      browse: false,
      browseLock: "",
      decide: "openai/gpt-4o",
      fallbacks: ["anthropic/claude-3.5"],
      startOn: "n1",
    });

    expect(readMay(snap({ agents: { entries: { oak: {} } } }), "oak")).toMatchObject({
      read: true,
      browse: true,
      browseLock: "",
      decide: "same",
      fallbacks: [],
      startOn: "this",
    });
    expect(readMay(snap({ tools: { fs: { workspaceOnly: true } }, agents: { entries: { oak: {} } } }), "oak").read).toBe(false);
    const emptyDecision = snap({ agents: { entries: { oak: { decisionModel: "" } } } });
    expect(readMay(emptyDecision, "oak").decide).toBe("none");
    const nodeOnly = snap({ agents: { entries: { oak: { tools: { exec: { host: "node" } } } } } });
    expect(readMay(nodeOnly, "oak").startOn).toBe("this");
  });

  it("prefers the Trunk's workspace-only over the rule for every Trunk", () => {
    const entryWins = snap({
      tools: { fs: { workspaceOnly: true } },
      agents: { entries: { oak: { tools: { fs: { workspaceOnly: false } } } } },
    });
    expect(readMay(entryWins, "oak").read).toBe(true);
  });

  it("locks the browser for every Trunk when the engine denies browser or group:ui", () => {
    expect(readMay(snap({ tools: { deny: ["browser"] }, agents: { entries: { oak: {} } } }), "oak")).toMatchObject({
      browse: false,
      browseLock: EVERY_TRUNK_LOCK,
    });
    expect(readMay(snap({ tools: { deny: ["group:ui"] }, agents: { entries: { oak: {} } } }), "oak")).toMatchObject({
      browse: false,
      browseLock: EVERY_TRUNK_LOCK,
    });
  });

  it("explains a Trunk-level allow list or group:ui deny that the person can't change here", () => {
    expect(readMay(snap({ agents: { entries: { oak: { tools: { allow: ["read", "write"] } } } } }), "oak")).toMatchObject({
      browse: false,
      browseLock: ALLOW_LIST_LOCK,
    });
    expect(readMay(snap({ agents: { entries: { oak: { tools: { deny: ["group:ui"] } } } } }), "oak")).toMatchObject({
      browse: false,
      browseLock: GROUP_UI_LOCK,
    });
    expect(readMay(snap({
      tools: { deny: ["browser"] },
      agents: { entries: { oak: { tools: { deny: ["group:ui"] } } } },
    }), "oak").browseLock).toBe(EVERY_TRUNK_LOCK);
  });

  it("keeps browse on when the allow list includes the browser, group:ui, or *", () => {
    expect(readMay(snap({ agents: { entries: { oak: { tools: { allow: ["browser", "read"] } } } } }), "oak")).toMatchObject({
      browse: true,
      browseLock: "",
    });
    expect(readMay(snap({ agents: { entries: { oak: { tools: { allow: ["group:ui"] } } } } }), "oak").browse).toBe(true);
    expect(readMay(snap({ agents: { entries: { oak: { tools: { allow: ["*"] } } } } }), "oak").browse).toBe(true);
  });

  it("treats a Trunk deny of browser alone as off, not locked", () => {
    expect(readMay(snap({ agents: { entries: { oak: { tools: { deny: ["browser"] } } } } }), "oak")).toMatchObject({
      browse: false,
      browseLock: "",
    });
  });
});

describe("mayChanges", () => {
  it("returns exactly the config.patch paths that changed and nothing when nothing did", () => {
    const empty = snap({ agents: { entries: { oak: {} } } });
    const was = readMay(empty, "oak");
    expect(mayChanges(empty, "oak", was, was, "openai/gpt-4o")).toEqual({});

    expect(mayChanges(empty, "oak", was, { ...was, read: false, browse: false, decide: "openai/gpt-4o", fallbacks: ["anthropic/claude-3.5"], startOn: "n1" }, "primary-model")).toEqual({
      "agents.entries.oak.tools.fs.workspaceOnly": true,
      "agents.entries.oak.tools.deny": ["browser"],
      "agents.entries.oak.decisionModel": "openai/gpt-4o",
      "agents.entries.oak.model": { primary: "primary-model", fallbacks: ["anthropic/claude-3.5"] },
      "agents.entries.oak.tools.exec": { host: "node", node: "n1" },
    });
  });

  it("writes false, not null, to turn reading on against the rule for every Trunk", () => {
    const every = snap({ tools: { fs: { workspaceOnly: true } }, agents: { entries: { oak: {} } } });
    const was = readMay(every, "oak");
    expect(mayChanges(every, "oak", was, { ...was, read: true }, "")).toEqual({
      "agents.entries.oak.tools.fs.workspaceOnly": false,
    });

    const own = snap({ agents: { entries: { oak: { tools: { fs: { workspaceOnly: true } } } } } });
    const ownWas = readMay(own, "oak");
    expect(mayChanges(own, "oak", ownWas, { ...ownWas, read: true }, "")).toEqual({
      "agents.entries.oak.tools.fs.workspaceOnly": null,
    });
  });

  it("adds or removes browser on the deny list without dropping other tools", () => {
    const empty = snap({ agents: { entries: { oak: {} } } });
    const was = readMay(empty, "oak");
    expect(mayChanges(empty, "oak", was, { ...was, browse: false }, "")).toEqual({
      "agents.entries.oak.tools.deny": ["browser"],
    });

    const denied = snap({ agents: { entries: { oak: { tools: { deny: ["exec", "browser"] } } } } });
    const deniedWas = readMay(denied, "oak");
    expect(mayChanges(denied, "oak", deniedWas, { ...deniedWas, browse: true }, "")).toEqual({
      "agents.entries.oak.tools.deny": ["exec"],
    });

    const onlyBrowser = snap({ agents: { entries: { oak: { tools: { deny: ["browser"] } } } } });
    const onlyWas = readMay(onlyBrowser, "oak");
    expect(mayChanges(onlyBrowser, "oak", onlyWas, { ...onlyWas, browse: true }, "")).toEqual({
      "agents.entries.oak.tools.deny": null,
    });
  });

  it("maps decide same/none/model and fallbacks to the engine's decisionModel and model paths", () => {
    const set = snap({ agents: { entries: { oak: { decisionModel: "openai/gpt-4o", model: { fallbacks: ["openai/gpt-4o"] } } } } });
    const was = readMay(set, "oak");
    expect(mayChanges(set, "oak", was, { ...was, decide: "same" }, "openai/gpt-4o")).toEqual({
      "agents.entries.oak.decisionModel": null,
    });
    expect(mayChanges(set, "oak", was, { ...was, decide: "none" }, "openai/gpt-4o")).toEqual({
      "agents.entries.oak.decisionModel": "",
    });

    const empty = snap({ agents: { entries: { oak: {} } } });
    const emptyWas = readMay(empty, "oak");
    expect(mayChanges(empty, "oak", emptyWas, { ...emptyWas, decide: "openai/gpt-4o" }, "openai/gpt-4o")).toEqual({
      "agents.entries.oak.decisionModel": "openai/gpt-4o",
    });
    expect(mayChanges(empty, "oak", emptyWas, { ...emptyWas, fallbacks: ["openai/gpt-4o"] }, "")).toEqual({
      "agents.entries.oak.model": { primary: null, fallbacks: ["openai/gpt-4o"] },
    });
    expect(mayChanges(set, "oak", was, { ...was, fallbacks: [] }, "primary-model")).toEqual({
      "agents.entries.oak.model": { primary: "primary-model", fallbacks: null },
    });
  });

  it("writes exec host/node when Its computers changes, and clears them for this computer", () => {
    const empty = snap({ agents: { entries: { oak: {} } } });
    const was = readMay(empty, "oak");
    expect(mayChanges(empty, "oak", was, { ...was, startOn: "n1" }, "")).toEqual({
      "agents.entries.oak.tools.exec": { host: "node", node: "n1" },
    });

    const remote = snap({ agents: { entries: { oak: { tools: { exec: { host: "node", node: "n1" } } } } } });
    const remoteWas = readMay(remote, "oak");
    expect(mayChanges(remote, "oak", remoteWas, { ...remoteWas, startOn: "this" }, "")).toEqual({
      "agents.entries.oak.tools.exec": { host: null, node: null },
    });
  });
});

describe("readDefaults", () => {
  it("falls back to ENGINE_DEFAULTS when a default is unset", () => {
    const empty = readDefaults(snap({}));
    expect(empty).toEqual({
      cwd: "",
      workspace: "",
      bootstrapMaxChars: "",
      bootstrapTotalMaxChars: "",
      userTimezone: "",
      imageMaxDimensionPx: "",
    });
    expect(ENGINE_DEFAULTS).toEqual({
      bootstrapMaxChars: "20000",
      bootstrapTotalMaxChars: "60000",
      imageMaxDimensionPx: "1200",
    });
    for (const key of NUMBER_KEYS) {
      expect(empty[key] || ENGINE_DEFAULTS[key]).toBe(ENGINE_DEFAULTS[key]);
    }
  });

  it("stringifies set defaults and treats null as unset", () => {
    const values = readDefaults(snap({
      agents: {
        defaults: {
          cwd: "/work",
          workspace: "/trunks",
          bootstrapMaxChars: 25000,
          bootstrapTotalMaxChars: 70000,
          userTimezone: "America/New_York",
          imageMaxDimensionPx: 1600,
        },
      },
    }));
    expect(values).toEqual({
      cwd: "/work",
      workspace: "/trunks",
      bootstrapMaxChars: "25000",
      bootstrapTotalMaxChars: "70000",
      userTimezone: "America/New_York",
      imageMaxDimensionPx: "1600",
    });
    expect(readDefaults(snap({ agents: { defaults: { cwd: null, bootstrapMaxChars: 30000 } } }))).toMatchObject({
      cwd: "",
      bootstrapMaxChars: "30000",
    });
  });
});
