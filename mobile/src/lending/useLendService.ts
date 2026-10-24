import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { PhonePrefs } from '../settings/phonePrefs';
import { getLivePhonePrefs, writePhonePrefs } from '../settings/phonePrefs';
import type { KeyValueStore } from '../storage/keyValueStore';
import { lendNotice, stopLending } from './lendService';
import { loadLendService } from './native';

/**
 * Keep Android's lending notification (a foreground service) in step with Settings › Lend this phone.
 * Stop on the notification turns lending off here too, even when it was tapped while the app was closed.
 */
export function useLendService(args: { paired: boolean; online: boolean; prefs: PhonePrefs; store?: KeyValueStore }): void {
  const { paired, online, prefs, store } = args;
  const notice = lendNotice({ paired, online, prefs });
  const started = useRef(false);

  useEffect(() => {
    const native = loadLendService();
    if (!native) return;
    if (!notice) {
      if (started.current) native.stop();
      started.current = false;
      return;
    }
    const start = () => {
      started.current = native.start(notice.title, notice.text, notice.stopLabel) || started.current;
    };
    start();
    // Android only lets the app start the service while it is in front, so try again when it comes back.
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
    });
    return () => app.remove();
  }, [notice?.title, notice?.text, notice?.stopLabel]);

  useEffect(() => {
    const native = loadLendService();
    if (!native || !store) return;
    const stop = () => {
      started.current = false;
      void writePhonePrefs(store, stopLending(getLivePhonePrefs()));
    };
    if (native.takeStopRequest()) stop();
    const sub = native.addListener('onStopLending', () => {
      native.takeStopRequest();
      stop();
    });
    return () => sub.remove();
  }, [store]);
}
