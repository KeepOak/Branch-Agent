type UpdatesModule = {
  isEnabled: boolean;
  checkForUpdateAsync: () => Promise<{ isAvailable: boolean }>;
  fetchUpdateAsync: () => Promise<unknown>;
};

/**
 * Quiet JS-only update through expo-updates. Unconfigured, Expo Go, and offline are all a no-op: there
 * is no project ID in the repo, so `Updates.isEnabled` is false until EXPO_UPDATE_URL is set at build time.
 * runtimeVersion is the native version (see app.config.js), so an OTA never applies across a native bump.
 */
export async function applyQuietJsUpdate(load: () => Promise<UpdatesModule> = () => import('expo-updates')): Promise<void> {
  try {
    const Updates = await load();
    if (!Updates.isEnabled) return;
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return;
    await Updates.fetchUpdateAsync();
  } catch {
    // Unconfigured or unreachable: leave the bundled JS as it is.
  }
}
