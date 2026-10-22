import { Platform } from 'react-native';
import { homeWidgetCopy } from './homeWidget';
import { loadHomeWidget, publishHomeWidget } from './native';

describe('home-screen widget native bridge', () => {
  it('does not load native code off Android, so Jest and iPhone builds stay a no-op', () => {
    expect(Platform.OS).not.toBe('android');
    expect(loadHomeWidget()).toBeNull();
    expect(() =>
      publishHomeWidget(homeWidgetCopy({ paired: false, pending: [], trunks: {}, rows: [], now: 0 })),
    ).not.toThrow();
  });
});
