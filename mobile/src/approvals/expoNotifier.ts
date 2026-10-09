// The real notifications, through expo-notifications: two button sets registered as notification
// categories, one Android channel for approvals, local notifications posted while Branch is in the
// background, and the buttons' answers handed back to ApprovalAlerts.
//
// Allow asks the phone to be unlocked first (iOS isAuthenticationRequired), as the preview's lock
// screen promises: "Face ID may ask first". Neither button brings the app forward; iOS and Android
// wake Branch in the background to send the answer. While the app has been closed completely, the
// phone can't hear the computer at all: that needs the engine to send a push (see DESIGN.md).
import type * as NotificationsModule from 'expo-notifications';
import { Platform } from 'react-native';
import type { AlertResponse, Notifier, NotificationPermission } from './approvalAlerts';

const CHANNEL = 'approvals';

type Notifications = typeof NotificationsModule;
let loaded: Notifications | null = null;
/** Loaded on first use: importing it registers for push tokens, which the app doesn't use (and tests never need). */
function notifications(): Notifications {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  loaded ??= require('expo-notifications') as Notifications;
  return loaded;
}

function permissionOf(status: NotificationsModule.NotificationPermissionsStatus): NotificationPermission {
  if (status.granted) return 'granted';
  const ios = status.ios?.status;
  const { IosAuthorizationStatus } = notifications();
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

export function createExpoNotifier(): Notifier {
  return {
    async prepare() {
      notifications().setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
      });
      if (Platform.OS === 'android') {
        await notifications().setNotificationChannelAsync(CHANNEL, {
          name: 'Approvals',
          description: 'A Trunk needs your yes before it goes on.',
          importance: notifications().AndroidImportance.HIGH,
        });
      }
      await notifications().setNotificationCategoryAsync('approval', buttons('Allow', 'Deny'));
      await notifications().setNotificationCategoryAsync('approval-send', buttons('Send it', 'Don’t send'));
    },
    async permission() {
      return permissionOf(await notifications().getPermissionsAsync());
    },
    async requestPermission() {
      return permissionOf(await notifications().requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } }));
    },
    async show({ key, title, body, category, approvalId }) {
      await notifications().scheduleNotificationAsync({
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
      await notifications().dismissNotificationAsync(key);
    },
    async setBadge(count) {
      await notifications().setBadgeCountAsync(count);
    },
    onResponse(listener) {
      const sub = notifications().addNotificationResponseReceivedListener((response) => {
        const answer = responseOf(response);
        if (answer) listener(answer);
      });
      return () => sub.remove();
    },
    async launchResponse() {
      const response = await notifications().getLastNotificationResponseAsync();
      if (!response) return null;
      await notifications().clearLastNotificationResponseAsync();
      return responseOf(response);
    },
  };
}

/** For the web preview, which has no notification system Branch can use: approvals still work in the app. */
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
