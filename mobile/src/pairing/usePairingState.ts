import { useSyncExternalStore } from 'react';
import type { PairingSession, PairingState } from './pairingSession';

export function usePairingState(session: PairingSession): PairingState {
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getState(),
  );
}
