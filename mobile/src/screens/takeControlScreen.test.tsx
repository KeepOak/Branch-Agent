import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import App from '../../App';
import { createFakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { fixtureEnvironments } from '../testing/computerFixtures';
import { computerRows } from '../computers/computerList';
import { TakeControlScreen } from './TakeControlScreen';
import { setTouchMode } from '../stage/touch-mode';
import { memoryStore } from '../storage/keyValueStore';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { EngineLink } from '../pairing/pairingSession';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
jest.setTimeout(20_000);

const gateway = computerRows({ environments: fixtureEnvironments })[0];

function fakeLink(opts: { snapshot?: () => Promise<unknown> | unknown } = {}): EngineLink & { acts: Array<Record<string, unknown>>; snapshots: number } {
  const acts: Array<Record<string, unknown>> = [];
  const link: EngineLink & { acts: Array<Record<string, unknown>>; snapshots: number } = {
    acts,
    snapshots: 0,
    hello: null,
    onEvent: () => () => undefined,
    onConnected: () => () => undefined,
    request: async <T = unknown>(method: string, params?: unknown) => {
      if (method === 'computer.status') return { available: true, configured: true, computerUse: { provider: { generation: 'driver-one' } } } as T;
      const command = (params as { command?: string } | undefined)?.command;
      const body = (params as { params?: Record<string, unknown> } | undefined)?.params ?? {};
      if (method === 'computer.invoke' && command === 'screen.snapshot') {
        if (opts.snapshot) return (await opts.snapshot()) as T;
        link.snapshots += 1;
        return { payload: { format: 'png', base64: 'aa', displayFrameId: 'frame-1', width: 1280, height: 800 } } as T;
      }
      if (method === 'computer.invoke' && command === 'computer.act') {
        acts.push(body);
        return { payload: { ok: true } } as T;
      }
      return {} as T;
    },
  };
  return link;
}

async function renderScreen(link = fakeLink(), extra: Partial<Parameters<typeof TakeControlScreen>[0]> = {}) {
  let n = 0;
  await render(
    <SafeAreaProvider>
      <TakeControlScreen computer={gateway} link={link} newId={() => `id-${++n}`} onBack={() => undefined} {...extra} />
    </SafeAreaProvider>,
  );
  return { link };
}

async function pairedApp() {
  const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, environments: fixtureEnvironments });
  const { session } = createFakeSession(engine);
  await render(<App scheme="dark" session={session} />);
  await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
  engine.approve();
  await eventually(() => expect(screen.getByTestId('chat-agent:main:main')).toBeOnTheScreen());
  return { session, engine };
}

beforeEach(() => {
  setTouchMode('touch');
});

describe('take-control screen', () => {
  it('shows Touch selected, Take over once the picture is in, and Hand back after you take over', async () => {
    await renderScreen();
    expect(screen.getByTestId('take-control-screen')).toBeOnTheScreen();
    expect(screen.getByRole('header')).toHaveTextContent('This computer');
    expect(screen.getByTestId('touch-mode-touch')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
    expect(screen.getByTestId('touch-mode-trackpad')).toHaveProp('accessibilityState', expect.objectContaining({ selected: false }));
    await eventually(() => expect(screen.getByTestId('take-control-picture')).toBeOnTheScreen());
    expect(screen.getByTestId('take-over')).toBeOnTheScreen();
    expect(screen.queryByTestId('drive-keyboard')).toBeNull();
    await fireEvent.press(screen.getByTestId('take-over'));
    expect(screen.getByText('You’re driving')).toBeOnTheScreen();
    expect(screen.getByTestId('hand-back')).toBeOnTheScreen();
    expect(screen.getByTestId('drive-keyboard')).toBeOnTheScreen();
    expect(screen.getByTestId('take-control-pill')).toHaveTextContent('You');
    await fireEvent.press(screen.getByTestId('hand-back'));
    expect(screen.getByTestId('take-over')).toBeOnTheScreen();
    expect(screen.queryByTestId('drive-keyboard')).toBeNull();
  });

  it('switches to Trackpad after a tap on that tab', async () => {
    await renderScreen();
    await eventually(() => expect(screen.getByTestId('take-control-picture')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('touch-mode-trackpad'));
    expect(screen.getByTestId('touch-mode-trackpad')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
    expect(screen.getByTestId('touch-mode-touch')).toHaveProp('accessibilityState', expect.objectContaining({ selected: false }));
  });

  it('keeps the Touch choice in storage', async () => {
    const store = memoryStore();
    const link = fakeLink();
    await render(
      <SafeAreaProvider>
        <TakeControlScreen computer={gateway} link={link} newId={() => 'n1'} store={store} onBack={() => undefined} />
      </SafeAreaProvider>,
    );
    await fireEvent.press(screen.getByTestId('touch-mode-trackpad'));
    expect(store.dump()['branch.drive.touchMode']).toBe('trackpad');
  });

  it('leaves Take over until the picture is in, and Try again after a failed snapshot', async () => {
    let allow = false;
    let link: ReturnType<typeof fakeLink>;
    link = fakeLink({
      snapshot: () => {
        if (!allow) throw new Error('no picture');
        link.snapshots += 1;
        return { payload: { format: 'png', base64: 'aa', displayFrameId: 'frame-1', width: 1280, height: 800 } };
      },
    });
    await renderScreen(link);
    await eventually(() => expect(screen.getByTestId('take-control-retry')).toBeOnTheScreen());
    expect(screen.getByText(/Couldn't show this computer's screen/)).toBeOnTheScreen();
    expect(screen.getByTestId('take-over')).toBeDisabled();
    allow = true;
    await fireEvent.press(screen.getByTestId('take-control-retry'));
    await eventually(() => expect(screen.getByTestId('take-control-picture')).toBeOnTheScreen());
    expect(screen.getByTestId('take-over')).toBeEnabled();
  });
});

describe('take-control from Computers', () => {
  it('opens This computer from the list, and back leaves every other screen working', async () => {
    const { session } = await pairedApp();
    await fireEvent.press(screen.getByTestId('computer-button'));
    expect(screen.getByTestId('computers-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('computer-gateway')).toHaveProp('accessibilityRole', 'button');
    await fireEvent.press(screen.getByTestId('computer-gateway'));
    expect(screen.getByTestId('take-control-screen')).toBeOnTheScreen();
    expect(within(screen.getByTestId('take-control-screen')).getByText('This computer')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('take-control-back'));
    expect(screen.getByTestId('computers-screen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('this-phone'));
    expect(screen.getByText('Your computer')).toBeOnTheScreen();
    expect(screen.getByTestId('unpair')).toBeOnTheScreen();
    session.dispose();
  });
});
