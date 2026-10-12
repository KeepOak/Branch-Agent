/**
 * Character customization (Branch addition; the look follows SweetSophia openclaw-pixel-agents
 * src/components/CharacterCustomizer.tsx — pick a body, tint it, see it live). For every Trunk and
 * grafted agent: its sprite (the Trunk looks from the app, the classic pebble in the Trunk's colour,
 * or one of upstream's six office workers), a hue shift (upstream's adjustSprite hue rotation), and
 * its desk. "Use app look" goes back to the look the Trunk has in the app.
 */
import { useEffect, useRef, useState } from 'react';

import { Button } from '../components/ui/Button.js';
import { Modal } from '../components/ui/Modal.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { getCachedSprite } from '../office/sprites/spriteCache.js';
import { getSpritesFor } from '../office/sprites/spriteData.js';
import { Direction } from '../office/types.js';
import type { BranchServer } from './branchServer.js';
import { TRUNK_LOOKS } from './trunkSprites.js';
import type { BranchAgent } from './types.js';

function SpriteThumb({ sprite, hueShift, scale = 2 }: { sprite: string; hueShift: number; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const human = /^human:(\d)$/.exec(sprite);
    const set = getSpritesFor(human ? undefined : sprite, human ? Number(human[1]) : 0, hueShift);
    const frame = set.walk[Direction.DOWN][1];
    const img = getCachedSprite(frame, scale);
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0);
  }, [sprite, hueShift, scale]);
  return <canvas ref={ref} className="pa-thumb" />;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  server: BranchServer;
  officeState: OfficeState;
  agents: BranchAgent[];
  onChanged: () => void;
}

export function CharactersPanel({ isOpen, onClose, server, officeState, agents, onChanged }: Props) {
  const people = agents.filter((a) => a.kind !== 'group');
  const [pick, setPick] = useState<string | null>(null);
  const current = people.find((a) => a.id === pick) ?? people[0];
  const [, bump] = useState(0);
  if (!isOpen || !current) return null;
  const c = server.customization(current.id);
  if (!c) return null;
  const options = [
    `pebble:${current.shape ?? 0}:${current.eyes ?? 'round'}:${current.colorHint ?? '#56616B'}`,
    ...TRUNK_LOOKS.map((l) => `look:${l.id}`),
    ...[0, 1, 2, 3, 4, 5].map((n) => `human:${n}`),
  ];
  const nameOf = (o: string) =>
    o.startsWith('look:')
      ? (TRUNK_LOOKS.find((l) => `look:${l.id}` === o)?.name ?? o)
      : o.startsWith('pebble:')
        ? 'Classic pebble'
        : `Office worker ${Number(o.slice(6)) + 1}`;
  const change = (patch: Parameters<BranchServer['customize']>[1]) => {
    server.customize(current.id, patch);
    bump((n) => n + 1);
    onChanged();
  };
  const seats = [...officeState.seats.values()];
  const zone = (uid: string) => officeState.seatZone(uid) ?? 'Office';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Trunks" className="pa-panel">
      <div className="flex gap-8 px-8 pb-6 flex-wrap pa-scroll" data-testid="trunk-list" style={{ maxWidth: 560 }}>
        {people.map((a) => {
          const ac = server.customization(a.id)!;
          return (
            <button
              key={a.id}
              type="button"
              data-trunk={a.id}
              onClick={() => setPick(a.id)}
              className={`flex flex-col items-center gap-2 p-4 border-2 cursor-pointer bg-transparent ${a.id === current.id ? 'border-accent bg-active-bg' : 'border-transparent hover:bg-btn-bg'}`}
            >
              <SpriteThumb sprite={ac.sprite} hueShift={ac.hueShift} />
              <span className="text-2xs leading-none">{a.name}</span>
            </button>
          );
        })}
      </div>
      <div className="px-10 pb-8 flex flex-col gap-6" style={{ maxWidth: 560 }}>
        <div className="flex items-center gap-8">
          <SpriteThumb sprite={c.sprite} hueShift={c.hueShift} scale={4} />
          <div className="flex flex-col gap-2">
            <span className="text-lg text-accent-bright leading-none">{current.name}</span>
            <span className="text-xs text-text-muted leading-none">
              {nameOf(c.sprite)}
              {current.kind === 'grafted' ? ' · grafted (A2A)' : ''}
            </span>
          </div>
        </div>
        <span className="text-xs text-text-muted">Look</span>
        <div className="grid gap-4 pa-scroll" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))', maxHeight: 220 }} data-testid="look-grid">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              title={nameOf(o)}
              data-look={o}
              onClick={() => change({ sprite: o })}
              className={`flex items-center justify-center p-2 border-2 cursor-pointer bg-transparent ${o === c.sprite ? 'border-accent bg-active-bg' : 'border-transparent hover:bg-btn-bg'}`}
            >
              <SpriteThumb sprite={o} hueShift={o === c.sprite ? c.hueShift : 0} />
            </button>
          ))}
        </div>
        <label className="flex items-center gap-8 text-xs">
          <span className="text-text-muted w-[70px]">Hue</span>
          <input
            type="range"
            min={0}
            max={359}
            value={c.hueShift}
            data-testid="hue"
            className="pixel-range flex-1"
            style={{ '--range-fill': `${(c.hueShift / 359) * 100}%` } as React.CSSProperties}
            onChange={(e) => change({ hueShift: Number(e.target.value) })}
          />
          <span className="w-[40px] text-right">{c.hueShift}°</span>
        </label>
        <label className="flex items-center gap-8 text-xs">
          <span className="text-text-muted w-[70px]">Desk</span>
          <select
            value={c.seatId ?? ''}
            data-testid="seat"
            className="flex-1 bg-bg-dark text-text border-2 border-border py-2 px-4 text-xs"
            onChange={(e) => change({ seatId: e.target.value || null })}
          >
            {seats.map((s) => (
              <option key={s.uid} value={s.uid} disabled={s.assigned && s.uid !== c.seatId}>
                {s.uid} · {zone(s.uid)}
                {s.assigned && s.uid !== c.seatId ? ' (taken)' : ''}
              </option>
            ))}
          </select>
        </label>
        <span className="text-2xs text-text-muted">You can also drag a Trunk onto a free desk in the office.</span>
        <div className="flex gap-6 justify-end">
          <Button
            size="md"
            onClick={() => {
              server.resetLook(current.id);
              bump((n) => n + 1);
              onChanged();
            }}
          >
            Use app look
          </Button>
          <Button size="md" variant="accent" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
