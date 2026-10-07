// Dedicated entry for Graft's fast start (see graft-fast.ts). branch.mjs imports it before the full CLI entry and
// falls through to the full CLI when runGraftFast resolves false.
export { runGraftFast } from "./graft-fast.js";
