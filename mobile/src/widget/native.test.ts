import { Platform } from 'react-native';
import { homeWidgetCopy } from './homeWidget';
import { loadHomeWidget, publishHomeWidget } from './native';

const publish = jest.fn();
const takeLaunchAction = jest.fn(() => null);
const addListener = jest.fn(() => ({ remove: jest.fn() }));

jest.mock('expo-modules-core', () => ({
  requireNativeModule: jest.fn(() => ({ publish, takeLaunchAction, addListener })),
}));

const { requireNativeModule } = jest.requireMock('expo-modules-core') as {
  requireNativeModule: jest.Mock;
};

describe('home-screen widget native bridge', () => {
  const os = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: os });
    jest.clearAllMocks();
  });

  it('does not load native code off Android', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    expect(loadHomeWidget()).toBeNull();
    expect(requireNativeModule).not.toHaveBeenCalled();
  });

  it('publishes the widget copy on Android and ignores a missing module', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    const copy = homeWidgetCopy({ paired: false, pending: [], trunks: {}, rows: [], now: 0 });
    publishHomeWidget(copy);
    expect(publish).toHaveBeenCalledWith(copy.title, copy.detail, copy.counts, copy.askLabel, copy.work, copy.action);

    requireNativeModule.mockImplementationOnce(() => {
      throw new Error('no native module');
    });
    expect(loadHomeWidget()).toBeNull();
  });
});
