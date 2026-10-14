// The Settings pages other screens draw, plugged into the R1 Settings frame by page id. Chat apps (R1-09) brings its own
// page and its rows; the frame keeps nav, search and the level. Appearance keeps its row cards and draws the rows Classic
// did with more than a key (appearance-live.tsx), and Accounts draws every working Classic Accounts control on the
// engine's lists (accounts-live.tsx), so each R1 page has every working Classic control (#976).
import { CHAT_APP_ROWS, ChatAppsPage } from "../../chatapps";
import type { PageSlots } from "../slots";
import {
  AccountList, AddAccount, AddOwnAccount, KeepOakConnect, LinkButton, SaveProgressOffer, UsageList, UsageRing, UsageSpend, AnswerFirst, BranchIdentity, CheckApps, ClaudeCode, Codex, EachTrunkAccount, FallBackHere, FallbackKeys, GeminiCli,
  GitHubExpires, GitHubPermissions, GitHubRow, HubCommand, OwnAccountList, OwnFolder, RestingNow, SelectAccounts, SignInSources, SignOut, TestIt, WhichNext,
} from "./accounts-live";
import { classicSlot } from "./classic-host";
import { TRUNK_ROWS, TrunksPage } from "./trunks-live";
import { GENERAL_PAGE } from "./general-live";
import { HISTORY_ROWS } from "./history";
import {
  BackupNow, BackupOften, BackupSchedule, BackupWhere, CleanupAction, CleanupCode, DataFolder, EveryChange, ExportSettings, FillIn, ImportSettings, LastBackup,
  MediaAll, MediaFile, NeverDies, ReadDiary,
} from "./history-live";
import { DEVICES } from "./devices";
import { AccentColour, BackgroundPreview, EachTrunk, LightOrDark, PetPick, PetsHad, SmallModel, ThemePicker, ThreadsShowAs } from "./appearance-live";

/** Pages re-hosted from Classic (classic-host.tsx), by R1 page id: the Classic page each draws, with all its controls. */
export const REHOSTED = {
  who: "people", notifications: "notifications", instructions: "instructions", signins: "secrets", updates: ["updates", "achievements"],
  models: "models",
  permissions: "permissions",
  privacy: "usage",
  browser: "computer-browser", // Computer & browser's screen and browser sections (set2/computer-parts.tsx)
  coding: "computer-coding", // Accounts' coding apps and Computer & browser's code and git sections
} as const;

/** A re-hosted page's cards that no Classic control draws yet: Coming after its Classic sections, naming the call each
 *  waits for (nav sectionNeed). */
export const COMING: Partial<Record<keyof typeof REHOSTED, readonly string[]>> = {
  browser: ["Sites", "Saved flows"],
  coding: ["Commands", "Files"],
};

export const R1_PAGES: PageSlots = {
  ...Object.fromEntries(Object.entries(REHOSTED).map(([page, classic]) => [page, classicSlot(page as keyof typeof REHOSTED, classic, COMING[page as keyof typeof REHOSTED])])),
  chatapps: { component: ChatAppsPage, rows: CHAT_APP_ROWS },
  trunks: { component: TrunksPage, rows: TRUNK_ROWS },
  // History & backups: native R1 cards in the preview's order; Classic Backups, the overnight cleanup and Your settings
  // draw behind its rows (history-live.tsx).
  history: {
    rows: HISTORY_ROWS,
    controls: {
      "history.backups.schedule": BackupSchedule,
      "history.backups.often": BackupOften,
      "history.backups.where": BackupWhere,
      "history.backups.now": BackupNow,
      "history.backups.last": LastBackup,
      "history.backups.media-file": MediaFile,
      "history.backups.media-all": MediaAll,
      "history.snapshots.diary": ReadDiary,
      "history.snapshots.fill": FillIn,
      ...Object.fromEntries(["code-keep", "code-explain", "code-dry", "code-folder", "code-sessions"].map((id) => [`history.snapshots.${id}`, CleanupCode])),
      ...Object.fromEntries(["fill-notes", "reset", "dedupe", "repair"].map((id) => [`history.snapshots.${id}`, CleanupAction])),
      "history.undo.stops": NeverDies,
      "history.undo.crashing": NeverDies,
      "history.undo.last-good": NeverDies,
      "history.undo.changes": EveryChange,
      "history.copy.export": ExportSettings,
      "history.copy.import": ImportSettings,
      "history.copy.data": DataFolder,
    },
  },
  // Devices: native R1 cards in the preview's order, from Classic Computer & browser's section data (devices.tsx).
  devices: DEVICES,
  appearance: {
    controls: {
      "appearance.theme.mode": LightOrDark,
      "appearance.theme.pick": ThemePicker,
      "appearance.theme.accent": AccentColour,
      "appearance.background.preview": BackgroundPreview,
      "appearance.pet.pick": PetPick,
      "appearance.pet.had": PetsHad,
      "appearance.characters.each-trunk": EachTrunk,
      "appearance.list.threads": ThreadsShowAs,
      "appearance.list.small-model": SmallModel,
    },
  },
  accounts: {
    controls: {
      "accounts.usage.spend": UsageSpend,
      "accounts.usage.list": UsageList,
      "accounts.usage.ring": UsageRing,
      "accounts.usage.save-progress": SaveProgressOffer,
      "accounts.linked.gmail": LinkButton,
      "accounts.linked.calendar": LinkButton,
      "accounts.linked.drive": LinkButton,
      "accounts.keepoak.connect": KeepOakConnect,
      "accounts.order.list": AccountList,
      "accounts.order.add": AddAccount,
      "accounts.order.test": TestIt,
      "accounts.order.answer-first": AnswerFirst,
      "accounts.order.sign-out": SignOut,
      "accounts.order.select": SelectAccounts,
      "accounts.out.this-computer": FallBackHere,
      "accounts.next.mode": WhichNext,
      "accounts.own.list": OwnAccountList,
      "accounts.own.add": AddOwnAccount,
      "accounts.apps.claude": ClaudeCode,
      "accounts.apps.codex": Codex,
      "accounts.apps.gemini": GeminiCli,
      "accounts.apps.check": CheckApps,
      "accounts.sources.each": SignInSources,
      "accounts.github.connection": GitHubRow,
      "accounts.github.permissions": GitHubPermissions,
      "accounts.github.expires": GitHubExpires,
      "accounts.more.each-trunk": EachTrunkAccount,
      "accounts.more.fallback-keys": FallbackKeys,
      "accounts.more.resting": RestingNow,
      "accounts.tech.identity": BranchIdentity,
      "accounts.tech.hub": HubCommand,
      "accounts.tech.own-folder": OwnFolder,
    },
  },
  // General draws its pinned rows, projects, Keyboard shortcuts, All conversations and the model for summaries itself
  // (general-live.tsx).
  general: GENERAL_PAGE,
};
