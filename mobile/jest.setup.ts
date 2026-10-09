// The library's own test double: real safe-area insets need a native layout pass.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
