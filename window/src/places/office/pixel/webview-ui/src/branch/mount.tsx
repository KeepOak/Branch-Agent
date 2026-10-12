/**
 * Public entry: mountPixelOffice(el, options) → handle. Mounts the whole Pixel Agents office
 * (upstream webview-ui, React + canvas) into a shadow root on `el`, so its styles never touch the
 * host app and the host's never touch it.
 */
import { createRoot, type Root } from 'react-dom/client';

import { EditorState } from '../office/editor/editorState.js';
import { OfficeState } from '../office/engine/officeState.js';
import { setCustomSpriteFactory } from '../office/sprites/spriteData.js';
import { TILE_SIZE } from '../office/types.js';
import { setActiveTransport } from '../transport/index.js';
import { loadAssets, loadPixelFont } from './assets.js';
import { type AppApi, AppSignals, BranchApp } from './BranchApp.js';
import { BranchServer } from './branchServer.js';
import { setOfficeKeyRoot } from './keyScope.js';
import CSS from './office.css?inline';
import { setTrunkSheets, trunkSpriteFactory } from './trunkSprites.js';
import type { BranchAgent, BranchLink, MountOptions, PixelOfficeHandle } from './types.js';

let propertiesHoisted = false;

/** Tailwind v4 declares its --tw-* variables with @property, which browsers ignore inside a shadow
 *  root; declared once in the document they apply everywhere (they only set types and defaults). */
function hoistProperties(css: string): string {
  const props = css.match(/@property\s+--[\w-]+\s*\{[^}]*\}/g) ?? [];
  if (!propertiesHoisted && props.length) {
    const style = document.createElement('style');
    style.dataset.pixelOffice = 'properties';
    style.textContent = props.join('\n');
    document.head.appendChild(style);
    propertiesHoisted = true;
  }
  return css;
}

function resolveTheme(pref: 'dark' | 'light' | 'auto'): 'dark' | 'light' {
  if (pref !== 'auto') return pref;
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveMotion(pref: boolean | 'auto'): boolean {
  if (pref !== 'auto') return pref;
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function mountPixelOffice(el: HTMLElement, options: MountOptions): PixelOfficeHandle {
  const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
  shadow.replaceChildren();
  const style = document.createElement('style');
  style.textContent = hoistProperties(CSS);
  const rootEl = document.createElement('div');
  rootEl.className = 'pa-root';
  rootEl.setAttribute('role', 'application');
  rootEl.setAttribute('aria-label', 'Pixel office: your Trunks at their desks');
  shadow.append(style, rootEl);
  setOfficeKeyRoot(rootEl);

  let themePref = options.theme ?? 'auto';
  let motionPref = options.reducedMotion ?? 'auto';
  let agents: BranchAgent[] = options.agents;
  let links: BranchLink[] = options.links ?? [];
  const signals = new AppSignals();
  signals.agents = agents;
  const officeState = new OfficeState();
  const editorState = new EditorState();
  const storage = options.storage;
  let server: BranchServer | null = null;
  let api: AppApi | null = null;
  let root: Root | null = null;
  let destroyed = false;

  const applyEnv = () => {
    signals.theme = resolveTheme(themePref);
    signals.reducedMotion = resolveMotion(motionPref);
    officeState.reducedMotion = signals.reducedMotion;
    rootEl.setAttribute('data-theme', signals.theme);
    signals.emit();
  };
  const mqDark = window.matchMedia?.('(prefers-color-scheme: dark)');
  const mqMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  mqDark?.addEventListener('change', applyEnv);
  mqMotion?.addEventListener('change', applyEnv);
  const htmlObserver = new MutationObserver(applyEnv);
  htmlObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  applyEnv();

  const open = (id: string) => options.onOpen?.(id);

  rootEl.textContent = 'Opening the office…';
  void Promise.all([loadAssets(), loadPixelFont()])
    .then(([assets]) => {
      if (destroyed) return;
      rootEl.textContent = '';
      setTrunkSheets(assets.trunkSheets);
      setCustomSpriteFactory(trunkSpriteFactory);
      server = new BranchServer(
        { ...options, agents, links },
        storage,
        assets,
        () => officeState,
        () => signals.reducedMotion,
      );
      setActiveTransport(server);
      root = createRoot(rootEl);
      root.render(
        <BranchApp
          officeState={officeState}
          editorState={editorState}
          server={server}
          signals={signals}
          onNewAgent={options.onNewAgent}
          onOpen={open}
          registerApi={(a) => {
            api = a;
          }}
        />,
      );
      // Links that arrived while assets were decoding.
      queueMicrotask(() => server?.update(agents, links));
    })
    .catch((err) => {
      console.error('[PixelOffice] failed to start', err);
      rootEl.textContent = 'The pixel office could not start.';
    });

  const handle: PixelOfficeHandle = {
    update(nextAgents, nextLinks) {
      agents = nextAgents;
      if (nextLinks) links = nextLinks;
      signals.agents = agents;
      server?.update(agents, nextLinks ?? []);
      signals.emit();
    },
    setTheme(t) {
      themePref = t;
      applyEnv();
    },
    setReducedMotion(v) {
      motionPref = v;
      applyEnv();
    },
    exportLayout: () => structuredClone(officeState.getLayout()),
    importLayout(layout) {
      try {
        const parsed = typeof layout === 'string' ? JSON.parse(layout) : layout;
        if (parsed?.version !== 1 || !Array.isArray(parsed.tiles) || !Array.isArray(parsed.furniture)) return false;
        server?.applyLayout(parsed);
        return true;
      } catch {
        return false;
      }
    },
    resetLayout: () => server?.applyLayout(null),
    getCustomization: (id) => server?.customization(id) ?? null,
    customize: (id, c) => {
      server?.customize(id, c);
      signals.emit();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root?.unmount();
      server?.dispose();
      setActiveTransport(null);
      setOfficeKeyRoot(null);
      mqDark?.removeEventListener('change', applyEnv);
      mqMotion?.removeEventListener('change', applyEnv);
      htmlObserver.disconnect();
      shadow.replaceChildren();
    },
    _debug: {
      characters: () => {
        const r = rootEl.getBoundingClientRect();
        const z = api?.zoom() ?? 1;
        const pan = api?.pan() ?? { x: 0, y: 0 };
        const dpr = window.devicePixelRatio || 1;
        const layout = officeState.getLayout();
        const cw = Math.round(r.width * dpr);
        const chh = Math.round(r.height * dpr);
        const ox = Math.floor((cw - layout.cols * TILE_SIZE * z) / 2) + Math.round(pan.x);
        const oy = Math.floor((chh - layout.rows * TILE_SIZE * z) / 2) + Math.round(pan.y);
        return [...officeState.characters.values()].map((ch) => {
          const owner = ch.isSubagent && ch.parentAgentId !== null ? ch.parentAgentId : ch.id;
          const sit = ch.state === 'type' ? 6 : 0;
          return {
            id: server?.branchIdOf(owner) ?? String(ch.id),
            x: r.left + (ox + ch.x * z) / dpr,
            y: r.top + (oy + (ch.y + sit - 8) * z) / dpr,
            state: ch.state,
            pose: ch.pose ?? null,
            bubble: ch.bubbleType,
            needs: ch.needsCount ?? 0,
            seatId: ch.seatId,
            visiting: !!ch.visit,
            chat: ch.chatTimer ?? 0,
            sub: ch.isSubagent,
            spriteKey: ch.spriteKey ?? null,
            frame: ch.frame,
          };
        });
      },
      tileToClient: (col, row) => {
        const r = rootEl.getBoundingClientRect();
        const z = api?.zoom() ?? 1;
        const pan = api?.pan() ?? { x: 0, y: 0 };
        const dpr = window.devicePixelRatio || 1;
        const layout = officeState.getLayout();
        const ox = Math.floor((Math.round(r.width * dpr) - layout.cols * TILE_SIZE * z) / 2) + Math.round(pan.x);
        const oy = Math.floor((Math.round(r.height * dpr) - layout.rows * TILE_SIZE * z) / 2) + Math.round(pan.y);
        return {
          x: r.left + (ox + (col + 0.5) * TILE_SIZE * z) / dpr,
          y: r.top + (oy + (row + 0.5) * TILE_SIZE * z) / dpr,
        };
      },
      layout: () => officeState.getLayout(),
      pets: () => officeState.pets.map((p) => p.name),
      zoom: () => api?.zoom() ?? 0,
    },
  };
  return handle;
}

export type { BranchAgent, BranchLink, Customization, MountOptions, PixelOfficeHandle } from './types.js';
export { Storage } from './storage.js';
