import { createHash } from "node:crypto";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ComponentAsset } from "./component-update-manifest";
import { trustedDownloadResponse } from "./component-update-manifest";

export async function replaceFile(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await move(temporary, file);
}

export async function move(source: string, target: string): Promise<void> {
  for (let attempt = 0;; attempt++) {
    try { await rename(source, target); return; } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || !["EPERM", "EBUSY", "EACCES"].includes(code ?? "") || attempt === 9) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

/** Stream to disk under the manifest's exact byte count, then verify before any extraction/publication. */
export async function downloadComponent(asset: ComponentAsset, file: string, request: typeof fetch): Promise<void> {
  const response = await request(asset.url, { signal: AbortSignal.timeout(300_000) });
  trustedDownloadResponse(response);
  const handle = await open(file, "wx", 0o600);
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of response.body!) {
      bytes += chunk.length;
      if (bytes > asset.bytes) throw new Error("Downloaded component size mismatch");
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    await handle.sync();
  } finally { await handle.close(); }
  if (bytes !== asset.bytes || hash.digest("hex") !== asset.sha256) throw new Error("Component SHA256/size mismatch");
}
