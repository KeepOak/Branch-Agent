import type { PluginBlobStore } from "branch/plugin-sdk/plugin-state-runtime";

/** In-memory stand-in for runtime.state.openBlobStore in unit tests. */
export function createMemoryBlobStore<TMetadata>(): PluginBlobStore<TMetadata> & {
  keys(): string[];
} {
  const entries = new Map<string, { bytes: Uint8Array; metadata: TMetadata; createdAt: number }>();
  const info = (key: string) => {
    const entry = entries.get(key)!;
    return {
      key,
      metadata: entry.metadata,
      sizeBytes: entry.bytes.byteLength,
      createdAt: entry.createdAt,
    };
  };
  return {
    keys: () => [...entries.keys()],
    async register(key, bytes, metadata) {
      entries.set(key, { bytes: new Uint8Array(bytes), metadata, createdAt: Date.now() });
    },
    async registerIfAbsent(key, bytes, metadata) {
      if (entries.has(key)) {
        return false;
      }
      entries.set(key, { bytes: new Uint8Array(bytes), metadata, createdAt: Date.now() });
      return true;
    },
    async lookup(key) {
      const entry = entries.get(key);
      return entry ? { ...info(key), bytes: entry.bytes } : undefined;
    },
    async entries() {
      return [...entries.keys()].map(info);
    },
    async delete(key) {
      return entries.delete(key);
    },
    async deleteExpiredKey() {
      return undefined;
    },
    async deleteExpired() {
      return [];
    },
    async clear() {
      entries.clear();
    },
  };
}
