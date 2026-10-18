import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ANDROID_CHANNELS } from '../alerts/kinds';
import { createExpoNotifier } from './expoNotifier';

const mocked = Notifications as unknown as Record<string, jest.Mock>;
const response = (actionIdentifier: string, data: Record<string, unknown> | undefined) => ({
  actionIdentifier,
  notification: { request: { content: { data } } },
});

describe('the phone’s own notifications', () => {
  beforeEach(() => jest.clearAllMocks());

  it('registers Allow and Deny (Send it and Don’t send) as buttons that answer without opening the app', async () => {
    await createExpoNotifier().prepare();
    expect(mocked.setNotificationCategoryAsync.mock.calls).toEqual([
      [
        'approval',
        [
          { identifier: 'allow', buttonTitle: 'Allow', options: { opensAppToForeground: false, isAuthenticationRequired: true } },
          { identifier: 'deny', buttonTitle: 'Deny', options: { opensAppToForeground: false } },
        ],
      ],
      [
        'approval-send',
        [
          { identifier: 'allow', buttonTitle: 'Send it', options: { opensAppToForeground: false, isAuthenticationRequired: true } },
          { identifier: 'deny', buttonTitle: 'Don’t send', options: { opensAppToForeground: false } },
        ],
      ],
    ]);
    expect(mocked.setNotificationHandler).toHaveBeenCalledTimes(1);
  });

  it('posts an approval with its buttons and its id, and takes it down by key', async () => {
    const notifier = createExpoNotifier();
    await notifier.show({
      key: 'approval:exec-1',
      title: 'Oak needs a yes',
      body: 'Run: pnpm install',
      category: 'approval',
      approvalId: 'exec-1',
      route: { screen: 'approvals', approvalId: 'exec-1' },
    });
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: 'approval:exec-1',
      content: {
        title: 'Oak needs a yes',
        body: 'Run: pnpm install',
        sound: 'default',
        categoryIdentifier: 'approval',
        data: { approvalId: 'exec-1', screen: 'approvals' },
      },
      trigger: null,
    });
    await notifier.dismiss('approval:exec-1');
    expect(mocked.dismissNotificationAsync).toHaveBeenCalledWith('approval:exec-1');
    await notifier.setBadge(2);
    expect(mocked.setBadgeCountAsync).toHaveBeenCalledWith(2);
  });

  it('turns a button press or a tap into an answer, and routes taps that are not approvals', async () => {
    const notifier = createExpoNotifier();
    const seen: unknown[] = [];
    notifier.onResponse((r) => seen.push(r));
    const listener = mocked.addNotificationResponseReceivedListener.mock.calls[0][0] as (r: unknown) => void;
    listener(response('allow', { approvalId: 'exec-1' }));
    listener(response('deny', { approvalId: 'plugin:mail-1' }));
    listener(response(Notifications.DEFAULT_ACTION_IDENTIFIER, { approvalId: 'exec-2' }));
    listener(response('allow', undefined));
    listener(response(Notifications.DEFAULT_ACTION_IDENTIFIER, { screen: 'chat', sessionKey: 'agent:oak:main' }));
    listener(response(Notifications.DEFAULT_ACTION_IDENTIFIER, { screen: 'settings' }));
    expect(seen).toEqual([
      { approvalId: 'exec-1', action: 'allow', route: { screen: 'approvals', approvalId: 'exec-1' } },
      { approvalId: 'plugin:mail-1', action: 'deny', route: { screen: 'approvals', approvalId: 'plugin:mail-1' } },
      { approvalId: 'exec-2', action: 'open', route: { screen: 'approvals', approvalId: 'exec-2' } },
      { action: 'open', route: { screen: 'chat', sessionKey: 'agent:oak:main' } },
      { action: 'open', route: { screen: 'settings' } },
    ]);
    mocked.getLastNotificationResponseAsync.mockResolvedValueOnce(response(Notifications.DEFAULT_ACTION_IDENTIFIER, { approvalId: 'exec-3' }));
    await expect(notifier.launchResponse()).resolves.toEqual({
      approvalId: 'exec-3',
      action: 'open',
      route: { screen: 'approvals', approvalId: 'exec-3' },
    });
    expect(mocked.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
  });

  it('reads the permission in the app’s own terms', async () => {
    const notifier = createExpoNotifier();
    await expect(notifier.permission()).resolves.toBe('undetermined');
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied' });
    await expect(notifier.permission()).resolves.toBe('denied');
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'undetermined', ios: { status: 3 } });
    await expect(notifier.permission()).resolves.toBe('granted');
    await expect(notifier.requestPermission()).resolves.toBe('granted');
    expect(mocked.requestPermissionsAsync).toHaveBeenCalledWith({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  });

  it('registers one Android channel per notification kind', async () => {
    const previous = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    try {
      await createExpoNotifier().prepare();
      expect(mocked.setNotificationChannelAsync.mock.calls.map((call) => call[0])).toEqual(ANDROID_CHANNELS.map((c) => c.id));
      expect(mocked.setNotificationChannelAsync.mock.calls[0][1]).toMatchObject({
        name: 'Approvals',
        description: 'A Trunk needs your yes before it goes on.',
      });
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: previous });
    }
  });
});
