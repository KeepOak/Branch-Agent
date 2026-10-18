// Live users.self for Home, More and the You screen. Reloads on each finished handshake.
import { useCallback, useEffect, useState } from 'react';
import type { EngineLink } from '../pairing/pairingSession';
import { EMPTY_SELF, FAILED_SELF, readSelf, type SelfProfile } from './self';

export function useSelf(
  link: Pick<EngineLink, 'request' | 'hello' | 'onConnected'>,
  online: boolean,
): { self: SelfProfile; loadFailed: boolean; reload: () => Promise<void> } {
  const [self, setSelf] = useState<SelfProfile>(EMPTY_SELF);
  const [loadFailed, setLoadFailed] = useState(false);
  const reload = useCallback(async () => {
    try {
      setSelf(readSelf(await link.request('users.self', {})));
      setLoadFailed(false);
    } catch {
      setSelf(FAILED_SELF);
      setLoadFailed(true);
    }
  }, [link]);
  useEffect(() => {
    if (!online) return;
    let live = true;
    const load = () => {
      void reload().then(
        () => undefined,
        () => {
          if (live) {
            setSelf(FAILED_SELF);
            setLoadFailed(true);
          }
        },
      );
    };
    load();
    const stop = link.onConnected(() => load());
    return () => {
      live = false;
      stop();
    };
  }, [link, online, reload]);
  return { self, loadFailed, reload };
}
