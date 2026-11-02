// Whether a computer or a paired device is connected now. A computer has one live link, its node entry, so when the
// engine lists that node the node decides, and the paired record only answers for devices with no node. Every surface
// that shows a computer's state (Everywhere tiles, the Devices list and its details) reads this one rule.

/** The node entry's flag wins when there is one; otherwise the paired device's flag. */
export function connectedNow(device: { connected?: unknown } | undefined, node: { connected?: unknown } | undefined): boolean {
  return node ? node.connected === true : device?.connected === true;
}
