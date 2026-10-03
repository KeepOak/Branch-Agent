import { fileURLToPath } from "node:url";
import type {
  PluginDoctorStateMigration,
  PluginDoctorStateMigrationContext,
} from "branch/plugin-sdk/runtime-doctor-migrations";
import type {
  PersistedCanopyAttachment,
  PersistedCanopyBoard,
  PersistedCanopyCard,
  PersistedCanopyNotificationSubscription,
  CanopyKeyedStore,
} from "./src/persistence-types.js";

const MAX_CARDS = 2000;

function migrationEnv(params: { env: NodeJS.ProcessEnv; stateDir: string }): NodeJS.ProcessEnv {
  return { ...params.env, BRANCH_STATE_DIR: params.stateDir };
}

function openLegacyStores(context: PluginDoctorStateMigrationContext, env: NodeJS.ProcessEnv) {
  return {
    cards: context.openPluginStateKeyedStore<PersistedCanopyCard>({
      namespace: "canopy.cards",
      maxEntries: MAX_CARDS,
      env,
    }),
    boards: context.openPluginStateKeyedStore<PersistedCanopyBoard>({
      namespace: "canopy.boards",
      maxEntries: 200,
      env,
    }),
    subscriptions: context.openPluginStateKeyedStore<PersistedCanopyNotificationSubscription>({
      namespace: "canopy.notify",
      maxEntries: 2000,
      env,
    }),
    attachments: context.openPluginStateKeyedStore<PersistedCanopyAttachment>({
      namespace: "canopy.attachments",
      maxEntries: MAX_CARDS * 21,
      env,
    }),
  };
}

function hasPersistedVersion(value: unknown): boolean {
  return value !== null && typeof value === "object" && "version" in value && value.version === 1;
}

function isPersistedAttachment(value: unknown): value is PersistedCanopyAttachment {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as {
    version?: unknown;
    attachment?: Partial<PersistedCanopyAttachment["attachment"]>;
    contentBase64?: unknown;
  };
  const attachment = candidate.attachment;
  return (
    candidate.version === 1 &&
    attachment != null &&
    typeof attachment === "object" &&
    typeof attachment.id === "string" &&
    typeof attachment.cardId === "string" &&
    typeof attachment.fileName === "string" &&
    typeof attachment.byteSize === "number" &&
    typeof attachment.createdAt === "number" &&
    typeof candidate.contentBase64 === "string"
  );
}

async function migrateNamespace<T>(params: {
  label: string;
  legacy: CanopyKeyedStore<T>;
  target: CanopyKeyedStore<T>;
  isValid: (value: unknown) => boolean;
}): Promise<{ imported: number; warnings: string[] }> {
  const warnings: string[] = [];
  let imported = 0;
  for (const entry of await params.legacy.entries()) {
    if (!params.isValid(entry.value)) {
      warnings.push(`Skipped malformed legacy Canopy ${params.label} entry ${entry.key}`);
      continue;
    }
    try {
      const targetEntry = await params.target.lookup(entry.key);
      if (targetEntry) {
        if (JSON.stringify(targetEntry) === JSON.stringify(entry.value)) {
          await params.legacy.delete(entry.key);
          imported++;
          continue;
        }
        warnings.push(
          `Skipped legacy Canopy ${params.label} entry ${entry.key} because the SQLite target already exists`,
        );
        continue;
      }
      await params.target.register(entry.key, entry.value);
      await params.legacy.delete(entry.key);
      imported++;
    } catch (err) {
      warnings.push(
        `Failed migrating legacy Canopy ${params.label} entry ${entry.key}: ${String(err)}`,
      );
    }
  }
  return { imported, warnings };
}

async function targetCardReferencesAttachment(
  cards: CanopyKeyedStore,
  attachment: PersistedCanopyAttachment,
): Promise<boolean> {
  const card = await cards.lookup(attachment.attachment.cardId);
  return Boolean(
    card?.version === 1 &&
    card.card.metadata?.attachments?.some(
      (entry) =>
        entry.id === attachment.attachment.id && entry.cardId === attachment.attachment.cardId,
    ),
  );
}

async function migrateAttachments(params: {
  legacy: CanopyKeyedStore<PersistedCanopyAttachment>;
  cards: CanopyKeyedStore;
  target: CanopyKeyedStore<PersistedCanopyAttachment>;
}): Promise<{ imported: number; warnings: string[] }> {
  const warnings: string[] = [];
  let imported = 0;
  for (const entry of await params.legacy.entries()) {
    if (!isPersistedAttachment(entry.value)) {
      warnings.push(`Skipped malformed legacy Canopy attachment entry ${entry.key}`);
      continue;
    }
    if (!(await targetCardReferencesAttachment(params.cards, entry.value))) {
      warnings.push(
        `Skipped legacy Canopy attachment entry ${entry.key} because its owning card was not migrated or does not reference the attachment`,
      );
      continue;
    }
    const targetEntry = await params.target.lookup(entry.key);
    if (targetEntry) {
      if (JSON.stringify(targetEntry) === JSON.stringify(entry.value)) {
        await params.legacy.delete(entry.key);
        imported++;
        continue;
      }
      warnings.push(
        `Skipped legacy Canopy attachment entry ${entry.key} because the SQLite target already exists`,
      );
      continue;
    }
    try {
      await params.target.register(entry.key, entry.value);
      await params.legacy.delete(entry.key);
      imported++;
    } catch (err) {
      warnings.push(
        `Failed migrating legacy Canopy attachment entry ${entry.key}: ${String(err)}`,
      );
    }
  }
  return { imported, warnings };
}

export const stateMigrations: PluginDoctorStateMigration[] = [
  {
    id: "canopy-28-kv-to-sqlite",
    label: "Canopy .28 plugin-state KV",
    async detectLegacyState(params) {
      const env = migrationEnv(params);
      const { cards, boards, subscriptions, attachments } = openLegacyStores(params.context, env);
      let count = 0;
      for (const store of [cards, boards, subscriptions, attachments]) {
        count += store.count ? await store.count() : (await store.entries()).length;
      }
      if (count === 0) {
        return null;
      }
      // Empty legacy namespaces need no SQLite runtime. Resolve the target only
      // when there is state to preview and migrate.
      const { resolveCanopySqlitePath } = await import("./src/sqlite-store-paths.js");
      return {
        preview: [
          `- Canopy: ${count} legacy .28 plugin-state KV ${count === 1 ? "entry" : "entries"} → ${resolveCanopySqlitePath(env)}`,
        ],
      };
    },
    async migrateLegacyState(params) {
      const { createCanopySqliteStores } = await import("./src/sqlite-store.js");
      const { resolveCanopySqliteWorkerModuleUrl } = await import("./src/sqlite-store-paths.js");
      const env = migrationEnv(params);
      const { cards, boards, subscriptions, attachments } = openLegacyStores(params.context, env);
      const sqlite = createCanopySqliteStores({
        env,
        workerModuleUrl: resolveCanopySqliteWorkerModuleUrl(fileURLToPath(import.meta.url)),
      });
      try {
        const cardResult = await migrateNamespace({
          label: "card",
          legacy: cards,
          target: sqlite.cards,
          isValid: hasPersistedVersion,
        });
        const boardResult = await migrateNamespace({
          label: "board",
          legacy: boards,
          target: sqlite.boards,
          isValid: hasPersistedVersion,
        });
        const subscriptionResult = await migrateNamespace({
          label: "notification subscription",
          legacy: subscriptions,
          target: sqlite.subscriptions,
          isValid: hasPersistedVersion,
        });
        const attachmentResult = await migrateAttachments({
          legacy: attachments,
          cards: sqlite.cards,
          target: sqlite.attachments,
        });
        const imported =
          cardResult.imported +
          boardResult.imported +
          subscriptionResult.imported +
          attachmentResult.imported;
        return {
          changes:
            imported > 0
              ? [
                  `Migrated ${imported} Canopy .28 plugin-state KV ${imported === 1 ? "entry" : "entries"} → relational SQLite`,
                ]
              : [],
          warnings: [
            ...cardResult.warnings,
            ...boardResult.warnings,
            ...subscriptionResult.warnings,
            ...attachmentResult.warnings,
          ],
        };
      } finally {
        await sqlite.close();
      }
    },
  },
];
