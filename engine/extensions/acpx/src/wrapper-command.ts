/**
 * npm-cli.js lookup for the generated ACP adapter wrappers.
 *
 * When the captured adapter is gone, the wrapper runs it through npm-cli.js with
 * the current node binary. npm lives under ../lib on macOS and Linux but beside
 * node.exe on Windows. Looking only under ../lib made Windows fall through to
 * spawn("npx.cmd"), which Node rejects without a shell since CVE-2024-27980
 * (spawn EINVAL). The wrapper is a standalone script that cannot import engine
 * modules, so this ships as plain JavaScript source inlined into each wrapper;
 * tests evaluate the same source with an injected platform.
 */
export const WRAPPER_NPM_CLI_SOURCE = `
function resolveNpmCliPath(execPath, platform, fileExists) {
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const nodeDir = platformPath.dirname(execPath);
  const candidate =
    platform === "win32"
      ? platformPath.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js")
      : platformPath.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  return fileExists(candidate) ? candidate : undefined;
}
`;
