import { renderHook } from '@testing-library/react-native';
import type { ApprovalsSnapshot } from '../approvals/approvals';
import { chatRows, readAgents, type ChatListSnapshot } from '../chats/chatList';
import { fixtureAgents, fixtureSessions, FIXTURE_NOW } from '../testing/chatFixtures';
import { useHomeWidget } from './useHomeWidget';

const mockPublishHomeWidget = jest.fn();
const mockTakeLaunchAction = jest.fn((): string | null => null);
const mockRemove = jest.fn();
let launchListener: ((event: { action: string }) => void) | undefined;
const mockAddListener = jest.fn((_event: string, listener: (event: { action: string }) => void) => {
  launchListener = listener;
  return { remove: mockRemove };
});

jest.mock('./native', () => ({
  loadHomeWidget: () => ({ takeLaunchAction: mockTakeLaunchAction, addListener: mockAddListener }),
  publishHomeWidget: (...args: unknown[]) => mockPublishHomeWidget(...args),
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
    launchListener = undefined;
    jest.clearAllMocks();
  });

  it('publishes copy and applies a launch extra from the widget', async () => {
    mockTakeLaunchAction.mockReturnValueOnce('ask');
    const onAction = jest.fn();
    const { unmount } = await renderHook(() =>
      useHomeWidget({ paired: true, approvals, chats, now: FIXTURE_NOW, onAction }),
    );
    expect(mockPublishHomeWidget).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Nothing is waiting for you.', askLabel: 'Ask Branch', action: 'open' }),
    );
    expect(onAction).toHaveBeenCalledWith('ask');
    expect(launchListener).toBeDefined();
    launchListener?.({ action: 'approvals' });
    expect(onAction).toHaveBeenCalledWith('approvals');
    unmount();
  });
});
