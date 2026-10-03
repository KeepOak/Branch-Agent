import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { requireNodeSqlite } from "../../infra/node-sqlite.js";
import { createDeferredCore } from "../../shared/deferred.js";
import * as stateReads from "../../state/branch-state-db-readonly.js";
import { tableExists } from "../../state/branch-state-db-schema-helpers.js";
import {
  closeBranchStateDatabaseAsync,
  openBranchStateDatabase,
} from "../../state/branch-state-db.js";
import { ensureProfileForEmail } from "../../state/user-profiles.js";
import { withEnvAsync } from "../../test-utils/env.js";
import { observeMainThreadSql } from "../../test-utils/main-thread-sql-spies.test-support.js";
import { useStateDatabaseTempDirs } from "../../test-utils/state-database-temp-dirs.js";
import { materializeSkill } from "../loading/skill-materializer.js";
import { prepareSkillResourceDelivery } from "../runtime/resources.js";
import type { SkillSnapshot } from "../types.js";
import * as bundles from "./bundle.js";
import { decodeSkillLibraryFile } from "./bundle.js";
import * as selectionReads from "./selection-read.js";
import * as selection from "./selection.js";
import { loadSkillLibrarySelection } from "./selection.js";
import { saveSkillLibrary } from "./service.js";

const dirs = useStateDatabaseTempDirs();
const content =
  "---\nname: guide\ndescription: Saved procedure\n---\n# Guide\nRead references/data.bin.\n";

async function fixture() {
  const root = dirs.make("skill-library-resource-read-");
  const options = { env: { BRANCH_STATE_DIR: root } };
  const profile = ensureProfileForEmail("reader@example.test", options);
  const authority = {
    profileId: profile.id,
    scopes: ["operator.read", "operator.write"],
    getConfig: () => ({}),
    assertCurrent() {},
  };
  const saved = await saveSkillLibrary(
    authority,
    {
      slug: "guide",
      content,
      expectedRevision: null,
      files: [{ path: "references/data.bin", content: "AP+A", encoding: "base64" }],
    },
    options,
  );
  const pin = {
    skillId: saved.entry.skillId,
    revision: saved.entry.revision,
    name: saved.entry.name,
    ownerProfileId: saved.entry.ownerProfileId,
  };
  const snapshot: SkillSnapshot = {
    prompt: "",
    skills: [{ name: pin.name }],
    librarySelections: [pin],
  };
  const databasePath = openBranchStateDatabase(options).path;
  await closeBranchStateDatabaseAsync();
  return { root, options, authority, pin, snapshot, databasePath };
}

function familyHashes(databasePath: string) {
  return ["", "-wal", "-shm", "-journal"].map((suffix) => {
    const file = `${databasePath}${suffix}`;
    return fs.existsSync(file)
      ? [suffix, createHash("sha256").update(fs.readFileSync(file)).digest("hex")]
      : [suffix, null];
  });
}

it.each(["ordinary", "artifact-preserving", "disposable"] as const)(
  "delivers cold and warm immutable pins without parent SQL under %s reads",
  async (mode) => {
    const { root, snapshot, pin, databasePath } = await fixture();
    const before = familyHashes(databasePath);
    const execute = vi.spyOn(stateReads, "executeExistingBranchStateRead");
    requireNodeSqlite();
    const sql = observeMainThreadSql();
    const run = () =>
      withEnvAsync({ BRANCH_STATE_DIR: root }, async () => {
        const first = await prepareSkillResourceDelivery(snapshot, () => {});
        expect(first?.skills).toHaveLength(1);
        const skill = first!.skills[0]!;
        expect(skill.revision).toBe(pin.revision);
        expect(
          decodeSkillLibraryFile(skill.files.find((file) => file.path === "SKILL.md")!).toString(
            "utf8",
          ),
        ).toBe(content);
        expect(
          decodeSkillLibraryFile(skill.files.find((file) => file.path === "references/data.bin")!),
        ).toEqual(Buffer.from([0, 255, 128]));
        // The synchronous caller must reuse the same cache key as async preparation.
        expect(loadSkillLibrarySelection([pin])[0]?.skill.name).toBe(pin.name);
        expect(await prepareSkillResourceDelivery(structuredClone(snapshot), () => {})).toEqual(
          first,
        );
        await closeBranchStateDatabaseAsync();
      });
    try {
      if (mode === "artifact-preserving") {
        await stateReads.withArtifactPreservingStateReads(run);
      } else if (mode === "disposable") {
        await stateReads.withArtifactPreservingStateReads(() =>
          stateReads.withDisposableBranchStateReads(databasePath, run),
        );
      } else {
        await run();
      }
      sql.expectIdle();
      expect(execute.mock.calls.map(([, command]) => command.type)).toEqual([
        "skills.library.descriptions",
        "skills.library.manifests",
        "skills.library.manifests",
      ]);
      if (mode === "artifact-preserving") {
        expect(familyHashes(databasePath)).toEqual(before);
      }
    } finally {
      sql.restore();
    }
  },
);

it("reads both phases from the active snapshot without fetching hidden manifests", async () => {
  const { root, options, authority, pin, snapshot } = await fixture();
  const hidden = await saveSkillLibrary(
    authority,
    {
      slug: "hidden",
      content: content.replace("guide", "hidden"),
      expectedRevision: null,
    },
    options,
  );
  snapshot.librarySelections!.push({
    skillId: hidden.entry.skillId,
    revision: hidden.entry.revision,
    name: hidden.entry.name,
    ownerProfileId: hidden.entry.ownerProfileId,
  });
  await closeBranchStateDatabaseAsync();
  const execute = vi.spyOn(stateReads, "executeExistingBranchStateRead");
  await withEnvAsync({ BRANCH_STATE_DIR: root }, () =>
    stateReads.withBranchStateDatabaseReadSnapshot(async () => {
      const database = openBranchStateDatabase(options);
      database.db
        .prepare(
          "UPDATE skill_library_revisions SET description = ?, files_json = ? WHERE skill_id = ?",
        )
        .run("Later live description", "invalid live manifest", pin.skillId);
      const delivery = await prepareSkillResourceDelivery(snapshot, () => {});
      expect(delivery?.skills).toHaveLength(1);
      expect(delivery?.skills[0]?.description).toBe("Saved procedure");
      expect(delivery?.skills[0]?.revision).toBe(pin.revision);
      const manifests = execute.mock.calls
        .map(([, command]) => command)
        .find((command) => command.type === "skills.library.manifests");
      expect(manifests?.input).toEqual([{ skillId: pin.skillId, revision: pin.revision }]);
    }, options),
  );
});

it.each(["root", "authority", "admission"] as const)(
  "retains the captured owner when %s changes while descriptions are pending",
  async (change) => {
    const { root, snapshot } = await fixture();
    const other = dirs.make("skill-library-other-root-");
    const entered = createDeferredCore();
    const gate = createDeferredCore();
    const original = selectionReads.readSkillLibrarySelectionDescriptions;
    vi.spyOn(selectionReads, "readSkillLibrarySelectionDescriptions").mockImplementation(
      async (...args) => {
        const descriptions = await original(...args);
        entered.resolve();
        await gate.promise;
        return descriptions;
      },
    );
    const closed = new Error("Synthetic resource owner closed");
    let current = true;
    await withEnvAsync({ BRANCH_STATE_DIR: root }, async () => {
      const pending = prepareSkillResourceDelivery(snapshot, () => {
        if (!current) {
          throw closed;
        }
      });
      const outcome = pending.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await entered.promise;
      if (change === "root") {
        process.env.BRANCH_STATE_DIR = other;
      } else if (change === "admission") {
        await closeBranchStateDatabaseAsync();
      } else {
        current = false;
      }
      gate.resolve();
      const result = await outcome;
      if (change === "authority") {
        expect(result).toEqual({ error: closed });
      } else if (change === "admission") {
        expect(result).toHaveProperty("error");
      } else {
        expect(result).toMatchObject({ value: { skills: [{ description: "Saved procedure" }] } });
        expect(fs.existsSync(path.join(other, "state", "branch.sqlite"))).toBe(false);
      }
    });
  },
);

it.each(["selection", "descriptions", "manifests"] as const)(
  "retains pin values and eligibility when the caller mutates them during %s",
  async (phase) => {
    const { root, pin, snapshot } = await fixture();
    const originalPin = { ...pin };
    const entered = createDeferredCore();
    const gate = createDeferredCore();
    const descriptions = selectionReads.readSkillLibrarySelectionDescriptions;
    const manifests = selectionReads.readSkillLibrarySelectionManifests;
    async function hold<T>(value: T) {
      entered.resolve();
      await gate.promise;
      return value;
    }
    if (phase === "manifests") {
      vi.spyOn(selectionReads, "readSkillLibrarySelectionManifests").mockImplementation(
        async (...args) => hold(await manifests(...args)),
      );
    } else {
      vi.spyOn(selectionReads, "readSkillLibrarySelectionDescriptions").mockImplementation(
        async (...args) => hold(await descriptions(...args)),
      );
    }
    await withEnvAsync({ BRANCH_STATE_DIR: root }, async () => {
      const pending =
        phase === "selection"
          ? selection
              .prepareSkillLibrarySelection(snapshot.librarySelections!, {}, () => {})
              .then((entries) => entries.map((entry) => entry.skill))
          : prepareSkillResourceDelivery(snapshot, () => {}).then((delivery) => delivery?.skills);
      const outcome = pending.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      try {
        await entered.promise;
        Object.assign(pin, {
          skillId: "changed",
          revision: "0".repeat(64),
          name: "changed",
          ownerProfileId: null,
        });
        snapshot.librarySelections!.push({ ...pin });
        snapshot.skills[0]!.name = "changed";
        gate.resolve();
        expect(await outcome).toMatchObject({
          value: [{ name: originalPin.name, description: "Saved procedure" }],
        });
        expect(loadSkillLibrarySelection([originalPin])[0]?.skill.name).toBe(originalPin.name);
      } finally {
        gate.resolve();
        await outcome;
      }
    });
  },
);

it.each(["file", "table"] as const)(
  "does not create missing library %s storage",
  async (missing) => {
    const root = dirs.make("skill-library-missing-read-");
    const options = { env: { BRANCH_STATE_DIR: root } };
    if (missing === "table") {
      openBranchStateDatabase(options);
      await closeBranchStateDatabaseAsync();
    }
    const snapshot: SkillSnapshot = {
      prompt: "",
      skills: [{ name: "missing" }],
      librarySelections: [
        { skillId: "missing", revision: "0".repeat(64), name: "missing", ownerProfileId: null },
      ],
    };
    await withEnvAsync({ BRANCH_STATE_DIR: root }, async () => {
      await expect(prepareSkillResourceDelivery(snapshot, () => {})).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
    if (missing === "file") {
      expect(fs.existsSync(path.join(root, "state", "branch.sqlite"))).toBe(false);
    } else {
      expect(tableExists(openBranchStateDatabase(options).db, "skill_library_entries")).toBe(
        false,
      );
    }
  },
);

it.each(["workspace", "library"] as const)(
  "preserves the first %s failure and resource context before reading later candidates",
  async (first) => {
    const root = dirs.make("skill-library-read-order-");
    const skills = ["workspace", "library"].map((name) =>
      materializeSkill({
        name,
        description: name,
        content,
        frontmatter: {},
        filePath: path.join(root, name, "SKILL.md"),
        baseDir: path.join(root, name),
        source: "branch-workspace",
        sourceOptions: { source: "branch-workspace" },
      }),
    );
    const [workspace, library] = skills;
    const snapshot: SkillSnapshot = {
      prompt: "",
      skills: skills.map(({ name }) => ({ name })),
      resolvedSkills: first === "workspace" ? skills : [library!, workspace!],
      librarySelections: [
        { skillId: "library", revision: "0".repeat(64), name: "library", ownerProfileId: null },
      ],
    };
    const workspaceError = new Error("Synthetic workspace read failed");
    const libraryError = new Error("Synthetic database read failed");
    vi.spyOn(selection, "prepareSkillLibrarySelection").mockResolvedValue([]);
    const readWorkspace = vi
      .spyOn(bundles, "readSkillBundleTree")
      .mockRejectedValue(workspaceError);
    const readManifests = vi
      .spyOn(selectionReads, "readSkillLibrarySelectionManifests")
      .mockRejectedValue(libraryError);
    await withEnvAsync({ BRANCH_STATE_DIR: root }, async () => {
      await expect(prepareSkillResourceDelivery(snapshot, () => {})).rejects.toMatchObject({
        code: "INVALID_BUNDLE",
        message: expect.stringContaining(`skill="${first}"`),
        cause: first === "workspace" ? workspaceError : libraryError,
      });
    });
    expect(readWorkspace).toHaveBeenCalledTimes(first === "workspace" ? 1 : 0);
    expect(readManifests).toHaveBeenCalledTimes(first === "library" ? 1 : 0);
  },
);
