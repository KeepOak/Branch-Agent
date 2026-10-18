// Live users.self for Home, More and the You screen. Reloads on each finished handshake.
import { useCallback, useEffect, useState } from 'react';
import type { EngineLink } from '../pairing/pairingSession';
import { EMPTY_SELF, readSelf, type SelfProfile } from './self';

export function useSelf(
  link: Pick<EngineLink, 'request' | 'hello' | 'onConnected'>,
  online: boolean,
): { self: SelfProfile; reload: () => Promise<void> } {
  const [self, setSelf] = useState<SelfProfile>(EMPTY_SELF);
  const reload = useCallback(async () => {
    try {
      setSelf(readSelf(await link.request('users.self', {})));
    } catch {
      setSelf(EMPTY_SELF);
    }
  }, [link]);
  useEffect(() => {
    if (!online) return;
    let live = true;
    const load = () => {
      void reload().then(() => undefined, () => {
        if (live) setSelf(EMPTY_SELF);
      });
    };
    load();
    const stop = link.onConnected(() => load());
    return () => {
      live = false;
      stop();
    };
  }, [link, online, reload]);
  return { self, reload };
}
