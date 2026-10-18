import { renderHook } from '@testing-library/react-native';
import type { ApprovalsSnapshot } from '../approvals/approvals';
import { chatRows, readAgents, type ChatListSnapshot } from '../chats/chatList';
import { fixtureAgents, fixtureSessions, FIXTURE_NOW } from '../testing/chatFixtures';
import { useHomeWidget } from './useHomeWidget';

const publishHomeWidget = jest.fn();
const takeLaunchAction = jest.fn(() => null);
const remove = jest.fn();
const addListener = jest.fn(() => ({ remove }));

jest.mock('./native', () => ({
  loadHomeWidget: () => ({ takeLaunchAction, addListener }),
  publishHomeWidget: (...args: unknown[]) => publishHomeWidget(...args),
}));

const { agents, mainKey } = readAgents(fixtureAgents);
const chats: ChatListSnapshot = { rows: chatRows({ sessions: fixtureSessions }, agents, mainKey), loaded: true, error: null };
const approvals: ApprovalsSnapshot = {
  pending: [],
  answered: [],
  trunks: Object.fromEntries(agents),
  loaded: true,
  error: null,
  sending: {},
  failed: {},
};

describe('useHomeWidget', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('publishes copy and applies a launch extra from the widget', () => {
    takeLaunchAction.mockReturnValueOnce('ask');
    const onAction = jest.fn();
    const { unmount } = renderHook(() =>
      useHomeWidget({ paired: true, approvals, chats, now: FIXTURE_NOW, onAction }),
    );
    expect(publishHomeWidget).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Nothing is waiting for you.', askLabel: 'Ask Branch', action: 'open' }),
    );
    expect(onAction).toHaveBeenCalledWith('ask');
    const listener = addListener.mock.calls[0][1] as (event: { action: string }) => void;
    listener({ action: 'approvals' });
    expect(onAction).toHaveBeenCalledWith('approvals');
    unmount();
    expect(remove).toHaveBeenCalled();
  });
});
