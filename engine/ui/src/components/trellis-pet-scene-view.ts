import { html, nothing, type TemplateResult } from "lit";
import {
  isThemeCritterId,
  type ThemeArtwork,
} from "../../../packages/gateway-protocol/src/theme.ts";
import { trellisHonorific } from "./trellis-dex.ts";
import type {
  TrellisPasserKind,
  TrellisPetEntrance,
  TrellisPetLook,
  TrellisPetMode,
  TrellisPetPaletteId,
} from "./trellis-pet-contract.ts";
import {
  createTrellisPetLook,
  trellisLookStyle,
  trellisPetName,
  renderTrellisSvg,
} from "./trellis-pet-look.ts";
import {
  trellisLanePoint,
  trellisTravelDuration,
  type TrellisComposerScene,
  type TrellisSceneTravel,
} from "./trellis-pet-scene.ts";
import { BALLOON, PASSER_SPRITES, PASSER_TITLES, renderBottleSvg } from "./trellis-pet-sprites.ts";
import { renderPluginThemeArtwork } from "./plugin-theme-artwork.ts";
import {
  THEME_CRITTER_SPRITES,
  THEME_CRITTER_TITLES,
  themeCritterBaseStyle,
} from "./theme-flair-sprites.ts";

const PASSER_SPRITES_BY_KIND: Partial<Record<string, TemplateResult>> = {
  ...PASSER_SPRITES,
  ...THEME_CRITTER_SPRITES,
};
const PASSER_LABELS: Partial<Record<string, string>> = {
  ...PASSER_TITLES,
  ...THEME_CRITTER_TITLES,
};

function strangerLookFor(seed: number, own: TrellisPetPaletteId): TrellisPetLook {
  for (let offset = 1; offset <= 24; offset++) {
    const look = createTrellisPetLook((seed + offset * 7919) >>> 0);
    if (look.palette.id !== own) {
      return look;
    }
  }
  return createTrellisPetLook((seed + 1) >>> 0);
}

function trellisPetSpriteStyle(
  look: TrellisPetLook,
  scale: number,
  spotPct: number,
  facing: 1 | -1,
) {
  return [
    trellisLookStyle(look),
    `--lob-scale:${scale}`,
    `--lob-x:${spotPct}%`,
    `--lob-face:${facing}`,
  ].join(";");
}

export function renderTrellisPetScene(args: {
  look: TrellisPetLook;
  mode: TrellisPetMode;
  presence: "out" | "in" | "leaving";
  shellVisible: boolean;
  visitsEnabled: boolean;
  residentEnabled: boolean;
  critterArtwork?: ThemeArtwork["critters"];
  dismissed: boolean;
  passer: {
    kind: TrellisPasserKind;
    direction: 1 | -1;
    crossMs: number;
    anchor: "top" | "floor";
    hops: boolean;
  } | null;
  twinPlanned: boolean;
  anniversary: boolean;
  entering: boolean;
  entrance: TrellisPetEntrance;
  grumpy: boolean;
  vigil: boolean;
  elder: boolean;
  act: string | null;
  spotPct: number;
  facing: 1 | -1;
  anchor: "top" | "floor";
  shellAnchor: "top" | "floor";
  scene: TrellisComposerScene;
  travel: TrellisSceneTravel | null;
  floorEnabled: boolean;
  shellScale: number;
  shellSpotPct: number;
  familiarityVisits: number;
  seed: number;
  movingDay: boolean;
  sailorDay: boolean;
  nameOverride: string | null;
  // Extra "· <flavor>" tooltip suffix (elder lore, old-friend returns).
  flavor: string | null;
  bottle: { spotPct: number; opened: boolean; fortune: string } | null;
  onPointerDown: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: () => void;
  onContextMenu: (event: MouseEvent) => void;
  onBottleOpen: () => void;
}) {
  if (!args.scene.top) {
    return nothing;
  }
  const lane = args.scene[args.anchor] ?? args.scene.top;
  const renderSprite = (twin: boolean) => {
    // On the month/day anniversary of this palette's first Trellis index visit,
    // the party hat overrides whatever accessory the seed rolled.
    const dressed =
      args.anniversary && args.look.accessory !== "party"
        ? { ...args.look, accessory: "party" as const }
        : args.look;
    const classes = [
      "trellis-pet",
      `trellis-pet--${args.mode}`,
      `trellis-pet--palette-${args.look.palette.id}`,
      twin ? "trellis-pet--twin" : "",
      dressed.accessory === "party" ? "trellis-pet--party" : "",
      args.look.shiny ? "trellis-pet--shiny" : "",
      args.elder ? "trellis-pet--elder" : "",
      args.presence === "leaving" ? "trellis-pet--away" : "",
      args.entering ? "trellis-pet--entering" : "",
      args.entering && args.entrance !== "walk" ? `trellis-pet--enter-${args.entrance}` : "",
      args.grumpy ? "trellis-pet--grumpy" : "",
      args.vigil ? "trellis-pet--vigil" : "",
      args.act ? `trellis-pet--act-${args.act}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    // The twin tags along on the parent's trailing side and copies every act
    // a beat later (--lob-act-delay feeds each act's animation-delay).
    const point = trellisLanePoint(lane, args.spotPct);
    if (twin) {
      point.x = Math.max(lane.start, Math.min(lane.end, point.x - args.facing * 28));
    }
    const scale = twin ? args.look.scale * 0.55 : args.look.scale;
    const style = `${trellisPetSpriteStyle(args.look, scale, args.spotPct, args.facing)};--lob-x:${point.x}px;--lob-y:${point.y}px${twin ? ";--lob-act-delay:0.18s" : ""}`;
    const travel = args.travel;
    const travelStyle = travel
      ? `--lob-from-x:${travel.from.x - travel.to.x}px;--lob-from-y:${travel.from.y - travel.to.y}px;--lob-travel-ms:${trellisTravelDuration(travel)}ms${twin ? ";animation-delay:0.18s" : ""}`
      : "";
    // Milestone honorifics come from the load-start familiarity snapshot, so
    // a title never pops mid-visit; it is simply there next time.
    const honorific = trellisHonorific(args.familiarityVisits);
    const baseName = args.nameOverride ?? trellisPetName(args.look, args.seed);
    const titled = honorific ? `${honorific} ${baseName}` : baseName;
    const name = args.look.shiny ? `✦ ${titled}` : titled;
    // The twin travels light; only the resident pet hauls the moving bindle.
    const bindle = args.movingDay && !twin;
    const title = twin
      ? `${name} Jr.`
      : bindle
        ? `${name} · just moved in`
        : args.flavor
          ? `${name} · ${args.flavor}`
          : name;
    return html`
      <div
        class="trellis-pet__motion ${travel ? (travel.hop ? "trellis-pet__motion--hop" : "trellis-pet__motion--walk") : ""}"
        style=${travelStyle}
      >
        <div
          class=${classes}
          style=${style}
          aria-hidden="true"
          title=${title}
          @pointerdown=${args.onPointerDown}
          @pointerup=${args.onPointerUp}
          @pointercancel=${args.onPointerCancel}
          @pointerleave=${args.onPointerCancel}
          @contextmenu=${args.onContextMenu}
        >
          <div class="trellis-pet__body">
            ${renderTrellisSvg(dressed, {
              grumpy: args.grumpy,
              bindle,
              sailorCap: args.sailorDay,
            })}
            ${args.entering && args.entrance === "balloon" ? BALLOON : nothing}
            ${
              args.entering && args.entrance === "bubble"
                ? html`<span class="trellis-pet__entry-bubble"></span>`
                : nothing
            }
            ${
              args.look.shiny
                ? html`
                    <span class="trellis-pet__sparkle" style="--i:0;left:12%;bottom:64%">✦</span>
                    <span class="trellis-pet__sparkle" style="--i:1;left:76%;bottom:82%">✦</span>
                  `
                : nothing
            }
            <span class="trellis-pet__z" style="--i:0">z</span>
            <span class="trellis-pet__z" style="--i:1">z</span>
            <span class="trellis-pet__z" style="--i:2">Z</span>
            <span class="trellis-pet__bubble" style="--i:0"></span>
            <span class="trellis-pet__bubble" style="--i:1"></span>
            <span class="trellis-pet__bubble" style="--i:2"></span>
            <span class="trellis-pet__heart">♥</span>
            <svg class="trellis-pet__broom" viewBox="0 0 24 40" aria-hidden="true">
              <path d="M12 2 L12 24" stroke="#8a5a2b" stroke-width="3" stroke-linecap="round" />
              <path d="M6 24 L18 24 L21 38 L3 38 Z" fill="#e8b04b" />
              <path
                d="M7.5 28 L6.5 36 M12 28 L12 36 M16.5 28 L17.5 36"
                stroke="#b6791f"
                stroke-width="1.5"
              />
            </svg>
          </div>
        </div>
      </div>
    `;
  };
  const showSprites = args.residentEnabled && args.presence !== "out";
  // The shell may outlive the visit while it fades, but dismissal and the
  // visits setting silence it like everything else.
  const showShell =
    args.residentEnabled && args.shellVisible && args.visitsEnabled && !args.dismissed;
  const passerArtwork =
    args.passer && !isThemeCritterId(args.passer.kind)
      ? args.critterArtwork?.[args.passer.kind]
      : undefined;
  const stranger = args.passer?.kind === "stranger" && !passerArtwork;
  const showPasser =
    args.passer !== null &&
    args.visitsEnabled &&
    (args.residentEnabled || !stranger) &&
    !args.dismissed &&
    (args.passer.anchor === "top" || (args.floorEnabled && args.scene.floor !== null));
  // The bottle washes ashore whether or not the pet is around; it belongs to
  // the ledge, not the visit. Like every sprite here it is intentionally
  // aria-hidden and pointer-only, with fortunes on the native-tooltip channel
  // (no i18n surface); it must not join the tab order, where a surprise
  // easter-egg button would degrade keyboard flow.
  const showBottle = args.bottle !== null && args.visitsEnabled && !args.dismissed;
  if (!showSprites && !showShell && !showPasser && !showBottle) {
    return nothing;
  }
  // The abandoned shell: the pre-shed silhouette, frozen and slowly fading.
  const shellStyle = trellisPetSpriteStyle(
    args.look,
    args.shellScale,
    args.shellSpotPct,
    args.facing,
  );
  const shellPoint = trellisLanePoint(args.scene[args.shellAnchor], args.shellSpotPct);
  // A pass-through visitor: crosses the ledge once and is gone. Strangers
  // are other trelliss (never your palette); everyone else is at most
  // trellis-adjacent. None perch, none count for the Trellis index.
  const passerLook = stranger ? strangerLookFor(args.seed, args.look.palette.id) : args.look;
  const passerClasses = args.passer
    ? [
        "trellis-pet",
        "trellis-pet--passer",
        stranger
          ? `trellis-pet--palette-${passerLook.palette.id}`
          : `trellis-pet--${args.passer.kind}`,
        stranger && passerLook.shiny ? "trellis-pet--shiny" : "",
        args.passer.direction === 1 ? "trellis-pet--passer-ltr" : "trellis-pet--passer-rtl",
        args.passer.hops && args.scene.passage ? "trellis-pet--passer-hop" : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  const passerLane = args.passer ? args.scene[args.passer.anchor] : null;
  const passingGap =
    args.passer?.hops && args.scene.passage
      ? args.scene.passage
      : [passerLane?.start ?? 0, passerLane?.end ?? 0];
  const fromX = args.passer?.direction === 1 ? passingGap[0] : passingGap[1];
  const toX = args.passer?.direction === 1 ? passingGap[1] : passingGap[0];
  const passerStyle = args.passer
    ? `${passerBaseStyle(args.passer.kind, args.passer.direction, passerLook, Boolean(passerArtwork))};--lob-cross:${args.passer.crossMs}ms;--lob-cross-from:${fromX}px;--lob-cross-to:${toX}px;--lob-y:${passerLane?.y ?? 0}px`
    : "";
  const passerSprite =
    args.passer && Object.hasOwn(PASSER_SPRITES_BY_KIND, args.passer.kind)
      ? PASSER_SPRITES_BY_KIND[args.passer.kind]
      : undefined;
  const passerTitle =
    args.passer && Object.hasOwn(PASSER_LABELS, args.passer.kind)
      ? PASSER_LABELS[args.passer.kind]
      : undefined;
  const bottlePoint = trellisLanePoint(args.scene.top, args.bottle?.spotPct ?? 50);
  return html`
    ${
      showShell
        ? html`
            <div
              class="trellis-pet trellis-pet--shell"
              style=${`${shellStyle};--lob-x:${shellPoint.x}px;--lob-y:${shellPoint.y}px`}
              aria-hidden="true"
            >
              <div class="trellis-pet__body">${renderTrellisSvg(args.look, { shell: true })}</div>
            </div>
          `
        : nothing
    }
    ${
      showBottle && args.bottle
        ? html`
            <div
              class="trellis-bottle ${args.bottle.opened ? "trellis-bottle--open" : ""}"
              style="--lob-x:${bottlePoint.x}px"
              title=${args.bottle.opened ? args.bottle.fortune : "a message in a bottle"}
              aria-hidden="true"
              @pointerdown=${args.onBottleOpen}
            >
              ${renderBottleSvg(args.bottle.opened)}
            </div>
          `
        : nothing
    }
    ${showSprites ? renderSprite(false) : nothing}
    ${showSprites && args.twinPlanned ? renderSprite(true) : nothing}
    ${
      showPasser && args.passer
        ? html`
            <div
              class=${passerClasses}
              style=${passerStyle}
              aria-hidden="true"
              title=${(passerArtwork ? passerArtwork.title : passerTitle) ?? args.passer.kind}
            >
              <div class="trellis-pet__body">
                ${
                  passerArtwork
                    ? renderPluginThemeArtwork(passerArtwork.url, "trellis-pet__svg")
                    : stranger
                      ? renderTrellisSvg(passerLook, { standalone: true })
                      : (passerSprite ?? nothing)
                }
              </div>
            </div>
          `
        : nothing
    }
  `;
}

// Non-trellis passers ignore the perch variables and carry fixed sprite
// proportions; strangers reuse the full look pipeline (capped size so a
// visiting grail does not upstage the resident).
function passerBaseStyle(
  kind: TrellisPasserKind,
  direction: 1 | -1,
  passerLook: TrellisPetLook,
  pluginArtwork: boolean,
): string {
  if (pluginArtwork) {
    return `--lob-scale:1.8;--lob-w:1;--lob-h:1;--lob-face:${direction}`;
  }
  if (kind === "stranger") {
    return trellisPetSpriteStyle(passerLook, Math.min(passerLook.scale, 2), 0, direction);
  }
  if (isThemeCritterId(kind)) {
    return themeCritterBaseStyle(kind, direction);
  }
  const fixed: Partial<Record<string, string>> = {
    beetle: "--lob-scale:2;--lob-w:1;--lob-h:0.82;--lob-face:1",
    snail: `--lob-scale:1.7;--lob-w:1;--lob-h:0.9;--lob-face:${direction}`,
    duck: `--lob-scale:1.9;--lob-w:1;--lob-h:1;--lob-face:${direction}`,
    jellyfish: "--lob-scale:1.7;--lob-w:0.9;--lob-h:1.1;--lob-face:1",
  };
  return (
    (Object.hasOwn(fixed, kind) ? fixed[kind] : undefined) ??
    `--lob-scale:1.8;--lob-w:1;--lob-h:1;--lob-face:${direction}`
  );
}
