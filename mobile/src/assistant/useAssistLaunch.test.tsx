import { act, renderHook } from '@testing-library/react-native';
import { chatForNew, chatRows, readAgents } from '../chats/chatList';
import { FIXTURE_NOW, fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { routeForAssist, useAssistLaunch } from './useAssistLaunch';

const mockTakeAssist = jest.fn(() => false);
const mockRemove = jest.fn();
let assistListener: (() => void) | undefined;

jest.mock('./native', () => ({
  loadAssistant: () => ({
    takeAssist: () => mockTakeAssist(),
    addListener: (_event: string, listener: () => void) => {
      assistListener = listener;
      return { remove: mockRemove };
    },
  }),
}));

const { agents, mainKey } = readAgents(fixtureAgents);
const rows = chatRows({ sessions: fixtureSessions }, agents, mainKey);

describe('Branch Agent as the Android assistant', () => {
  afterEach(() => {
    assistListener = undefined;
    jest.clearAllMocks();
  });

  it('lands on a new chat, the same pick as New chat, or Chats when there is none', () => {
    expect(routeForAssist(rows, FIXTURE_NOW)).toEqual({ name: 'chat', row: chatForNew(rows, FIXTURE_NOW) });
    expect(routeForAssist([], FIXTURE_NOW)).toEqual({ name: 'chats' });
  });

  it('opens a new chat when the app was launched by the assist gesture', async () => {
    mockTakeAssist.mockReturnValueOnce(true);
    const onOpen = jest.fn();
    const { unmount } = await renderHook(() => useAssistLaunch({ paired: true, rows, onOpen }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].name).toBe('chat');
    await act(async () => {
      await unmount();
    });
    expect(mockRemove).toHaveBeenCalled();
  });

  it('opens a new chat when the gesture fires while the app is already running', async () => {
    const onOpen = jest.fn();
    const { unmount } = await renderHook(() => useAssistLaunch({ paired: true, rows, onOpen }));
    expect(onOpen).not.toHaveBeenCalled();
    mockTakeAssist.mockReturnValueOnce(true);
    await act(async () => {
      assistListener?.();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does nothing before this phone is paired, so pairing stays the first step', async () => {
    mockTakeAssist.mockReturnValueOnce(true);
    const onOpen = jest.fn();
    const { unmount } = await renderHook(() => useAssistLaunch({ paired: false, rows, onOpen }));
    expect(onOpen).not.toHaveBeenCalled();
    unmount();
  });
});
