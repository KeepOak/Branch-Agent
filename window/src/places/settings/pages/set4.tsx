import type { ComponentType } from "react";
import type { SettingsPageProps } from "../index";
import type { RowEntry } from "../kit";
import { ROWS as UPDATE_ROWS, UpdatesPage } from "../set2/updates";
import { AchievementsPage, ROWS as ACHIEVEMENT_ROWS } from "../set2/achievements";
import { ROWS as SEASON_ROWS, SeasonsPage } from "../set2/seasons";
import { AdvancedPage, ROWS as ADVANCED_ROWS } from "../set2/advanced";
import { DeveloperPage, ROWS as DEVELOPER_ROWS } from "../set2/developer";

export const PAGES: Record<string, ComponentType<SettingsPageProps>> = {
  seasons: SeasonsPage,
  updates: UpdatesPage,
  achievements: AchievementsPage,
  advanced: AdvancedPage,
  developer: DeveloperPage,
};

/** Row search entries for these pages (title = the row's exact Ctl title). */
export const ROWS: RowEntry[] = [...SEASON_ROWS, ...UPDATE_ROWS, ...ACHIEVEMENT_ROWS, ...ADVANCED_ROWS, ...DEVELOPER_ROWS];
