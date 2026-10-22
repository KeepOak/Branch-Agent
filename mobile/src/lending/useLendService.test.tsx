import { act, renderHook } from '@testing-library/react-native';
import { PHONE_PREFS_DEFAULT, PHONE_PREFS_KEY, clonePhonePrefs, resetLivePhonePrefs, type PhonePrefs } from '../settings/phonePrefs';
import { memoryStore } from '../storage/keyValueStore';
import { useLendService } from './useLendService';

const mockStart = jest.fn((_title: string, _text: string, _stop: string) => true);
const mockStop = jest.fn();
const mockTakeStopRequest = jest.fn(() => false);
const mockRemove = jest.fn();
let stopListener: (() => void) | undefined;

jest.mock('./native', () => ({
  loadLendService: () => ({
    start: (...args: [string, string, string]) => mockStart(...args),
    stop: () => mockStop(),
    takeStopRequest: () => mockTakeStopRequest(),
    addListener: (_event: string, listener: () => void) => {
      stopListener = listener;
      return { remove: mockRemove };
    },
  }),
}));

const lent = (): PhonePrefs => clonePhonePrefs(PHONE_PREFS_DEFAULT);

describe('useLendService', () => {
  afterEach(() => {
    stopListener = undefined;
    resetLivePhonePrefs();
    jest.clearAllMocks();
  });

  it('starts the service while lending, updates its text, and stops it when lending ends', async () => {
    const store = memoryStore();
    const { rerender, unmount } = await renderHook(
      (props: { online: boolean; prefs: PhonePrefs }) => useLendService({ paired: true, store, ...props }),
      { initialProps: { online: true, prefs: lent() } },
    );
    expect(mockStart).toHaveBeenLastCalledWith(
      'This phone is lent to Branch Agent',
      'Camera, Location, Notifications, when a Trunk asks',
      'Stop lending',
    );
    await rerender({ online: false, prefs: lent() });
    expect(mockStart).toHaveBeenLastCalledWith('This phone is lent to Branch Agent', 'Reconnecting to your computer…', 'Stop lending');
    await rerender({ online: false, prefs: { ...lent(), lendOn: false } });
    expect(mockStop).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('never starts while unpaired', async () => {
    const { unmount } = await renderHook(() => useLendService({ paired: false, online: false, prefs: lent(), store: memoryStore() }));
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockStop).not.toHaveBeenCalled();
    unmount();
  });

  it('turns lending off when Stop is tapped on the notification', async () => {
    const store = memoryStore();
    const { unmount } = await renderHook(() => useLendService({ paired: true, online: true, prefs: lent(), store }));
    expect(stopListener).toBeDefined();
    await act(async () => {
      stopListener?.();
    });
    const saved = JSON.parse((await store.get(PHONE_PREFS_KEY)) ?? '{}') as PhonePrefs;
    expect(saved.lendOn).toBe(false);
    expect(saved.lend).toEqual(PHONE_PREFS_DEFAULT.lend);
    unmount();
  });

  it('turns lending off on launch when Stop was tapped while the app was closed', async () => {
    mockTakeStopRequest.mockReturnValueOnce(true);
    const store = memoryStore();
    const { unmount } = await renderHook(() => useLendService({ paired: true, online: true, prefs: lent(), store }));
    await act(async () => {});
    const saved = JSON.parse((await store.get(PHONE_PREFS_KEY)) ?? '{}') as PhonePrefs;
    expect(saved.lendOn).toBe(false);
    unmount();
  });
});
