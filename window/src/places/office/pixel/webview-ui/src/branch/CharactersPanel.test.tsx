import { act, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OfficeState } from '../office/engine/officeState.js';
import type { BranchServer } from './branchServer.js';
import { CharactersPanel } from './CharactersPanel.js';
import { TRUNK_LOOKS } from './trunkSprites.js';
import type { BranchAgent, Customization } from './types.js';

vi.mock('../office/sprites/spriteCache.js', () => ({
  getCachedSprite: () => ({ width: 1, height: 1 }),
}));

vi.mock('../office/sprites/spriteData.js', () => {
  const frame = [['#000000']];
  return { getSpritesFor: () => ({ walk: { 0: [frame, frame, frame, frame] } }) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AGENTS: BranchAgent[] = [
  { id: 'oak', name: 'Oak', kind: 'trunk', state: 'working', look: 'classic', colorHint: '#6aa84f', shape: 1, eyes: 'round' },
  { id: 'elm', name: 'Elm', kind: 'trunk', state: 'resting', look: 'ember' },
  { id: 'graft', name: 'Graft', kind: 'grafted', state: 'working' },
  { id: 'crew', name: 'Crew', kind: 'group', state: 'working' },
];

const CUSTOM: Record<string, Customization> = {
  oak: { sprite: 'pebble:1:round:#6aa84f', hueShift: 0, seatId: 'seat-0' },
  elm: { sprite: 'look:ember', hueShift: 120, seatId: 'seat-1' },
  graft: { sprite: 'look:ember', hueShift: 0, seatId: null },
};

const SEATS: Array<[string, { assigned: boolean }]> = [
  ['seat-0', { assigned: false }],
  ['seat-1', { assigned: true }],
  ['seat-2', { assigned: false }],
];

type Props = ComponentProps<typeof CharactersPanel>;

function fakeServer(custom: Record<string, Customization | null> = CUSTOM) {
  return {
    customization: vi.fn((id: string) => custom[id] ?? null),
    customize: vi.fn(),
    resetLook: vi.fn(),
  } as unknown as BranchServer & {
    customization: ReturnType<typeof vi.fn>;
    customize: ReturnType<typeof vi.fn>;
    resetLook: ReturnType<typeof vi.fn>;
  };
}

function fakeOffice(): OfficeState {
  const seatZone = (id: string) => (id === 'seat-2' ? 'Lab' : null);
  return { seats: new Map(SEATS), seatZone } as unknown as OfficeState;
}

function props(overrides: Partial<Props> = {}): Props {
  return {
    isOpen: true,
    onClose: vi.fn(),
    server: fakeServer(),
    officeState: fakeOffice(),
    agents: AGENTS,
    onChanged: vi.fn(),
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(element: ReactElement): Promise<void> {
  await act(async () => root.render(element));
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.title === label || b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => el.click());
}

function setRange(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function textOf(selector: string): string | null {
  return host.querySelector(selector)?.textContent ?? null;
}

describe('CharactersPanel visibility', () => {
  it('renders nothing when closed', async () => {
    await mount(<CharactersPanel {...props({ isOpen: false })} />);
    expect(host.textContent).toBe('');
  });

  it('renders nothing when there are no Trunks to show', async () => {
    await mount(<CharactersPanel {...props({ agents: [] })} />);
    expect(host.textContent).toBe('');
  });

  it('renders nothing when the current Trunk has no saved customization', async () => {
    await mount(<CharactersPanel {...props({ server: fakeServer({}) })} />);
    expect(host.textContent).toBe('');
  });

  it('shows the Trunks title when open', async () => {
    await mount(<CharactersPanel {...props()} />);
    expect(host.textContent).toContain('Trunks');
  });
});

describe('CharactersPanel trunk list', () => {
  it('shows one tile per Trunk and grafted agent, leaving out groups', async () => {
    await mount(<CharactersPanel {...props()} />);
    expect(button('Oak')).toBeTruthy();
    expect(button('Elm')).toBeTruthy();
    expect(button('Graft')).toBeTruthy();
    expect(host.querySelector('button[title="Crew"]')).toBeNull();
  });

  it('makes the first Trunk current by default', async () => {
    await mount(<CharactersPanel {...props()} />);
    expect(textOf('span.text-lg')).toBe('Oak');
    expect(host.textContent).toContain('Classic pebble');
  });

  it('switches the detail to a tile that is clicked', async () => {
    await mount(<CharactersPanel {...props()} />);
    await click(button('Elm'));
    expect(textOf('span.text-lg')).toBe('Elm');
  });

  it('appends the grafted suffix only for grafted agents', async () => {
    await mount(<CharactersPanel {...props()} />);
    await click(button('Graft'));
    expect(host.textContent).toContain('Ember · grafted (A2A)');
  });
});

describe('CharactersPanel look grid', () => {
  it('lists the pebble, every look, and six office workers', async () => {
    await mount(<CharactersPanel {...props()} />);
    const titles = [...host.querySelectorAll<HTMLButtonElement>('button[title]')].map((b) => b.title);
    const looks = TRUNK_LOOKS.map((l) => l.name);
    const workers = Array.from({ length: 6 }, (_, i) => `Office worker ${i + 1}`);
    expect(titles).toEqual(expect.arrayContaining(['Classic pebble', ...looks, ...workers]));
    expect(titles.length).toBe(3 + 1 + TRUNK_LOOKS.length + 6);
  });

  it('sends the chosen look key to the server and notifies the office', async () => {
    const server = fakeServer();
    const onChanged = vi.fn();
    await mount(<CharactersPanel {...props({ server, onChanged })} />);
    await click(button('Ember'));
    expect(server.customize).toHaveBeenCalledWith('oak', { sprite: 'look:ember' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('maps an office worker to its human sprite key', async () => {
    const server = fakeServer();
    await mount(<CharactersPanel {...props({ server })} />);
    await click(button('Office worker 2'));
    expect(server.customize).toHaveBeenCalledWith('oak', { sprite: 'human:1' });
  });
});

describe('CharactersPanel hue and desk', () => {
  it('sends whole-degree hue values from the slider', async () => {
    const server = fakeServer();
    await mount(<CharactersPanel {...props({ server })} />);
    setRange(host.querySelector<HTMLInputElement>('input[type="range"]')!, '200');
    expect(server.customize).toHaveBeenCalledWith('oak', { hueShift: 200 });
  });

  it('lists every seat, marks other Trunks seats as taken, and disables them', async () => {
    await mount(<CharactersPanel {...props()} />);
    const options = [...host.querySelectorAll<HTMLOptionElement>('select option')];
    const taken = options.find((o) => o.value === 'seat-1');
    expect(taken?.textContent).toBe('seat-1 · Office (taken)');
    expect(taken?.disabled).toBe(true);
    expect(options.find((o) => o.value === 'seat-2')?.textContent).toBe('seat-2 · Lab');
    expect(options.find((o) => o.value === 'seat-0')?.disabled).toBe(false);
  });

  it('moves the current Trunk when a free desk is picked', async () => {
    const server = fakeServer();
    await mount(<CharactersPanel {...props({ server })} />);
    const select = host.querySelector<HTMLSelectElement>('select')!;
    await act(async () => {
      select.value = 'seat-2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(server.customize).toHaveBeenCalledWith('oak', { seatId: 'seat-2' });
  });
});

describe('CharactersPanel actions', () => {
  it('resets the look to the app look and keeps the panel open', async () => {
    const server = fakeServer();
    const onChanged = vi.fn();
    const onClose = vi.fn();
    await mount(<CharactersPanel {...props({ server, onChanged, onClose })} />);
    await click(button('Use app look'));
    expect(server.resetLook).toHaveBeenCalledWith('oak');
    expect(onChanged).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes the dialog from Done', async () => {
    const onClose = vi.fn();
    await mount(<CharactersPanel {...props({ onClose })} />);
    await click(button('Done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the hint line', async () => {
    await mount(<CharactersPanel {...props()} />);
    expect(host.textContent).toContain('You can also drag a Trunk onto a free desk in the office.');
  });
});

describe('CharactersPanel layout and hue fill', () => {
  it('lets the trunk tiles wrap rather than fixing the row height', async () => {
    const extra: BranchAgent[] = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      name: `T${i}`,
      kind: 'trunk',
      state: 'resting',
    }));
    const custom = Object.fromEntries(extra.map((a) => [a.id, { sprite: 'look:ember', hueShift: 0, seatId: null }]));
    await mount(<CharactersPanel {...props({ agents: extra, server: fakeServer(custom) })} />);
    for (let i = 0; i < 6; i++) {
      expect(host.querySelector(`button[title="T${i}"]`)).not.toBeNull();
    }
    expect(host.querySelector('.flex-wrap')).not.toBeNull();
  });

  it('fills the hue track to 100 percent at hue 359 and to 0 percent at hue 0', async () => {
    const top = fakeServer({ ...CUSTOM, oak: { ...CUSTOM.oak, hueShift: 359 } });
    await mount(<CharactersPanel {...props({ server: top })} />);
    expect(host.querySelector<HTMLElement>('div.bg-accent')?.style.width).toBe('100%');
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(<CharactersPanel {...props({ server: fakeServer() })} />);
    expect(host.querySelector<HTMLElement>('div.bg-accent')?.style.width).toBe('0%');
  });
});

