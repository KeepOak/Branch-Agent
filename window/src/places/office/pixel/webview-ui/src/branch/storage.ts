/**
 * The host persists layout, seats, looks, and settings in Branch profile preferences,
 * keyed by Branch ids rather than upstream's per-session numeric ids.
 */
import type { OfficeLayout } from '../office/types.js';

export interface TrunkLook {
  /** Trunk look / pebble key (trunkSprites.ts) — or undefined for an upstream human palette. */
  spriteKey?: string;
  palette?: number;
  hueShift?: number;
}

export interface OfficePrefs {
  soundEnabled: boolean;
  alwaysShowLabels: boolean;
  ghostOffline: boolean;
  showAreas: boolean;
}

export interface OfficeStore {
  layout: OfficeLayout | null;
  seats: Record<string, string>;
  looks: Record<string, TrunkLook>;
  prefs: OfficePrefs;
}

export function defaultPrefs(): OfficePrefs {
  // Upstream defaults: sound on (configPersistence.ts), labels off, headless-as-ghosts off, areas off.
  // Branch shows names at every desk and offline Trunks as ghosts, so those two default on.
  return { soundEnabled: true, alwaysShowLabels: true, ghostOffline: true, showAreas: false };
}

export class Storage {
  private readonly initial: OfficeStore;
  private readonly save: (key: keyof OfficeStore, value: OfficeStore[keyof OfficeStore]) => void;
  constructor(initial: OfficeStore, save: (key: keyof OfficeStore, value: OfficeStore[keyof OfficeStore]) => void) {
    this.initial = initial;
    this.save = save;
  }

  load(): OfficeStore {
    return {
      layout: this.initial.layout,
      seats: { ...this.initial.seats },
      looks: { ...this.initial.looks },
      prefs: { ...defaultPrefs(), ...this.initial.prefs },
    };
  }

  saveLayout(layout: OfficeLayout | null): void {
    this.save('layout', layout);
  }

  saveSeats(seats: Record<string, string>): void {
    this.save('seats', { ...seats });
  }

  saveLooks(looks: Record<string, TrunkLook>): void {
    this.save('looks', { ...looks });
  }

  savePrefs(prefs: OfficePrefs): void {
    this.save('prefs', { ...prefs });
  }
}
