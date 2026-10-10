// The real notifications, through expo-notifications: two button sets registered as notification
// categories, one Android channel for approvals, local notifications posted while Branch is in the
// background, and the buttons' answers handed back to ApprovalAlerts.
//
// Allow asks the phone to be unlocked first (iOS isAuthenticationRequired), as the preview's lock
// screen promises: "Face ID may ask first". Neither button brings the app forward; iOS and Android
// wake Branch in the background to send the answer. While the app has been closed completely, the
// phone can't hear the computer at all: that needs the engine to send a push (see DESIGN.md).
import type * as NotificationsModule from 'expo-notifications';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import type { AlertResponse, Notifier, NotificationPermission } from './approvalAlerts';

const CHANNEL = 'approvals';

type Notifications = typeof NotificationsModule;

/** Everything the notifier calls. Missing any of them means the module can't be used here. */
const NEEDED = [
  'setNotificationHandler',
  'setNotificationCategoryAsync',
  'getPermissionsAsync',
  'requestPermissionsAsync',
  'scheduleNotificationAsync',
  'dismissNotificationAsync',
  'setBadgeCountAsync',
  'addNotificationResponseReceivedListener',
  'getLastNotificationResponseAsync',
  'clearLastNotificationResponseAsync',
] as const;

/**
 * expo-notifications, or null where this phone can't post Branch's notifications. Expo Go on Android
 * no longer carries the module's native side (since SDK 53), so requiring it there gives nothing usable
 * and the first call would take the whole app down. Loading or a missing function never throws:
 * the app falls back to noNotifier and approvals are answered on the Needs you screen.
 * Loaded only when the notifier is made: importing it registers for push tokens, which tests never need.
 */
export function loadNotifications(
  os: string = Platform.OS,
  environment: string = Constants.executionEnvironment,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  load: () => unknown = () => require('expo-notifications'),
): Notifications | null {
  if (os === 'android' && environment === ExecutionEnvironment.StoreClient) return null;
  let loaded: unknown;
  try {
    loaded = load();
  } catch {
    return null;
  }
  if (!loaded || typeof loaded !== 'object') return null;
  const found = loaded as Record<string, unknown>;
  const needed: readonly string[] = os === 'android' ? [...NEEDED, 'setNotificationChannelAsync'] : NEEDED;
  if (needed.some((name) => typeof found[name] !== 'function')) return null;
  return loaded as Notifications;
}

function permissionOf(n: Notifications, status: NotificationsModule.NotificationPermissionsStatus): NotificationPermission {
  if (status.granted) return 'granted';
  const ios = status.ios?.status;
  const { IosAuthorizationStatus } = n;
  if (ios === IosAuthorizationStatus.PROVISIONAL || ios === IosAuthorizationStatus.EPHEMERAL) return 'granted';
  return status.status === 'denied' ? 'denied' : 'undetermined';
}

function responseOf(response: NotificationsModule.NotificationResponse): AlertResponse | null {
  const approvalId = response.notification.request.content.data?.approvalId;
  if (typeof approvalId !== 'string' || !approvalId) return null;
  const action = response.actionIdentifier === 'allow' ? 'allow' : response.actionIdentifier === 'deny' ? 'deny' : 'open';
  return { approvalId, action };
}

function buttons(yes: string, no: string): NotificationsModule.NotificationAction[] {
  return [
    { identifier: 'allow', buttonTitle: yes, options: { opensAppToForeground: false, isAuthenticationRequired: true } },
    { identifier: 'deny', buttonTitle: no, options: { opensAppToForeground: false } },
  ];
}

/** The phone's own notifications, or noNotifier where expo-notifications can't be used (Expo Go on Android). */
export function createExpoNotifier(load: () => Notifications | null = loadNotifications): Notifier {
  const n = load();
  if (!n) return noNotifier;
  return {
    async prepare() {
      n.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
      });
      if (Platform.OS === 'android') {
        await n.setNotificationChannelAsync(CHANNEL, {
          name: 'Approvals',
          description: 'A Trunk needs your yes before it goes on.',
          importance: n.AndroidImportance.HIGH,
        });
      }
      await n.setNotificationCategoryAsync('approval', buttons('Allow', 'Deny'));
      await n.setNotificationCategoryAsync('approval-send', buttons('Send it', 'Don’t send'));
    },
    async permission() {
      return permissionOf(n, await n.getPermissionsAsync());
    },
    async requestPermission() {
      return permissionOf(n, await n.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } }));
    },
    async show({ key, title, body, category, approvalId }) {
      await n.scheduleNotificationAsync({
        identifier: key,
        content: {
          title,
          body,
          sound: 'default',
          ...(category ? { categoryIdentifier: category } : {}),
          ...(approvalId ? { data: { approvalId } } : {}),
        },
        trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
      });
    },
    async dismiss(key) {
      await n.dismissNotificationAsync(key);
    },
    async setBadge(count) {
      await n.setBadgeCountAsync(count);
    },
    onResponse(listener) {
      // A listener that can't be added must not stop the app: the Needs you screen still answers.
      try {
        const sub = n.addNotificationResponseReceivedListener((response) => {
          const answer = responseOf(response);
          if (answer) listener(answer);
        });
        return () => sub.remove();
      } catch {
        return () => undefined;
      }
    },
    async launchResponse() {
      const response = await n.getLastNotificationResponseAsync();
      if (!response) return null;
      await n.clearLastNotificationResponseAsync();
      return responseOf(response);
    },
  };
}

/** For the web preview and Expo Go on Android, where Branch can't post notifications: approvals still work in the app. */
export const noNotifier: Notifier = {
  prepare: async () => undefined,
  permission: async () => 'unavailable',
  requestPermission: async () => 'unavailable',
  show: async () => undefined,
  dismiss: async () => undefined,
  setBadge: async () => undefined,
  onResponse: () => () => undefined,
  launchResponse: async () => null,
};
