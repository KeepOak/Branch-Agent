import type { OfficeLayout } from '../office/types.js';
import type { Storage } from './storage.js';

export type BranchState = 'working' | 'reading' | 'waiting' | 'needs_you' | 'resting' | 'offline';

export interface BranchSubagent {
  id: string;
  label: string;
  state?: BranchState;
  activity?: string;
}

export interface BranchAgent {
  id: string;
  name: string;
  role?: string;
  kind: 'trunk' | 'grafted' | 'group';
  state: BranchState;
  activity?: string;
  needsYou?: number;
  unread?: boolean;
  /** The Trunk's colour in the app (#rrggbb); tints its classic pebble, seeds a human sprite's hue. */
  colorHint?: string;
  /** The Trunk's look in the app: 'classic' (pebble) or a character id (ember, tock, kite, morel, ...). */
  look?: string;
  /** Pebble shape 0-4 and eyes (round | wide | sleepy), as in the app. */
  shape?: number;
  eyes?: string;
  /** The Trunk's emoji face (when look is 'classic' and an emoji is set). */
  emoji?: string;
  /** Sub-agents the Trunk spawned; each appears as an extra character beside it. */
  subagents?: BranchSubagent[];
  /** Optional context usage for upstream's context gauge. */
  context?: { used: number; max: number };
  /** Upstream Agent Teams: a lead and its teammates (the overlay shows LEAD / the role). */
  team?: { name: string; lead?: boolean; role?: string; leadId?: string };
  /** Group members (kind 'group'), shown on the meeting-room plaque. */
  members?: string[];
}

export interface BranchLink {
  from: string;
  to: string;
  at: number | string;
}

export interface Customization {
  /** "look:<id>", "pebble:<shape>:<eyes>:<#hex>" or "human:<0-5>". */
  sprite: string;
  hueShift: number;
  seatId: string | null;
}

export interface MountOptions {
  agents: BranchAgent[];
  links?: BranchLink[];
  onOpen?: (id: string) => void;
  /** 'dark' | 'light'; or 'auto' to follow <html data-theme> and prefers-color-scheme. Default 'auto'. */
  theme?: 'dark' | 'light' | 'auto';
  /** true | false; or 'auto' (default) to follow prefers-reduced-motion. */
  reducedMotion?: boolean | 'auto';
  /** Host-owned profile persistence, hydrated before the office mounts. */
  storage: Storage;
  /** Upstream "+ Agent": shown when provided. */
  onNewAgent?: () => void;
  /** Called after the owner saves a layout in the editor (or imports / resets one). */
  onLayoutChange?: (layout: OfficeLayout | null) => void;
  /** Called after the owner changes a Trunk's look or seat. */
  onCustomize?: (id: string, c: Customization) => void;
  /** Override the remembered sound setting (upstream default: on). */
  soundEnabled?: boolean;
}

export interface PixelOfficeHandle {
  update(agents: BranchAgent[], links?: BranchLink[]): void;
  setTheme(theme: 'dark' | 'light' | 'auto'): void;
  setReducedMotion(v: boolean | 'auto'): void;
  exportLayout(): OfficeLayout;
  importLayout(layout: OfficeLayout | string): boolean;
  resetLayout(): void;
  getCustomization(id: string): Customization | null;
  customize(id: string, c: Partial<Customization>): void;
  destroy(): void;
  /** Test/inspection hooks (positions in client pixels). */
  _debug: {
    characters(): Array<{
      id: string;
      x: number;
      y: number;
      state: string;
      pose: string | null;
      bubble: string | null;
      needs: number;
      seatId: string | null;
      visiting: boolean;
      chat: number;
      sub: boolean;
      spriteKey: string | null;
      frame: number;
    }>;
    tileToClient(col: number, row: number): { x: number; y: number };
    layout(): OfficeLayout;
    pets(): string[];
    zoom(): number;
  };
}
