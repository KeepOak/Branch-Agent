export async function checkedStep(page, step, locate) {
  const control = locate(page, step.by, step.target);
  try { await control.first().waitFor({ state: 'visible', timeout: 10000 }); }
  catch { throw new Error(`Missing control: ${step.target}`); }
  if (step.action === 'assert') return;
  if (!(await control.first().isEnabled())) throw new Error(`Disabled control: ${step.target}`);
  const response = step.expectBy === 'movement' ? null : locate(page, step.expectBy, step.expect);
  if (step.action === 'drag' && response && (await response.count()) && (await response.first().isVisible())) throw new Error(`Drag response was already visible: ${step.expect}`);
  const before = step.expectBy === 'movement' ? await control.first().boundingBox() : null;
  if (step.action === 'drag') {
    const destination = locate(page, step.toBy, step.to);
    if (!(await destination.count()) || !(await destination.first().isVisible())) throw new Error(`Missing drop target: ${step.to}`);
    await control.first().dragTo(destination.first());
  } else await control.first().click();
  if (step.expectBy === 'movement') {
    const after = await control.first().boundingBox();
    if (!before || !after || Math.hypot(after.x - before.x, after.y - before.y) < 12) throw new Error(`Dead drag: ${step.target} did not move`);
    return;
  }
  try { await response.first().waitFor({ state: 'visible', timeout: 5000 }); }
  catch { throw new Error(`Dead ${step.action}: ${step.target} did not show ${step.expect}`); }
}
