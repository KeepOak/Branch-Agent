// The phone's notification system and app state, for tests and screenshots: records what would be
// shown, dismissed and badged, and lets a test press a notification's buttons or move the app to the background.
import type { AlertResponse, AppStateSource, Notifier, NotificationPermission } from '../approvals/approvalAlerts';

export type ShownAlert = Parameters<Notifier['show']>[0];

export function createFakeNotifier(initial: NotificationPermission = 'granted') {
  let permission = initial;
  let launch: AlertResponse | null = null;
  const shown = new Map<string, ShownAlert>();
  const dismissed: string[] = [];
  const badges: number[] = [];
  const listeners = new Set<(response: AlertResponse) => void>();
  let prepared = 0;
  const notifier: Notifier = {
    prepare: async () => {
      prepared += 1;
    },
    permission: async () => permission,
    requestPermission: async () => {
      if (permission === 'undetermined') permission = 'granted';
      return permission;
    },
    show: async (alert) => {
      shown.set(alert.key, alert);
    },
    dismiss: async (key) => {
      dismissed.push(key);
      shown.delete(key);
    },
    setBadge: async (count) => {
      badges.push(count);
    },
    onResponse: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    launchResponse: async () => launch,
  };
  return {
    notifier,
    shown,
    dismissed,
    badges,
    get prepared() {
      return prepared;
    },
    /** Presses a button on (or taps) one of Branch's notifications. */
    respond: (response: AlertResponse) => {
      for (const listener of [...listeners]) listener(response);
    },
    setLaunch: (response: AlertResponse | null) => {
      launch = response;
    },
    setPermission: (next: NotificationPermission) => {
      permission = next;
    },
  };
}

export function createFakeAppState(initial = 'active') {
  let state = initial;
  const listeners = new Set<(state: string) => void>();
  const source: AppStateSource = {
    current: () => state,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    set: (next: string) => {
      state = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}
