import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import type { Attachment } from "./model";

export const isManagedAttachment = (item: Attachment): boolean => /^artifact_managed_(?:image|media)_/.test(item.artifactId ?? "");

/** Same artifacts.download flow as engine/ui/src/api/artifact-download.ts. The RPC authorizes one artifact;
 * its short-lived ticket, never the gateway credential, is what the media element receives. */
export async function resolveAttachmentSource(engine: WindowEngine, item: Attachment): Promise<string> {
  if (!engine.sessionKey || !engine.gatewayUrl) throw new Error("Attachment unavailable");
  const result = await engine.request<{
    url?: string; encoding?: string; data?: string; artifact?: { type?: string; mimeType?: string };
  }>("artifacts.download", {
    sessionKey: engine.sessionKey,
    ...(engine.agentId ? { agentId: engine.agentId } : {}),
    artifactId: item.artifactId,
  });
  const mime = result.artifact?.mimeType ?? "";
  if (result.encoding === "base64" && result.artifact?.type === "image" && /^image\/(?:png|jpeg|gif|webp|avif)$/.test(mime) && result.data) {
    return `data:${mime};base64,${result.data}`;
  }
  if (!result.url?.trim()) throw new Error("Attachment unavailable");
  const gateway = new URL(engine.gatewayUrl);
  gateway.protocol = gateway.protocol === "wss:" ? "https:" : "http:";
  const url = new URL(result.url.trim(), gateway.origin);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Attachment unavailable");
  return url.href;
}

type Source = { src: string } | { error: true };
type Control = { retry: () => void; failed: () => void; loaded: () => void };

/** Resolve managed media before mounting it. Keep the gallery together; a failed/expired ticket refreshes only
 * that attachment, just like MdImage. A connection change invalidates both tickets and outstanding RPCs. */
export function useAttachmentSources(items: Attachment[], engine?: WindowEngine) {
  const signature = JSON.stringify(items.filter(isManagedAttachment).map((item) => [item.artifactId, item.src]));
  const [state, setState] = useState<{ engine?: WindowEngine; signature: string; sources: Record<string, Source> }>({ signature: "", sources: {} });
  const controls = useRef(new Map<string, Control>());
  useEffect(() => {
    let live = true;
    const registry = new Map<string, Control>();
    controls.current = registry;
    const entries = JSON.parse(signature) as [string, string | undefined][];
    for (const [artifactId, src] of entries) {
      let refreshed = false;
      let generation = 0;
      const publish = (value?: Source) => {
        if (!live) return;
        setState((current) => {
          const sources = current.engine === engine && current.signature === signature ? { ...current.sources } : {};
          if (value) sources[artifactId] = value;
          else delete sources[artifactId];
          return { engine, signature, sources };
        });
      };
      const load = (reset = true) => {
        const attempt = ++generation;
        if (reset) publish();
        void (engine ? resolveAttachmentSource(engine, { artifactId, src, kind: "image", name: "", kept: true }) : Promise.reject(new Error("Attachment unavailable")))
          .then((url) => { if (live && generation === attempt) publish({ src: url }); })
          .catch(() => { if (live && generation === attempt) publish({ error: true }); });
      };
      registry.set(artifactId, {
        retry: () => { refreshed = false; load(); },
        failed: () => { if (refreshed) publish({ error: true }); else { refreshed = true; load(); } },
        loaded: () => { refreshed = false; },
      });
      load(false);
    }
    return () => { live = false; if (controls.current === registry) controls.current = new Map(); };
  }, [engine, signature]);
  const sources = state.engine === engine && state.signature === signature ? state.sources : {};
  return {
    sources,
    retry: (id: string) => controls.current.get(id)?.retry(),
    failed: (id: string) => controls.current.get(id)?.failed(),
    loaded: (id: string) => controls.current.get(id)?.loaded(),
  };
}
