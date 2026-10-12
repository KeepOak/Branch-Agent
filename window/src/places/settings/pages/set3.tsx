import type { ComponentType } from "react";
import type { SettingsPageProps } from "../index";
import type { RowEntry } from "../kit";
import { ComputerPage, ROWS as COMPUTER_ROWS } from "../set2/computer";
import { UsagePage, ROWS as USAGE_ROWS } from "../set2/usage";
import { SecretsPage, ROWS as SECRETS_ROWS } from "../set2/secrets";
import { GatewayPage, ROWS as GATEWAY_ROWS } from "../set2/gateway";
import { SelfPage, ROWS as SELF_ROWS } from "../set2/self";
import { AgentsPage, ROWS as AGENTS_ROWS } from "../set2/agents";
import { BackupsPage, ROWS as BACKUPS_ROWS } from "../set2/backups";

export const PAGES: Record<string, ComponentType<SettingsPageProps>> = {
  computer: ComputerPage,
  secrets: SecretsPage,
  usage: UsagePage,
  backups: BackupsPage,
  gateway: GatewayPage,
  self: SelfPage,
  agents: AgentsPage,
};

/** Row search entries for these pages (title = the row's exact Ctl title). */
export const ROWS: RowEntry[] = [...COMPUTER_ROWS, ...SECRETS_ROWS, ...USAGE_ROWS, ...GATEWAY_ROWS, ...SELF_ROWS, ...AGENTS_ROWS, ...BACKUPS_ROWS];
