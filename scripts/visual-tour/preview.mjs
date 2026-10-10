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

/** Turns a previewState() result into the patch window.__preview.setScreen accepts. */
export function previewScreenPatch(state) {
  if (state?.kind === 'grove') return { view: 'groveT5' };
  if (state?.kind === 'settings') return { view: 'settings', setPage: state.page };
  const patch = {};
  if (state?.view) patch.view = state.view;
  if (state?.chat) patch.chat = state.chat;
  if (state?.tabs) patch.tabs = state.tabs;
  if (state?.tools9) patch.tools9 = state.tools9;
  if (state?.stage) patch.stage = state.stage;
  if (state && 'pane' in state) patch.pane = state.pane;
  if (!patch.view) throw new Error('unknown step');
  return patch;
}

export function previewDriveFailure(id, error) {
  const raw = String(error?.message ?? error);
  let detail = raw.split('\n')[0] ?? raw;
  detail = detail.replace(/^page\.evaluate:\s*/i, '').replace(/^(?:Error|ReferenceError|TypeError):\s*/, '');
  if (detail.startsWith(`Cannot drive preview for ${id}:`)) return detail;
  return `Cannot drive preview for ${id}: ${detail || raw}`;
}

/** Drive spec-v23 through window.__preview. Never touches IIFE locals like S. */
export async function drivePreview(page, id) {
  try {
    const patch = previewScreenPatch(previewState(id));
    await page.evaluate((next) => {
      const hook = window.__preview;
      if (!hook || typeof hook.setScreen !== 'function') {
        throw new Error('preview hook is missing');
      }
      hook.setScreen(next);
    }, patch);
  } catch (error) {
    throw new Error(previewDriveFailure(id, error));
  }
}
