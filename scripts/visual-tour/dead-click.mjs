const RESPONSE_TIMEOUT_MS = 5000;

/** Finite entrance animations on the control and its ancestors (the menu's pop-in). An infinite loop, such as a pulse, is not waited on. */
export function pendingEntranceAnimations(el) {
  const pending = [];
  for (let node = el; node; node = node.parentElement) {
    const list = typeof node.getAnimations === 'function' ? node.getAnimations() : [];
    for (const animation of list) {
      const iterations = animation.effect?.getTiming?.().iterations;
      if (iterations === Infinity) continue;
      if (animation.finished) pending.push(animation.finished);
    }
  }
  return Promise.all(pending);
}

function pointerOptions(step, timeout) {
  const button = step.action === 'contextmenu' ? 'right' : undefined;
  if (!button && !timeout) return undefined;
  return { ...(button ? { button } : {}), ...(timeout ? { timeout } : {}) };
}

async function settle(control) {
  const node = control.first();
  if (typeof node.evaluate !== 'function') return;
  let timer;
  const cap = new Promise((resolve) => { timer = setTimeout(resolve, 1000); });
  try {
    await Promise.race([node.evaluate(pendingEntranceAnimations), cap]);
  } finally {
    clearTimeout(timer);
  }
}

async function shown(response) {
  try {
    await response.first().waitFor({ state: 'visible', timeout: RESPONSE_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

export async function checkedStep(page, step, locate) {
  const control = locate(page, step.by, step.target);
  try { await control.first().waitFor({ state: 'visible', timeout: 10000 }); }
  catch { throw new Error(`Missing control: ${step.target}`); }
  if (step.action === 'assert') return;
  if (!(await control.first().isEnabled())) throw new Error(`Disabled control: ${step.target}`);
  const response = step.expectBy === 'movement' ? null : locate(page, step.expectBy, step.expect);
  if (step.action === 'drag' && response && (await response.count()) && (await response.first().isVisible())) throw new Error(`Drag response was already visible: ${step.expect}`);
  const before = step.expectBy === 'movement' ? await control.first().boundingBox() : null;
  const activate = async (timeout) => {
    await settle(control).catch(() => {});
    if (step.action === 'drag') {
      const destination = locate(page, step.toBy, step.to);
      if (!(await destination.count()) || !(await destination.first().isVisible())) throw new Error(`Missing drop target: ${step.to}`);
      await control.first().dragTo(destination.first());
      return;
    }
    await control.first().click(pointerOptions(step, timeout));
  };
  await activate();
  if (step.expectBy === 'movement') {
    const after = await control.first().boundingBox();
    if (!before || !after || Math.hypot(after.x - before.x, after.y - before.y) < 12) throw new Error(`Dead drag: ${step.target} did not move`);
    return;
  }
  if (await shown(response)) return;
  // A click during the menu pop-in can land without running the row. One more try, then it is still dead.
  if (step.action === 'drag') throw new Error(`Dead drag: ${step.target} did not show ${step.expect}`);
  let retryAttempted = false;
  try {
    await settle(control);
    retryAttempted = true;
    await control.first().click(pointerOptions(step, RESPONSE_TIMEOUT_MS));
  } catch {
    // The row can detach after a miss. The response check still decides.
  }
  if (await shown(response)) return;
  const retryNote = retryAttempted ? 'retry attempted' : 'retry not attempted';
  throw new Error(`Dead ${step.action}: ${step.target} did not show ${step.expect} (${retryNote})`);
}
