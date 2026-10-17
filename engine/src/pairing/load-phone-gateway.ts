// Loads the phone's PhoneGateway for the pairing-relay hop test without
// asking Vite to transform mobile/src (that walk hits mobile/tsconfig.json,
// which extends expo/tsconfig.base — not installed on engine CI).
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const engineRoot = path.resolve(here, "../..");
const repoRoot = path.resolve(engineRoot, "..");
const phoneGatewayEntry = path.join(repoRoot, "mobile", "src", "connect", "phoneGateway.ts");
const relayFramesShim = path.join(here, "phone-relay-frames.ts");
const engineTsconfig = path.join(here, "phone-gateway.tsconfig.json");

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
      pluginBuild.onResolve({ filter: /^\.\.\/pairing\/relayFrames$/ }, () => ({
        path: relayFramesShim,
      }));
      pluginBuild.onResolve({ filter: /(?:^|[\\/])pairing[\\/]relayFrames(?:\.ts)?$/ }, () => ({
        path: relayFramesShim,
      }));
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
  const dir = await mkdtemp(path.join(tmpdir(), "phone-gateway-"));
  const outfile = path.join(dir, "phoneGateway.mjs");
  await writeFile(outfile, code);
  const loaded = (await import(pathToFileURL(outfile).href)) as { PhoneGateway: PhoneGatewayCtor };
  return loaded.PhoneGateway;
}
