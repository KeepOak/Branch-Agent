// Files and pictures in the draft, sent with chat.send's `attachments` the way the window does
// (window/src/composer/attachments.ts, engine/ui/src/pages/chat/attachment-api.ts). The phone has no
// separate upload method: the gateway takes the bytes on the same chat.send the composer already uses.

export type DraftFile = {
  id: string;
  kind: 'file' | 'text';
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** base64 bytes, once read */
  content?: string;
  /** a data: URL for a picture's thumbnail */
  preview?: string;
  origin: 'file' | 'paste';
  problem?: string;
  /** the engine's or the picker's own words for the problem */
  detail?: string;
};

export type AttachmentPolicy = { maxBytes?: number; maxImageBytes?: number };

/** A file the camera, library or document picker returned, before it becomes a chip. */
export type PickedFile = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  content?: string;
};

export type HelloAttachments = {
  features?: { methods?: readonly string[] };
  policy?: { attachments?: AttachmentPolicy };
};

/** chat.send is the method that carries attachments; the phone gateway has no upload RPC of its own. */
export const CHAT_SEND = 'chat.send';

export const NO_ATTACH_METHOD_NOTE = 'This computer can’t take attachments from this phone.';

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/** True when this handshake offers chat.send, the method attachments ride on. */
export function canSendAttachments(hello: HelloAttachments | null | undefined): boolean {
  return Boolean(hello?.features?.methods?.includes(CHAT_SEND));
}

/** The engine's own limits from hello.policy.attachments. */
export function attachmentPolicy(hello: HelloAttachments | null | undefined): AttachmentPolicy | undefined {
  const policy = hello?.policy?.attachments;
  return policy && (policy.maxBytes !== undefined || policy.maxImageBytes !== undefined) ? policy : undefined;
}

/** The problem with a file before it is read, from the engine's own limits (hello.policy.attachments). */
export function sizeProblem(name: string, mimeType: string, size: number, policy: AttachmentPolicy | undefined): string | undefined {
  const limit = isImage(mimeType) ? (policy?.maxImageBytes ?? policy?.maxBytes) : policy?.maxBytes;
  return limit !== undefined && size > limit ? `Too large to send: ${name}` : undefined;
}

/** The size in the chip, in the units people read. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Preparing <n> attachments…" (one: "Preparing 1 attachment"). */
export function preparingLine(n: number): string {
  return n === 1 ? 'Preparing 1 attachment' : `Preparing ${n} attachments…`;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** The payload chat.send takes for the ready chips (attachment-api.ts buildChatApiAttachments). */
export function toChatAttachments(files: readonly DraftFile[]): Array<Record<string, unknown>> {
  return files
    .filter((f) => f.content && !f.problem)
    .map((f) => ({
      type: isImage(f.mimeType) ? 'image' : 'file',
      mimeType: f.mimeType,
      fileName: f.fileName,
      origin: f.origin,
      content: f.content,
    }));
}

/** Turns a picked photo or file into a chip, using the engine's size limits when the hello sent them. */
export function readPickedFile(id: string, picked: PickedFile, origin: DraftFile['origin'], policy: AttachmentPolicy | undefined): DraftFile {
  const mimeType = picked.mimeType || 'application/octet-stream';
  const sizeBytes = picked.sizeBytes || (picked.content ? Math.floor((picked.content.length * 3) / 4) : 0);
  const base: DraftFile = { id, kind: 'file', fileName: picked.fileName || 'file', mimeType, sizeBytes, origin };
  const problem = sizeProblem(base.fileName, mimeType, sizeBytes, policy);
  if (problem) return { ...base, problem };
  if (!picked.content) return { ...base, problem: `Couldn't attach: ${base.fileName}` };
  return { ...base, content: picked.content, ...(isImage(mimeType) ? { preview: `data:${mimeType};base64,${picked.content}` } : {}) };
}

/** Words in the outgoing bubble when the send has no typed text. */
export function attachmentSendLabel(attachments: readonly { fileName?: unknown }[]): string {
  if (attachments.length === 1) return String(attachments[0]?.fileName || 'Sent a file');
  return `Sent ${attachments.length} files`;
}
