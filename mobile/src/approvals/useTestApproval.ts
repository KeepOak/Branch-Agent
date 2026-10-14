import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineLink } from '../pairing/pairingSession';
import { sendTestApproval } from './testApproval';

export type TestApprovalState =
  | { phase: 'idle' }
  /** Waiting to send, so the phone can be locked first; `at` is when it goes. */
  | { phase: 'counting'; at: number }
  | { phase: 'sending' }
  | { phase: 'sent' }
  | { phase: 'failed'; message: string };

/**
 * Sends test approvals (testApproval.ts), now or after a wait, and reads the approvals list again once the computer
 * has one: the engine doesn't tell the asking phone about its own request.
 */
export function useTestApproval(link: Pick<EngineLink, 'request' | 'hello'>, refresh: () => Promise<void>) {
  const [state, setState] = useState<TestApprovalState>({ phase: 'idle' });
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const fire = useCallback(async () => {
    timer.current = null;
    setState({ phase: 'sending' });
    const result = await sendTestApproval(link);
    if (result.ok) await refresh().catch(() => undefined);
    busy.current = false;
    if (live.current) setState(result.ok ? { phase: 'sent' } : { phase: 'failed', message: result.message });
  }, [link, refresh]);

  const send = useCallback(
    (delayMs = 0) => {
      if (busy.current) return;
      busy.current = true;
      if (delayMs > 0) {
        setState({ phase: 'counting', at: Date.now() + delayMs });
        timer.current = setTimeout(() => void fire(), delayMs);
      } else void fire();
    },
    [fire],
  );

  const cancel = useCallback(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    busy.current = false;
    setState({ phase: 'idle' });
  }, []);

  return { state, send, cancel };
}
