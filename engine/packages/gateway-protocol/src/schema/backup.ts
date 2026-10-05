import type { Static } from "typebox";
import { Type } from "typebox";
import { closedObject } from "./closed-object.js";
import { StorageLocationsListResultSchema } from "./storage.js";

const BackupKindSchema = Type.Union([
  Type.Literal("archive"),
  Type.Literal("sqlite-snapshot"),
  Type.Literal("git"),
  Type.Literal("external"),
]);
const BytesSchema = Type.Integer({ minimum: 0 });
export const BackupRunLocationSchema = closedObject({
  name: Type.String(),
  provider: Type.String(),
  locationId: Type.String(),
  key: Type.String(),
  namespace: Type.String(),
  plaintextBytes: BytesSchema,
  storedBytes: BytesSchema,
});
export const BackupRunRetentionSchema = closedObject({ kept: BytesSchema, deleted: BytesSchema });
export const BackupRunRecordSchema = closedObject({
  id: Type.String(),
  createdAt: Type.Number(),
  archivePath: Type.String(),
  status: Type.Union([Type.Literal("ok"), Type.Literal("failed")]),
  kind: BackupKindSchema,
  target: Type.Optional(Type.String()),
  namespace: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  pushFailed: Type.Optional(Type.Literal(true)),
  bytes: Type.Optional(BytesSchema),
  location: Type.Optional(BackupRunLocationSchema),
  retention: Type.Optional(BackupRunRetentionSchema),
});
export const BackupStatusParamsSchema = closedObject({});
export const BackupStatusResultSchema = closedObject({
  targets: Type.Array(
    closedObject({
      kind: BackupKindSchema,
      target: Type.String(),
      namespace: Type.Optional(Type.String()),
      latest: BackupRunRecordSchema,
      latestOk: Type.Optional(BackupRunRecordSchema),
    }),
  ),
  schedules: Type.Array(
    closedObject({
      id: Type.String(),
      mode: Type.Union([Type.Literal("git"), Type.Literal("offsite")]),
      target: Type.String(),
      namespace: Type.Optional(Type.String()),
      enabled: Type.Boolean(),
      everyMs: Type.Number(),
      nextRunAtMs: Type.Optional(Type.Number()),
      push: Type.Optional(Type.Boolean()),
      excludeSecrets: Type.Optional(Type.Boolean()),
      files: Type.Optional(Type.Boolean()),
      /** Git schedules that push: the repository address, without any sign-in. */
      remote: Type.Optional(Type.String()),
    }),
  ),
  locations: StorageLocationsListResultSchema.properties.locations,
});
/** Branch Settings › Backups: where the scheduled Git backup goes and how often it runs. */
export const BackupScheduleSetParamsSchema = closedObject({
  destination: Type.Union([
    closedObject({ kind: Type.Literal("folder"), path: Type.String({ minLength: 1 }) }),
    closedObject({ kind: Type.Literal("git"), url: Type.String({ minLength: 1 }) }),
  ]),
  everyMs: Type.Integer({ minimum: 60_000 }),
  enabled: Type.Boolean(),
});
export const BackupScheduleSetResultSchema = closedObject({
  id: Type.String(),
  repository: Type.String(),
  push: Type.Boolean(),
  enabled: Type.Boolean(),
  everyMs: Type.Number(),
});
export const BackupScheduleClearParamsSchema = closedObject({});
export const BackupScheduleClearResultSchema = closedObject({ removed: Type.Boolean() });
export const BackupRunParamsSchema = closedObject({});
export const BackupRunResultSchema = closedObject({
  jobId: Type.String(),
  started: Type.Boolean(),
  reason: Type.Optional(Type.String()),
});
export type BackupScheduleSetParams = Static<typeof BackupScheduleSetParamsSchema>;
export type BackupScheduleSetResult = Static<typeof BackupScheduleSetResultSchema>;
export type BackupScheduleClearParams = Static<typeof BackupScheduleClearParamsSchema>;
export type BackupScheduleClearResult = Static<typeof BackupScheduleClearResultSchema>;
export type BackupRunParams = Static<typeof BackupRunParamsSchema>;
export type BackupRunResult = Static<typeof BackupRunResultSchema>;
export type BackupRunRecord = Static<typeof BackupRunRecordSchema>;
export type BackupRunLocation = Static<typeof BackupRunLocationSchema>;
export type BackupRunRetention = Static<typeof BackupRunRetentionSchema>;
export type BackupStatusParams = Static<typeof BackupStatusParamsSchema>;
export type BackupStatusResult = Static<typeof BackupStatusResultSchema>;
