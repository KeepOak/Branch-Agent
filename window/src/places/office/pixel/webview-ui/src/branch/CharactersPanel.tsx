import { useState } from 'react';

import { Button } from '../components/ui/Button.js';
import { Modal } from '../components/ui/Modal.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { getCachedSprite } from '../office/sprites/spriteCache.js';
import { getSpritesFor } from '../office/sprites/spriteData.js';
import { Direction, type SpriteData } from '../office/types.js';
import type { BranchServer } from './branchServer.js';
import { defaultSpriteKey, TRUNK_LOOKS } from './trunkSprites.js';
import type { BranchAgent, Customization } from './types.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  server: BranchServer;
  officeState: OfficeState;
  agents: BranchAgent[];
  onChanged: () => void;
}

interface LookOption {
  key: string;
  label: string;
}

const WORKER_COUNT = 6;
const HUMAN_PREFIX = 'human:';
const PREVIEW_FRAME = 1;
const HUE_MAX = 359;
const HUE_HANDLE_WIDTH = 9;
const GRAFTED_SUFFIX = ' · grafted (A2A)';
const SELECTED = 'border-accent';
const IDLE = 'border-transparent hover:bg-btn-bg';

function previewFrame(sprite: string, hueShift: number): SpriteData {
  const sprites = sprite.startsWith(HUMAN_PREFIX)
    ? getSpritesFor(undefined, Number(sprite.slice(HUMAN_PREFIX.length)), hueShift)
    : getSpritesFor(sprite, 0, hueShift);
  return sprites.walk[Direction.DOWN][PREVIEW_FRAME];
}

function SpriteView({ frame, scale }: { frame: SpriteData; scale: number }) {
  const draw = (canvas: HTMLCanvasElement | null) => {
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.drawImage(getCachedSprite(frame, scale), 0, 0);
  };
  return <canvas ref={draw} width={frame[0].length * scale} height={frame.length * scale} />;
}

function lookOf(server: BranchServer, agent: BranchAgent): Customization {
  const custom = server.customization(agent.id);
  return custom ?? { sprite: defaultSpriteKey(agent), hueShift: 0, seatId: null };
}

function lookOptions(agent: BranchAgent): LookOption[] {
  const pebble = defaultSpriteKey({ shape: agent.shape, eyes: agent.eyes, colorHint: agent.colorHint });
  const workers = Array.from({ length: WORKER_COUNT }, (_, i) => ({
    key: `${HUMAN_PREFIX}${i}`,
    label: `Office worker ${i + 1}`,
  }));
  return [
    { key: pebble, label: 'Classic pebble' },
    ...TRUNK_LOOKS.map((look) => ({ key: `look:${look.id}`, label: look.name })),
    ...workers,
  ];
}

function selectedOption(options: LookOption[], sprite: string): LookOption | undefined {
  if (sprite.startsWith('pebble:')) return options[0];
  return options.find((o) => o.key === sprite);
}

function seatOptions(officeState: OfficeState, ownSeat: string | null) {
  return Array.from(officeState.seats, ([id, seat]) => {
    const zone = officeState.seatZone(id) ?? 'Office';
    const taken = seat.assigned && id !== ownSeat;
    return { id, label: `${id} · ${zone}${taken ? ' (taken)' : ''}`, taken };
  });
}

interface TileProps {
  agent: BranchAgent;
  selected: boolean;
  server: BranchServer;
  onPick: () => void;
}

function TrunkTile({ agent, selected, server, onPick }: TileProps) {
  const look = lookOf(server, agent);
  const frame = previewFrame(look.sprite, look.hueShift);
  const box = `flex h-[82px] w-[60px] flex-col items-center border-2 pt-[4px] ${selected ? SELECTED : IDLE}`;
  return (
    <button type="button" title={agent.name} onClick={onPick} className={box}>
      <SpriteView frame={frame} scale={2} />
      <span className="mt-[3px] pr-[2px] text-xs leading-[16px] tracking-[-1px] text-text">{agent.name}</span>
    </button>
  );
}

interface CellProps {
  option: LookOption;
  selected: boolean;
  hue: number;
  onPick: () => void;
}

function LookCell({ option, selected, hue, onPick }: CellProps) {
  const frame = previewFrame(option.key, selected ? hue : 0);
  const box = `flex w-[45px] items-center justify-center border-2 p-[2px] ${selected ? SELECTED : IDLE}`;
  return (
    <button type="button" title={option.label} onClick={onPick} className={box}>
      <SpriteView frame={frame} scale={2} />
    </button>
  );
}

function HueRow({ hue, onHue }: { hue: number; onHue: (value: number) => void }) {
  const share = hue / HUE_MAX;
  const fill = `${share * 100}%`;
  const handle = `calc((100% - ${HUE_HANDLE_WIDTH}px) * ${share})`;
  return (
    <div className="flex h-[19px] items-start pl-[8px] pr-[9px] text-xs">
      <span className="mt-[2px] w-[70px] pl-[2px] leading-[16px] text-text-muted">Hue</span>
      <div className="relative ml-[10px] mt-[3px] h-[16px] w-[165px] border-2 border-border bg-bg-dark">
        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: fill }} />
        <div className="absolute -top-[5px] h-[19px] bg-border" style={{ left: handle, width: HUE_HANDLE_WIDTH }}>
          <div className="absolute inset-x-[1px] inset-y-[2px] bg-text" />
        </div>
        <input
          type="range"
          min={0}
          max={HUE_MAX}
          step={1}
          value={hue}
          onChange={(e) => onHue(Number(e.target.value))}
          className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Hue"
        />
      </div>
      <span className="ml-[8px] mt-[2px] w-[40px] text-right leading-[16px] text-text">{hue}°</span>
    </div>
  );
}

function DeskRow({ officeState, seatId, onSeat }: { officeState: OfficeState; seatId: string | null; onSeat: (id: string) => void }) {
  return (
    <div className="flex h-[28px] items-start pl-[8px] pr-[9px] text-xs">
      <span className="mt-[6px] w-[70px] pl-[2px] leading-[16px] text-text-muted">Desk</span>
      <select
        value={seatId ?? ''}
        onChange={(e) => onSeat(e.target.value)}
        className="ml-[10px] h-[28px] w-[213px] border-2 border-border bg-bg-dark px-[4px] text-xs text-text"
      >
        {seatOptions(officeState, seatId).map((o) => (
          <option key={o.id} value={o.id} disabled={o.taken}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function LookGrid({ options, selected, hue, onPick }: { options: LookOption[]; selected?: LookOption; hue: number; onPick: (key: string) => void }) {
  return (
    <div className="grid max-h-[220px] gap-[4px] overflow-y-auto px-[2px]" style={{ gridTemplateColumns: 'repeat(6, 45px)' }}>
      {options.map((o) => (
        <LookCell key={o.key} option={o} selected={o === selected} hue={hue} onPick={() => onPick(o.key)} />
      ))}
    </div>
  );
}

function DetailRow({ name, subtitle, frame }: { name: string; subtitle: string; frame: SpriteData }) {
  return (
    <div className="mt-[6px] flex h-[104px] items-center gap-[8px] pl-[10px]">
      <SpriteView frame={frame} scale={4} />
      <div className="flex flex-col pt-[2px]">
        <span className="text-lg leading-[18px] text-accent-bright">{name}</span>
        <span className="mt-[7px] text-xs leading-[16px] text-text-muted">{subtitle}</span>
      </div>
    </div>
  );
}

function ActionRow({ onReset, onDone }: { onReset: () => void; onDone: () => void }) {
  return (
    <div className="mt-[13px] flex justify-end gap-[5.84px] pl-[8px] pr-[10.72px]">
      <Button size="md" className="!h-[41px] !w-[115.91px] !px-0" onClick={onReset}>
        Use app look
      </Button>
      <Button size="md" variant="accent" className="!h-[41px] !w-[59.09px] !px-0" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

export function CharactersPanel({ isOpen, onClose, server, officeState, agents, onChanged }: Props) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const trunks = agents.filter((a) => a.kind !== 'group');
  const current = trunks.find((a) => a.id === pickedId) ?? trunks[0];
  if (!isOpen || !current || server.customization(current.id) === null) return null;
  const look = lookOf(server, current);
  const options = lookOptions(current);
  const selected = selectedOption(options, look.sprite);
  const change = (patch: Partial<Customization>) => {
    server.customize(current.id, patch);
    onChanged();
  };
  const resetLook = () => {
    server.resetLook(current.id);
    onChanged();
  };
  const grafted = current.kind === 'grafted' ? GRAFTED_SUFFIX : '';
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Trunks">
      <div className="flex w-[310.921875px] flex-col pb-[8px]">
        <div className="flex flex-wrap gap-[8px] pl-[8px]">
          {trunks.map((agent) => (
            <TrunkTile key={agent.id} agent={agent} selected={agent.id === current.id} server={server} onPick={() => setPickedId(agent.id)} />
          ))}
        </div>
        <DetailRow name={current.name} subtitle={(selected?.label ?? look.sprite) + grafted} frame={previewFrame(look.sprite, look.hueShift)} />
        <div className="mt-[11px] h-[16px] pl-[10px] text-xs leading-[16px] text-text-muted">Look</div>
        <div className="mt-[12px] pl-[8px]">
          <LookGrid options={options} selected={selected} hue={look.hueShift} onPick={(sprite) => change({ sprite })} />
        </div>
        <div className="mt-[9px] h-[19px]">
          <HueRow hue={look.hueShift} onHue={(hueShift) => change({ hueShift })} />
        </div>
        <div className="mt-[11px] h-[28px]">
          <DeskRow officeState={officeState} seatId={look.seatId} onSeat={(seatId) => change({ seatId })} />
        </div>
        <div className="mt-[14px] h-[9px] overflow-hidden pl-[9.75px] text-xs leading-[11px] tracking-[0.6px] text-text-muted">
          You can also drag a Trunk onto a free desk in the office.
        </div>
        <ActionRow onReset={resetLook} onDone={onClose} />
      </div>
    </Modal>
  );
}
