// A stand-in for expo-notifications in Jest. The real entry point registers for push tokens as soon as
// it is imported and has no native side here; tests that follow approvals through notifications use
// fakeNotifier.ts, and expoNotifier.test.ts checks what the app asks this module for.
export function expoNotificationsMock() {
  return {
    DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
    AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
    IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(async () => null),
    setNotificationCategoryAsync: jest.fn(async () => null),
    getPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'undetermined', canAskAgain: true, expires: 'never' })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true, expires: 'never' })),
    scheduleNotificationAsync: jest.fn(async (request: { identifier?: string }) => request.identifier ?? 'id'),
    dismissNotificationAsync: jest.fn(async () => undefined),
    setBadgeCountAsync: jest.fn(async () => true),
    addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
    getLastNotificationResponseAsync: jest.fn(async () => null),
    clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  };
}
