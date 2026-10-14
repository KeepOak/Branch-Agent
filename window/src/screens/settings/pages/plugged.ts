// The Settings pages other screens draw, plugged into the R1 Settings frame by page id. Chat apps (R1-09) brings its own
// page and its rows; the frame keeps nav, search and the level. Appearance keeps its row cards and draws the rows Classic
// did with more than a key (appearance-live.tsx), and Accounts draws every working Classic Accounts control on the
// engine's lists (accounts-live.tsx), so each R1 page has every working Classic control (#976).
import { CHAT_APP_ROWS, ChatAppsPage } from "../../chatapps";
import type { PageSlots } from "../slots";
import {
  AccountList, AddAccount, AddOwnAccount, AnswerFirst, BranchIdentity, CheckApps, ClaudeCode, Codex, EachTrunkAccount, FallBackHere, FallbackKeys, GeminiCli,
  GitHubExpires, GitHubPermissions, GitHubRow, HubCommand, OwnAccountList, OwnFolder, RestingNow, SelectAccounts, SignInSources, SignOut, TestIt, WhichNext,
} from "./accounts-live";
import { classicSlot } from "./classic-host";
import { TRUNK_ROWS, TrunksPage } from "./trunks-live";
import { AccentColour, BackgroundPreview, EachTrunk, LightOrDark, PetPick, PetsHad, SmallModel, ThemePicker, ThreadsShowAs } from "./appearance-live";

/** Pages re-hosted from Classic (classic-host.tsx), by R1 page id: the Classic page each draws, with all its controls. */
export const REHOSTED = {
  who: "people", notifications: "notifications", instructions: "instructions", signins: "secrets", updates: ["updates", "achievements"],
  models: "models",
  permissions: "permissions",
  privacy: "usage",
  history: "backups",
  learning: ["self", "seasons"],
} as const;

export const R1_PAGES: PageSlots = {
  ...Object.fromEntries(Object.entries(REHOSTED).map(([page, classic]) => [page, classicSlot(page as keyof typeof REHOSTED, classic)])),
  chatapps: { component: ChatAppsPage, rows: CHAT_APP_ROWS },
  trunks: { component: TrunksPage, rows: TRUNK_ROWS },
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
};
