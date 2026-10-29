import { useMemo } from 'react';
import { Text } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import type { EngineLink } from '../pairing/pairingSession';
import { useSelf } from './useSelf';

jest.setTimeout(10_000);

function Probe({
  request,
  online = true,
}: {
  request: EngineLink['request'];
  online?: boolean;
}) {
  const link = useMemo(
    () => ({ request, hello: null, onConnected: () => () => undefined }),
    [request],
  );
  const { self, loadFailed } = useSelf(link, online);
  return (
    <>
      <Text testID="self-name">{self.name}</Text>
      <Text testID="self-failed">{loadFailed ? 'yes' : 'no'}</Text>
    </>
  );
}

describe('useSelf', () => {
  it('does not fall back to Owner when users.self fails', async () => {
    const request = jest.fn(async () => {
      throw new Error('users.self: ECONNREFUSED');
    }) as EngineLink['request'];
    await act(async () => {
      render(<Probe request={request} />);
    });
    await waitFor(() => expect(screen.getByTestId('self-failed')).toHaveTextContent('yes'));
    expect(screen.getByTestId('self-name')).toHaveTextContent('');
    expect(screen.getByTestId('self-name')).not.toHaveTextContent('Owner');
  });

  it('uses the engine name when users.self succeeds', async () => {
    const request = jest.fn(async () => ({ profile: { id: 'gateway-owner', displayName: 'Owner' } })) as EngineLink['request'];
    await act(async () => {
      render(<Probe request={request} />);
    });
    await waitFor(() => expect(screen.getByTestId('self-name')).toHaveTextContent('Owner'));
    expect(screen.getByTestId('self-failed')).toHaveTextContent('no');
  });
});
