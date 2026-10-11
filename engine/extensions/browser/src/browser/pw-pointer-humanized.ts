/** Native portable input driver adapted from elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf. */
import { sleepWithAbort } from "branch/plugin-sdk/runtime-env";
import type { ElementHandle, JSHandle, Page } from "playwright-core";
import {
  BROWSER_ACTION_NAVIGATION_GRACE_MS,
  resolveActInteractionTimeoutMs,
} from "./act-policy.js";
import { MocapEngine } from "./pw-pointer-mocap.js";
import type { MocapSequence } from "./pw-pointer-mocap.types.js";
import { refLocator } from "./pw-session.js";
import {
  assertInteractionCurrent,
  type ElementInteractionOptions,
  getRestoredPageForTarget,
  runCancellablePageInteraction,
  throwIfInteractionAborted,
} from "./pw-tools-core.interactions.navigation.js";
import { requireRefOrSelector } from "./pw-tools-core.shared.js";

type Box = { x: number; y: number; width: number; height: number };
type InputGuard = ElementInteractionOptions & { signal: AbortSignal; deadline: number };
const pageEngines = new WeakMap<Page, MocapEngine>();

function engineForPage(page: Page): MocapEngine {
  let engine = pageEngines.get(page);
  if (!engine) {
    engine = new MocapEngine();
    pageEngines.set(page, engine);
  }
  return engine;
}

async function fence(guard: InputGuard): Promise<void> {
  throwIfInteractionAborted(guard.signal);
  await assertInteractionCurrent(guard);
  throwIfInteractionAborted(guard.signal);
}

function fenced<T>(guard: InputGuard, effect: () => Promise<T>): Promise<T> {
  throwIfInteractionAborted(guard.signal);
  const assertion = assertInteractionCurrent(guard);
  if (assertion) {
    return assertion.then(() => {
      throwIfInteractionAborted(guard.signal);
      return effect();
    });
  }
  throwIfInteractionAborted(guard.signal);
  return effect();
}

function remainingMs(guard: InputGuard): number {
  throwIfInteractionAborted(guard.signal);
  const remaining = guard.deadline - Date.now();
  if (remaining <= 0) {
    throw new Error("humanClick timed out");
  }
  return remaining;
}

async function move(page: Page, x: number, y: number, guard: InputGuard) {
  await fence(guard);
  await fenced(guard, () => page.mouse.move(x, y));
  await fence(guard);
}

async function adjustToCenter(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  guard: InputGuard,
) {
  // The pinned driver's final six mouse.move steps, individually interruptible.
  for (let step = 1; step <= 6; step++) {
    await move(
      page,
      start.x + ((end.x - start.x) * step) / 6,
      start.y + ((end.y - start.y) * step) / 6,
      guard,
    );
  }
}

async function replay(page: Page, sequence: MocapSequence, guard: InputGuard) {
  let x = 4;
  let y = 4;
  for (const movement of sequence.movements) {
    await fence(guard);
    if (movement.dt > 0) {
      await sleepWithAbort(Math.min(movement.dt * 1000, 40), guard.signal);
    }
    x += movement.dx;
    y += movement.dy;
    await move(page, x, y, guard);
  }
}

async function moveHumanly(page: Page, box: Box, guard: InputGuard) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const rect = { left: x - 2, top: y - 2, right: x + 2, bottom: y + 2 };
  const engine = engineForPage(page);
  const sequence =
    engine.findSequenceLandingInRect(4, 4, rect) ??
    engine.findSequenceWithStretchAndRotation(4, 4, rect);
  await move(page, 4, 4, guard);
  if (sequence) {
    await replay(page, sequence, guard);
  }
  // Preserve the pinned driver's exact-center adjustment and no-match fallback.
  const start = { x: 4 + (sequence?.total_dx ?? 0), y: 4 + (sequence?.total_dy ?? 0) };
  await adjustToCenter(page, start, { x, y }, guard);
}

async function assertTargetUnmoved(handle: ElementHandle<Element>, box: Box, guard: InputGuard) {
  await fence(guard);
  const current = await fenced(guard, () => handle.boundingBox());
  if (
    !current ||
    current.x !== box.x ||
    current.y !== box.y ||
    current.width !== box.width ||
    current.height !== box.height
  ) {
    throw new Error("humanClick target moved or detached during pointer motion; re-snapshot");
  }
  await fence(guard);
}

type TrustedClickJoin = { promise: Promise<void>; dispose: () => void };

function isHumanClickJoinContextDestroyed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Cannot find context with specified id|Frame (?:was |is )?detached|detached Frame|Node is detached from document/i.test(
    message,
  );
}

async function armTrustedClickJoin(
  handle: ElementHandle<Element>,
): Promise<JSHandle<TrustedClickJoin>> {
  // Held only by this JSHandle: capture on the owner window/document so a
  // stopped or retargeted click is still observed, without a page global.
  return handle.evaluateHandle((el) => {
    const root = el.ownerDocument.defaultView ?? el.ownerDocument;
    let settled = false;
    let resolve = () => {};
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    const promise = new Promise<void>((next) => {
      resolve = next;
    });
    const onClick = () => {
      // Resolve after the current click finishes so same-event navigations run.
      queueMicrotask(finish);
    };
    root.addEventListener("click", onClick, { capture: true, once: true });
    return {
      promise,
      dispose: () => {
        root.removeEventListener("click", onClick, { capture: true });
        finish();
      },
    };
  });
}

async function releaseTrustedClickJoin(gate: JSHandle<TrustedClickJoin>): Promise<void> {
  await gate.evaluate((joined) => joined.dispose()).catch(() => {});
  await gate.dispose().catch(() => {});
}

async function waitTrustedClickJoin(
  gate: JSHandle<TrustedClickJoin>,
  signal: AbortSignal,
): Promise<void> {
  try {
    await Promise.race([
      gate.evaluate((joined) => joined.promise).catch((error: unknown) => {
        if (!isHumanClickJoinContextDestroyed(error)) {
          throw error;
        }
      }),
      sleepWithAbort(BROWSER_ACTION_NAVIGATION_GRACE_MS, signal),
    ]);
  } catch (error) {
    if (!isHumanClickJoinContextDestroyed(error)) {
      throw error;
    }
  } finally {
    await releaseTrustedClickJoin(gate);
  }
}

async function clickAtTarget(
  page: Page,
  handle: ElementHandle<Element>,
  box: Box,
  guard: InputGuard,
) {
  await assertTargetUnmoved(handle, box, guard);
  // Native actionability checks also cover an iframe obscured in its parent.
  // Trial occurs only after arrival, so it cannot teleport ahead of the trajectory.
  await fenced(guard, () => handle.click({ trial: true, timeout: remainingMs(guard) }));
  await assertTargetUnmoved(handle, box, guard);
  await sleepWithAbort(60 + Math.random() * 50, guard.signal);
  await assertTargetUnmoved(handle, box, guard);
  // CDP mouse.up resolves when the event is dispatched, not when page click
  // listeners run. Join a short capture-phase click when it arrives so a
  // click-triggered navigation is admitted to the request guard. A missing
  // click falls back to the existing post-action grace; do not fail the click.
  const clickJoin = await fenced(guard, () => armTrustedClickJoin(handle));
  let buttonHeld = false;
  let joined = false;
  try {
    await fence(guard);
    await fenced(guard, () => {
      buttonHeld = true;
      return page.mouse.down();
    });
    await sleepWithAbort(50 + Math.random() * 50, guard.signal);
    await fence(guard);
    await fenced(guard, () => page.mouse.up());
    buttonHeld = false;
    await fenced(guard, () => waitTrustedClickJoin(clickJoin, guard.signal));
    joined = true;
  } finally {
    // Join release under the same navigation guard, even after cancellation.
    if (buttonHeld) {
      await page.mouse.up().catch(() => {});
    }
    if (!joined) {
      await releaseTrustedClickJoin(clickJoin).catch(() => {});
    }
  }
}

async function performHumanClick(page: Page, handle: ElementHandle<Element>, guard: InputGuard) {
  try {
    await fence(guard);
    await fenced(guard, () => handle.scrollIntoViewIfNeeded({ timeout: remainingMs(guard) }));
    const box = await fenced(guard, () => handle.boundingBox());
    if (!box || box.width <= 0 || box.height <= 0) {
      await fence(guard);
      await fenced(guard, () => handle.click({ timeout: remainingMs(guard) }));
      await fence(guard);
      return;
    }
    await moveHumanly(page, box, guard);
    await clickAtTarget(page, handle, box, guard);
    await fence(guard);
  } finally {
    await handle.dispose();
  }
}

export async function humanClickViaPlaywright(opts: ElementInteractionOptions): Promise<void> {
  const resolved = requireRefOrSelector(opts.ref, opts.selector);
  const page = await getRestoredPageForTarget(opts);
  const locator = resolved.ref ? refLocator(page, resolved.ref) : page.locator(resolved.selector!);
  const timeout = resolveActInteractionTimeoutMs(opts.timeoutMs);
  await runCancellablePageInteraction(
    page,
    opts,
    async (signal) => {
      const guard = {
        ...opts,
        deadline: Date.now() + timeout,
        signal: AbortSignal.any([signal, opts.signal ?? signal, AbortSignal.timeout(timeout)]),
      };
      await fence(guard);
      const handle = await fenced(guard, () =>
        locator.elementHandle({ timeout: remainingMs(guard) }),
      );
      if (!handle) {
        throw new Error("humanClick target not found");
      }
      await performHumanClick(page, handle, guard);
    },
    resolved.ref ?? resolved.selector!,
  );
}
