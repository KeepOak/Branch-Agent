// The library's own test double: real safe-area insets need a native layout pass.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// expo-notifications registers for push tokens on import and has no native side in Jest (see the file).
jest.mock('expo-notifications', () => require('./src/testing/expoNotificationsMock').expoNotificationsMock());
