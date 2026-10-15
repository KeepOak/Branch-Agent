// Camera, library and file pickers for the chat composer. Size is checked before any read, the
// way the window's readDraftFile rejects on file.size before arrayBuffer().
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  OversizeReadError,
  readIfWithinLimit,
  type AttachmentPolicy,
  type PickMeta,
  type PickedFile,
} from './attachments';

export type AttachmentPickers = {
  takePhoto(policy?: AttachmentPolicy): Promise<PickedFile | null>;
  pickPhoto(policy?: AttachmentPolicy): Promise<PickedFile | null>;
  pickFile(policy?: AttachmentPolicy): Promise<PickedFile | null>;
};

function imageMeta(asset: ImagePicker.ImagePickerAsset): PickMeta {
  const mimeType = asset.mimeType || 'image/jpeg';
  return {
    fileName: asset.fileName || (mimeType === 'image/png' ? 'photo.png' : 'photo.jpg'),
    mimeType,
    sizeBytes: asset.fileSize,
  };
}

async function requireCamera(): Promise<void> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Turn on the camera for Branch in Settings to take a photo.');
}

async function requireLibrary(): Promise<void> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Turn on Photos for Branch in Settings to attach a picture.');
}

/** Reads at most `maxBytes`. Uses Content-Length when present, then the body, and stops past the ceiling. */
export async function readUriCapped(uri: string, maxBytes: number): Promise<Uint8Array> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Couldn’t read the file.');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new OversizeReadError(declared);
  const body = response.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new OversizeReadError(total);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new OversizeReadError(bytes.byteLength);
  return bytes;
}

function fromUri(meta: PickMeta, uri: string, policy: AttachmentPolicy | undefined): Promise<PickedFile> {
  return readIfWithinLimit(meta, policy, (maxBytes) => readUriCapped(uri, maxBytes));
}

export const expoPickers: AttachmentPickers = {
  async takePhoto(policy) {
    await requireCamera();
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    const asset = result.canceled ? null : result.assets[0];
    return asset ? fromUri(imageMeta(asset), asset.uri, policy) : null;
  },
  async pickPhoto(policy) {
    await requireLibrary();
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    const asset = result.canceled ? null : result.assets[0];
    return asset ? fromUri(imageMeta(asset), asset.uri, policy) : null;
  },
  async pickFile(policy) {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return null;
    return fromUri(
      {
        fileName: asset.name || 'file',
        mimeType: asset.mimeType || 'application/octet-stream',
        sizeBytes: asset.size ?? undefined,
      },
      asset.uri,
      policy,
    );
  },
};
