// Branch Agent root resolution imports fs through this facade so tests can replace
// filesystem behavior without mocking node:fs globally.
export { default as branchRootFsSync } from "node:fs"; // Sanctioned domain alias.
export { default as branchRootFs } from "node:fs/promises"; // Sanctioned domain alias.
