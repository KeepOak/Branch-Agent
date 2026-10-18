// Loads the phone's PhoneGateway for the pairing-relay hop test without
// asking Vite to transform mobile/src (that walk hits mobile/tsconfig.json,
// which extends expo/tsconfig.base — not installed on engine CI).
// Bundles the real mobile/src/pairing/relayFrames.ts. @noble/ciphers comes
// from Reef, which the engine job already installs. expo-crypto is the only
// alias, and only if something in that graph imports it.
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const engineRoot = path.resolve(here, "../..");
const repoRoot = path.resolve(engineRoot, "..");
const phoneGatewayEntry = path.join(repoRoot, "mobile", "src", "connect", "phoneGateway.ts");
const engineTsconfig = path.join(here, "phone-gateway.tsconfig.json");
const expoCryptoShim = path.join(here, "expo-crypto-shim.ts");
const reefPackageJson = path.join(engineRoot, "extensions", "reef", "package.json");
const reefNobleAes = path.join(
  engineRoot,
  "extensions",
  "reef",
  "node_modules",
  "@noble",
  "ciphers",
  "aes.js",
);

export function nobleCiphersUnavailableReason(): string | undefined {
  return resolveNobleCiphersAes()
    ? undefined
    : "@noble/ciphers is not installed in this engine job (Reef dependency)";
}

function resolveNobleCiphersAes(): string | undefined {
  if (existsSync(reefPackageJson)) {
    try {
      return createRequire(reefPackageJson).resolve("@noble/ciphers/aes.js");
    } catch {
      // Fall through to the Reef node_modules path.
    }
  }
  return existsSync(reefNobleAes) ? reefNobleAes : undefined;
}

function resolveNobleImport(spec: string): string | undefined {
  const aes = resolveNobleCiphersAes();
  if (!aes) {
    return undefined;
  }
  const root = path.dirname(aes);
  if (spec === "@noble/ciphers/aes.js" || spec === "@noble/ciphers/aes") {
    return aes;
  }
  const sub = spec === "@noble/ciphers" ? "index.js" : spec.slice("@noble/ciphers/".length);
  const file = path.join(root, sub.endsWith(".js") ? sub : `${sub}.js`);
  return existsSync(file) ? file : undefined;
}

function resolveBranchPackage(spec: string): string | undefined {
  const match = /^@branch\/([^/]+)(?:\/(.+))?$/u.exec(spec);
  if (!match) {
    return undefined;
  }
  const pkgRoot = path.join(engineRoot, "packages", match[1], "src");
  const sub = match[2];
  const candidates = sub
    ? [path.join(pkgRoot, `${sub}.ts`), path.join(pkgRoot, sub, "index.ts")]
    : [path.join(pkgRoot, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate));
}

function resolvePackageJsTwin(importer: string, request: string): string | undefined {
  if (!request.startsWith(".") || !request.endsWith(".js")) {
    return undefined;
  }
  if (!importer.includes(`${path.sep}packages${path.sep}`)) {
    return undefined;
  }
  const withoutJs = path.resolve(path.dirname(importer), request.slice(0, -3));
  const candidates = [`${withoutJs}.ts`, path.join(withoutJs, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate));
}

function phoneGatewayPlugin(): Plugin {
  return {
    name: "phone-gateway-engine-shim",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^expo-crypto$/ }, () => ({ path: expoCryptoShim }));
      pluginBuild.onResolve({ filter: /^@noble\/ciphers/ }, (args) => {
        const resolved = resolveNobleImport(args.path);
        return resolved ? { path: resolved } : undefined;
      });
      pluginBuild.onResolve({ filter: /^@branch\// }, (args) => {
        const resolved = resolveBranchPackage(args.path);
        return resolved ? { path: resolved } : undefined;
      });
      pluginBuild.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
        const resolved = resolvePackageJsTwin(args.importer, args.path);
        return resolved ? { path: resolved } : undefined;
      });
    },
  };
}

export type PhoneGatewayCtor = new (opts: {
  url: string;
  platform: "ios";
  appVersion: string;
  bootstrapToken?: string;
  relayKey?: string;
  randomBytes?: (count: number) => Uint8Array;
  loadIdentity: () => Promise<{
    deviceId: string;
    publicKey: string;
    sign: (payload: string) => Promise<string>;
  }>;
  tokenStore: { load: () => null; store: () => undefined; clear: () => undefined };
  createRequestId: () => string;
  createSocket: (
    url: string,
    handlers: {
      open: () => void;
      message: (data: unknown) => void;
      close: (code: number, reason: string) => void;
      error: (error: Error) => void;
    },
  ) => {
    isOpen: () => boolean;
    send: (data: string | Uint8Array) => void;
    close: (code?: number, reason?: string) => void;
  };
  onStatus: (status: unknown) => void;
}) => { start: () => void; stop: () => void };

export async function loadPhoneGateway(): Promise<PhoneGatewayCtor> {
  const missing = nobleCiphersUnavailableReason();
  if (missing) {
    throw new Error(missing);
  }
  const bundled = await build({
    absWorkingDir: engineRoot,
    bundle: true,
    entryPoints: [phoneGatewayEntry],
    format: "esm",
    logLevel: "silent",
    platform: "node",
    plugins: [phoneGatewayPlugin()],
    tsconfig: engineTsconfig,
    write: false,
  });
  const code = bundled.outputFiles[0]?.text;
  if (!code) {
    throw new Error("PhoneGateway bundle was empty.");
  }
  if (!code.includes("setPairingRandomBytes") || !code.includes("decodeURIComponent")) {
    throw new Error("PhoneGateway bundle did not include the mobile relayFrames seal.");
  }
  const dir = await mkdtemp(path.join(tmpdir(), "phone-gateway-"));
  const outfile = path.join(dir, "phoneGateway.mjs");
  await writeFile(outfile, code);
  const loaded = (await import(pathToFileURL(outfile).href)) as { PhoneGateway: PhoneGatewayCtor };
  return loaded.PhoneGateway;
}
