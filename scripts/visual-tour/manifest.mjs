import { readFile } from 'node:fs/promises';

const kinds = new Set(['testid', 'css', 'text', 'role']);

export function loadScreens(raw) {
  const screens = JSON.parse(raw);
  if (!Array.isArray(screens) || screens.length === 0) throw new Error('screens.json needs screens');
  const ids = new Set();
  for (const screen of screens) {
    if (!screen || typeof screen.id !== 'string' || !/^[a-z0-9-]+$/.test(screen.id) || ids.has(screen.id)) throw new Error(`Invalid or duplicate screen id: ${screen?.id}`);
    ids.add(screen.id);
    if (!Array.isArray(screen.steps) || !screen.steps.length) throw new Error(`${screen.id}: no interaction steps`);
    for (const step of screen.steps) {
      if (!['click', 'contextmenu', 'drag', 'assert'].includes(step.action) || !kinds.has(step.by) || typeof step.target !== 'string' || !step.target) throw new Error(`${screen.id}: invalid step`);
      if (step.action === 'drag' && (!kinds.has(step.toBy) || !step.to)) throw new Error(`${screen.id}: drag needs destination`);
      if (step.action !== 'assert' && (!(kinds.has(step.expectBy) || (step.action === 'drag' && step.expectBy === 'movement')) || !step.expect)) throw new Error(`${screen.id}: click needs a response assertion`);
    }
  }
  return screens;
}

export async function readScreens(path) { return loadScreens(await readFile(path, 'utf8')); }
