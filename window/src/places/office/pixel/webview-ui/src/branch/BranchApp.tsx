/**
 * Branch's composition root — upstream webview-ui/src/App.tsx with the VS Code / CLI-only parts
 * (consent intro, hooks tooltip and modal, changelog, version and connection indicators, migration
 * notice) left out and Branch's parts added: per-mount office state, fit-to-pane integer zoom,
 * day/night lighting, the Trunks customization panel and Branch's overlay. Everything upstream
 * renders in the office itself — canvas, editor, toolbars and zoom — is upstream's code.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { EditActionBar } from '../components/EditActionBar.js';
import { ZoomControls } from '../components/ZoomControls.js';
import { useEditorActions } from '../hooks/useEditorActions.js';
import { useEditorKeyboard } from '../hooks/useEditorKeyboard.js';
import { useExtensionMessages } from '../hooks/useExtensionMessages.js';
import { OfficeCanvas } from '../office/components/OfficeCanvas.js';
import type { EditorState } from '../office/editor/editorState.js';
import { EditorToolbar } from '../office/editor/EditorToolbar.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { exportLayoutToFile } from '../office/layout/exportLayout.js';
import { isRotatable } from '../office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from '../office/layout/layoutSerializer.js';
import { getPetCount } from '../office/sprites/petSpriteData.js';
import { EditTool, type OfficeLayout, TILE_SIZE } from '../office/types.js';
import { transport } from '../transport/index.js';
import { BranchSettings, BranchToolbar } from './BranchChrome.js';
import { BranchOverlay } from './BranchOverlay.js';
import type { BranchServer } from './branchServer.js';
import { CharactersPanel } from './CharactersPanel.js';
import { claimOfficeModalEscape, notePointerInside } from './keyScope.js';
import { fitZoom, TOOLBAR_RESERVE_CSS } from './fit.js';
import { makeLighting, type OfficeTheme } from './lighting.js';
import type { BranchAgent } from './types.js';

/** Small external store the mount uses to push theme / motion / roster changes into React. */
export class AppSignals {
  theme: OfficeTheme = 'dark';
  reducedMotion = false;
  agents: BranchAgent[] = [];
  version = 0;
  private subs = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  snapshot = () => this.version;
  emit(): void {
    this.version++;
    for (const fn of this.subs) fn();
  }
}

/** Imperative hooks BranchApp hands back to the mount (layout export / import / reset). */
export interface AppApi {
  importLayout(layout: OfficeLayout): boolean;
  zoom(): number;
  pan(): { x: number; y: number };
}

interface Props {
  officeState: OfficeState;
  editorState: EditorState;
  server: BranchServer;
  signals: AppSignals;
  onNewAgent?: () => void;
  onOpen: (id: string) => void;
  registerApi: (api: AppApi) => void;
}

export function BranchApp({ officeState, editorState, server, signals, onNewAgent, onOpen, registerApi }: Props) {
  useSyncExternalStore(signals.subscribe, signals.snapshot);
  const getOfficeState = useCallback(() => officeState, [officeState]);
  const editor = useEditorActions(getOfficeState, editorState);
  const isEditDirty = useCallback(() => editor.isEditMode && editor.isDirty, [editor.isEditMode, editor.isDirty]);
  const msgs = useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTrunksOpen, setIsTrunksOpen] = useState(false);
  const [alwaysShowOverlay, setAlwaysShowOverlay] = useState(true);
  const [autoFit, setAutoFit] = useState(true);
  const [, setTick] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setAlwaysShowOverlay(msgs.alwaysShowLabels), [msgs.alwaysShowLabels]);

  // Branch: Trunk poses + reduced motion live on the office state.
  useEffect(() => {
    officeState.poseResolver = (ch) => server.poseFor(ch.id);
    return () => {
      officeState.poseResolver = null;
    };
  }, [officeState, server]);
  officeState.reducedMotion = signals.reducedMotion;

  // Fit the office to its pane with an integer zoom (pixel-perfect), until the owner zooms by hand.
  const zoomRef = useRef(editor.zoom);
  zoomRef.current = editor.zoom;
  const refit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    server.setViewport(r.width, r.height);
    if (!autoFit) return;
    const layout = officeState.getLayout();
    const z = fitZoom(r.width, r.height, layout.cols, layout.rows);
    const dpr = window.devicePixelRatio || 1;
    editor.panRef.current = { x: 0, y: Math.round((-TOOLBAR_RESERVE_CSS / 2) * dpr) + Math.round((TILE_SIZE * z) / 4) };
    if (z !== zoomRef.current) editor.handleZoomChange(z);
  }, [autoFit, officeState, server, editor]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    refit();
    const ro = new ResizeObserver(() => refit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [refit, msgs.layoutReady]);
  // Re-fit when the layout changes size (generated wide/narrow office, import, editor grid growth).
  const layoutKey = `${officeState.getLayout().cols}x${officeState.getLayout().rows}`;
  useEffect(() => refit(), [layoutKey, refit]);

  const manualZoom = useCallback(
    (z: number) => {
      setAutoFit(false);
      editor.handleZoomChange(z);
    },
    [editor],
  );

  useEffect(() => {
    registerApi({
      importLayout: (layout) => {
        if (layout?.version !== 1 || !Array.isArray(layout.tiles) || !Array.isArray(layout.furniture)) return false;
        const migrated = migrateLayoutColors(layout);
        officeState.rebuildFromLayout(migrated);
        editor.setLastSavedLayout(migrated);
        transport.send({ type: 'saveLayout', layout: migrated as unknown as Record<string, unknown> });
        editor.markClean();
        setTick((n) => n + 1);
        return true;
      },
      zoom: () => zoomRef.current,
      pan: () => editor.panRef.current,
    });
  }, [registerApi, officeState, editor]);

  const [kbTick, setKbTick] = useState(0);
  void kbTick;
  useEditorKeyboard(
    editor.isEditMode && !isSettingsOpen && !isTrunksOpen,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setKbTick((n) => n + 1), []),
    editor.handleToggleEditMode,
  );
  useEffect(() => {
    if (!isSettingsOpen && !isTrunksOpen) return;
    const claimEscape = (event: KeyboardEvent) => {
      claimOfficeModalEscape(event, () => {
        if (isSettingsOpen) setIsSettingsOpen(false);
        else setIsTrunksOpen(false);
      });
    };
    window.addEventListener('keydown', claimEscape, true);
    return () => window.removeEventListener('keydown', claimEscape, true);
  }, [isSettingsOpen, isTrunksOpen]);

  const handleClick = useCallback(
    (agentId: number) => {
      const meta = officeState.subagentMeta.get(agentId);
      transport.send({ type: 'focusAgent', id: meta ? meta.parentAgentId : agentId });
    },
    [officeState],
  );

  const lighting = useMemo(() => makeLighting(getOfficeState, () => signals.theme), [getOfficeState, signals]);

  const handleImportFile = useCallback(
    (file: File) => {
      if (isEditDirty() && !window.confirm('Replace the current layout? Unsaved edits will be lost.')) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as OfficeLayout;
          const ok =
            parsed?.version === 1 && Array.isArray(parsed.tiles) && Array.isArray(parsed.furniture);
          if (!ok) {
            window.alert('Invalid layout file.');
            return;
          }
          server.applyLayout(migrateLayoutColors(parsed));
          editor.markClean();
        } catch {
          window.alert('Failed to read or parse layout file.');
        }
      };
      reader.readAsText(file);
    },
    [isEditDirty, server, editor],
  );

  const showRotateHint =
    editor.isEditMode &&
    (() => {
      if (editorState.selectedFurnitureUid) {
        const item = officeState.getLayout().furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
        if (item && isRotatable(item.type)) return true;
      }
      return editorState.activeTool === EditTool.FURNITURE_PLACE && isRotatable(editorState.selectedFurnitureType);
    })();

  const isEditingAreas = editor.isEditMode && editorState.activeTool === EditTool.AREA_PAINT;
  const effectiveShowAreas = isEditingAreas || msgs.showAreas;
  const areaFolders = useMemo(() => [{ name: 'Trunks', path: 'Trunks' }, { name: 'Grafted', path: 'Grafted' }], []);

  if (!msgs.layoutReady) {
    return <div className="w-full h-full flex items-center justify-center text-text-muted">Opening the office…</div>;
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden pa-app"
      data-theme={signals.theme}
      onPointerEnter={() => notePointerInside(true)}
      onPointerLeave={() => notePointerInside(false)}
    >
      <OfficeCanvas
        officeState={officeState}
        onClick={handleClick}
        isEditMode={editor.isEditMode}
        editorState={editorState}
        onEditorTileAction={editor.handleEditorTileAction}
        onEditorEraseAction={editor.handleEditorEraseAction}
        onEditorSelectionChange={editor.handleEditorSelectionChange}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        onDragMove={editor.handleDragMove}
        editorTick={editor.editorTick}
        zoom={editor.zoom}
        onZoomChange={manualZoom}
        panRef={editor.panRef}
        showAreas={effectiveShowAreas}
        activeAreaLabel={isEditingAreas ? editor.selectedAreaLabel : null}
        afterScene={lighting}
        onSeatDrop={() => setTick((n) => n + 1)}
      />

      <>
          <div className="pa-ui pa-zoom">
            {/* keyed by the fitted zoom so an automatic fit doesn't flash upstream's zoom-level badge */}
            <ZoomControls key={autoFit ? `fit${editor.zoom}` : 'manual'} zoom={editor.zoom} onZoomChange={manualZoom} />
          </div>
          {!autoFit && (
            <button
              type="button"
              className="absolute top-8 right-48 z-50 pixel-panel px-6 py-1 text-xs cursor-pointer pa-ui"
              title="Fit the office to the pane"
              onClick={() => setAutoFit(true)}
            >
              Fit
            </button>
          )}
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'var(--vignette)' }} />
          {editor.isEditMode && editor.isDirty && (
            <div className="pa-ui">
              <EditActionBar editor={editor} editorState={editorState} />
            </div>
          )}
          {showRotateHint && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-11 bg-accent-bright text-white text-sm py-3 px-8 rounded-none border-2 border-accent shadow-pixel pointer-events-none whitespace-nowrap"
              style={{ top: editor.isDirty ? 64 : 8 }}
            >
              Rotate (R)
            </div>
          )}
          {editor.isEditMode && (
            <div className="pa-ui pa-editor">
              <EditorToolbar
                activeTool={editorState.activeTool}
                selectedTileType={editorState.selectedTileType}
                selectedFurnitureType={editorState.selectedFurnitureType}
                selectedFurnitureUid={editorState.selectedFurnitureUid}
                selectedFurnitureColor={
                  editorState.selectedFurnitureUid
                    ? (officeState.getLayout().furniture.find((f) => f.uid === editorState.selectedFurnitureUid)?.color ?? null)
                    : null
                }
                floorColor={editorState.floorColor}
                wallColor={editorState.wallColor}
                selectedWallSet={editorState.selectedWallSet}
                onToolChange={editor.handleToolChange}
                onTileTypeChange={editor.handleTileTypeChange}
                onFloorColorChange={editor.handleFloorColorChange}
                onWallColorChange={editor.handleWallColorChange}
                onWallSetChange={editor.handleWallSetChange}
                onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
                pickedFurnitureColor={editorState.pickedFurnitureColor}
                onPickedFurnitureColorChange={editor.handlePickedFurnitureColorChange}
                onFurnitureTypeChange={editor.handleFurnitureTypeChange}
                loadedAssets={msgs.loadedAssets}
                activePetTypes={officeState.getActivePetTypes()}
                petCount={getPetCount()}
                onPetToggle={editor.handlePetToggle}
                carpetVariant={editor.carpetVariant}
                carpetColor={editor.carpetColor}
                carpetAccentColor={editor.carpetAccentColor}
                onCarpetVariantChange={editor.handleCarpetVariantChange}
                onCarpetColorChange={editor.handleCarpetColorChange}
                onCarpetAccentColorChange={editor.handleCarpetAccentColorChange}
                areas={officeState.getLayout().areas ?? []}
                selectedAreaLabel={editor.selectedAreaLabel}
                workspaceFolders={areaFolders}
                areasAvailable
                areaMappings={msgs.areaMappings}
                onSelectArea={editor.handleSelectArea}
                onAddArea={editor.handleAddArea}
                onRemoveArea={editor.handleRemoveArea}
                onRenameArea={editor.handleRenameArea}
                onAreaColorChange={editor.handleAreaColorChange}
                onAreaMappingChange={(folder, label, action) => {
                  const cur = msgs.areaMappings[folder] ?? [];
                  const nextLabels = action === 'add' ? [...new Set([...cur, label])] : cur.filter((l) => l !== label);
                  const next = { ...msgs.areaMappings, [folder]: nextLabels };
                  msgs.setAreaMappings(next);
                  officeState.setAreaMappings(next);
                  transport.send({ type: 'saveAreaMappings', mappings: next });
                }}
              />
            </div>
          )}
          <BranchOverlay
            officeState={officeState}
            server={server}
            subagentCharacters={msgs.subagentCharacters}
            containerRef={containerRef}
            zoom={editor.zoom}
            panRef={editor.panRef}
            showNames={alwaysShowOverlay}
            hidden={editor.isEditMode}
            onOpen={onOpen}
          />
      </>

      <BranchToolbar
        isEditMode={editor.isEditMode}
        onToggleEditMode={editor.handleToggleEditMode}
        onOpenTrunks={() => setIsTrunksOpen((v) => !v)}
        isTrunksOpen={isTrunksOpen}
        isSettingsOpen={isSettingsOpen}
        onToggleSettings={() => setIsSettingsOpen((v) => !v)}
        onNewAgent={onNewAgent}
      />
      <BranchSettings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        alwaysShowOverlay={alwaysShowOverlay}
        onToggleAlwaysShowOverlay={() => {
          const v = !alwaysShowOverlay;
          setAlwaysShowOverlay(v);
          transport.send({ type: 'setAlwaysShowLabels', enabled: v });
        }}
        ghostOffline={msgs.ghostHeadlessAgents}
        onToggleGhostOffline={() => {
          const v = !msgs.ghostHeadlessAgents;
          msgs.setGhostHeadlessAgents(v);
          transport.send({ type: 'setGhostHeadlessAgents', enabled: v });
        }}
        showAreas={msgs.showAreas}
        onToggleShowAreas={() => {
          const v = !msgs.showAreas;
          msgs.setShowAreas(v);
          transport.send({ type: 'setShowAreas', enabled: v });
        }}
        onExportLayout={() => exportLayoutToFile(officeState.getLayout())}
        onImportLayout={handleImportFile}
        onResetLayout={() => server.applyLayout(null)}
        customLayout={server.isCustomLayout()}
      />
      <CharactersPanel
        isOpen={isTrunksOpen}
        onClose={() => setIsTrunksOpen(false)}
        server={server}
        officeState={officeState}
        agents={signals.agents}
        onChanged={() => setTick((n) => n + 1)}
      />
    </div>
  );
}
