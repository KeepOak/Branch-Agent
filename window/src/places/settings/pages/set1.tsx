import type { ComponentType } from "react";
import type { SettingsPageProps } from "../index";
import type { RowEntry } from "../kit";
import { ModelsAccountsPage } from "../set1/models-accounts";
import { GeneralPage, GENERAL_ROWS } from "../set1/general";
import { PeoplePage, PEOPLE_ROWS } from "../set1/people";
import { AppearancePage, APPEARANCE_ROWS } from "../set1/appearance";
import { NotificationsPage, NOTIFICATIONS_ROWS } from "../set1/notifications";
import { InstructionsPage, INSTRUCTIONS_ROWS } from "../set1/instructions";
import { MODELS_ROWS } from "../set1/models";
import { LOCAL_ROWS } from "../set1/local";
import { ACCOUNTS_ROWS } from "../set1/rows";

export const PAGES: Record<string, ComponentType<SettingsPageProps>> = {
  general: GeneralPage,
  people: PeoplePage,
  appearance: AppearancePage,
  notifications: NotificationsPage,
  instructions: InstructionsPage,
  models: ModelsAccountsPage,
  local: ModelsAccountsPage,
  accounts: ModelsAccountsPage,
};

export const ROWS: RowEntry[] = [...GENERAL_ROWS, ...PEOPLE_ROWS, ...APPEARANCE_ROWS, ...NOTIFICATIONS_ROWS, ...INSTRUCTIONS_ROWS, ...MODELS_ROWS, ...LOCAL_ROWS, ...ACCOUNTS_ROWS];
