/** Maps a tour screen id to the v23 preview state that shows the same place. */
export function previewState(id) {
  if (id.startsWith('settings-') || id === 'add-claude-account') {
    return { kind: 'settings', page: id === 'settings-updates' ? 'updates' : id === 'settings-general' ? 'general' : 'accounts' };
  }
  if (id === 'pixel-office' || id === 'drag-to-group') return { kind: 'grove' };
  if (id === 'canopy-now') return { kind: 'place', view: 'canopy', tabs: { canopy: 'now' } };
  if (id === 'inbox') return { kind: 'place', view: 'inbox', tabs: { inbox: 'needs' } };
  if (id === 'customize-tools-skills') return { kind: 'place', view: 'customize', tabs: { customize: 'tools' }, tools9: { k: 'skills' } };
  if (id === 'people') return { kind: 'place', view: 'team' };
  if (id === 'automations-board') return { kind: 'place', view: 'automations', tabs: { automations: 'board' } };
  if (id === 'computer-stage') return { kind: 'stage', view: 'chat', chat: 'scout', stage: 'computer' };
  if (id === 'browser-stage') return { kind: 'stage', view: 'chat', chat: 'scout', stage: 'browser' };
  if (id === 'pane-memory') return { kind: 'place', view: 'chat', chat: 'scout', pane: 'memory' };
  if (id === 'row-menu') return { kind: 'row-menu', view: 'chat', chat: 'scout' };
  return { kind: 'chat', view: 'chat', chat: id === 'group-chat' ? 'room' : 'scout' };
}
