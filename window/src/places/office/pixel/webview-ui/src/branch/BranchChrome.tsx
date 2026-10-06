/**
 * The office's toolbar and settings — upstream components/BottomToolbar.tsx and SettingsModal.tsx
 * with Branch's entries. Upstream's VS Code / CLI-only entries (Open Sessions Folder, Watch All
 * Sessions, Instant Detection hooks, external asset directories) have no Branch counterpart.
 */
import { useRef, useState } from 'react';

import { Button } from '../components/ui/Button.js';
import { Checkbox } from '../components/ui/Checkbox.js';
import { MenuItem } from '../components/ui/MenuItem.js';
import { Modal } from '../components/ui/Modal.js';
import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import { transport } from '../transport/index.js';

export function BranchToolbar(p: {
  isEditMode: boolean;
  onToggleEditMode: () => void;
  onOpenTrunks: () => void;
  isTrunksOpen: boolean;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  onNewAgent?: () => void;
}) {
  return (
    <div className="absolute bottom-10 left-10 z-20 flex items-center gap-4 pixel-panel p-4 pa-ui" data-testid="office-toolbar">
      {p.onNewAgent && (
        <Button variant="accent" size="md" onClick={p.onNewAgent} title="Make a new Trunk">
          + Trunk
        </Button>
      )}
      <Button size="md" variant={p.isEditMode ? 'active' : 'default'} onClick={p.onToggleEditMode} title="Edit office layout">
        Layout
      </Button>
      <Button size="md" variant={p.isTrunksOpen ? 'active' : 'default'} onClick={p.onOpenTrunks} title="Looks and desks">
        Trunks
      </Button>
      <Button size="md" variant={p.isSettingsOpen ? 'active' : 'default'} onClick={p.onToggleSettings} title="Settings">
        Settings
      </Button>
    </div>
  );
}

export function BranchSettings(p: {
  isOpen: boolean;
  onClose: () => void;
  alwaysShowOverlay: boolean;
  onToggleAlwaysShowOverlay: () => void;
  ghostOffline: boolean;
  onToggleGhostOffline: () => void;
  showAreas: boolean;
  onToggleShowAreas: () => void;
  onExportLayout: () => void;
  onImportLayout: (file: File) => void;
  onResetLayout: () => void;
  customLayout: boolean;
}) {
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Modal isOpen={p.isOpen} onClose={p.onClose} title="Settings" className="pa-panel">
      <MenuItem
        onClick={() => {
          p.onExportLayout();
          p.onClose();
        }}
      >
        Export Layout
      </MenuItem>
      <MenuItem onClick={() => fileRef.current?.click()}>Import Layout</MenuItem>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) {
            p.onImportLayout(file);
            p.onClose();
          }
        }}
      />
      {p.customLayout && (
        <MenuItem
          onClick={() => {
            p.onResetLayout();
            p.onClose();
          }}
        >
          Reset to the Branch office
        </MenuItem>
      )}
      <Checkbox
        label="Sound Notifications"
        checked={soundLocal}
        onChange={() => {
          const v = !isSoundEnabled();
          setSoundEnabled(v);
          setSoundLocal(v);
          transport.send({ type: 'setSoundEnabled', enabled: v });
        }}
      />
      <Checkbox label="Always Show Names" checked={p.alwaysShowOverlay} onChange={p.onToggleAlwaysShowOverlay} />
      <Checkbox label="Offline Trunks as Ghosts" checked={p.ghostOffline} onChange={p.onToggleGhostOffline} />
      <Checkbox label="Show Areas" checked={p.showAreas} onChange={p.onToggleShowAreas} />
    </Modal>
  );
}
