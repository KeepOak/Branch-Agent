import type { ComponentType } from "react";
import type { SettingsPageProps } from "../index";
import type { RowEntry } from "../kit";
import { VoicePage, VOICE_ROWS } from "../set1/voice";
import { ChatAppsPage, CHATAPPS_ROWS } from "../set1/chatapps";
import { PermissionsPage, PERMISSIONS_ROWS } from "../set1/permissions";

export const PAGES: Record<string, ComponentType<SettingsPageProps>> = {
  voice: VoicePage,
  chatapps: ChatAppsPage,
  permissions: PermissionsPage,
};

export const ROWS: RowEntry[] = [...VOICE_ROWS, ...CHATAPPS_ROWS, ...PERMISSIONS_ROWS];
