/**
 * BRANCH PORT: upstream's editor shortcuts listen on `window`. Inside the Branch app that would turn
 * R, T, Delete and Ctrl+Z typed into a chat box into office edits, so a key only reaches the office
 * when it does not come from a text field and the pointer or focus is on the office.
 */
let officeRoot: HTMLElement | null = null;
let pointerInside = false;

export function setOfficeKeyRoot(el: HTMLElement | null): void {
  officeRoot = el;
  pointerInside = false;
}

export function notePointerInside(inside: boolean): void {
  pointerInside = inside;
}

function isTextTarget(t: EventTarget | undefined): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export function isKeyForOffice(e: KeyboardEvent): boolean {
  const path = e.composedPath();
  if (isTextTarget(path[0]) && (e.key !== 'Escape' || !officeRoot || !path.includes(officeRoot))) return false;
  if (!officeRoot) return true;
  return pointerInside || path.includes(officeRoot);
}

export function claimOfficeModalEscape(event: KeyboardEvent, onClose: () => void): boolean {
  if (event.key !== 'Escape' || !isKeyForOffice(event)) return false;
  event.preventDefault();
  onClose();
  return true;
}
