// Which controls belong to the open screen, and which are shared chrome.
// Chrome is clicked once. It does not spend the budget of Overview, Appearance, or any other screen.

export function chooseScreenClicks(elements, { limit = 36, skip = () => false } = {}) {
  const chosen = [];
  for (const el of elements) {
    if (el.region !== 'screen' && el.region !== 'overlay') continue;
    if (skip(el)) continue;
    chosen.push(el);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

export function chooseRegion(elements, region, { limit = 40, skip = () => false } = {}) {
  const chosen = [];
  for (const el of elements) {
    if (el.region !== region) continue;
    if (skip(el)) continue;
    chosen.push(el);
    if (chosen.length >= limit) break;
  }
  return chosen;
}
