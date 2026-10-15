// Camera, library and file pickers for the chat composer. The bytes go on chat.send; these only
// turn a system pick into the same PickedFile the window's File reader produces.
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { encodeBase64, type PickedFile } from './attachments';

export type AttachmentPickers = {
  takePhoto(): Promise<PickedFile | null>;
  pickPhoto(): Promise<PickedFile | null>;
  pickFile(): Promise<PickedFile | null>;
};

function fromImage(asset: ImagePicker.ImagePickerAsset): PickedFile {
  const mimeType = asset.mimeType || 'image/jpeg';
  const content = asset.base64 ?? undefined;
  return {
    fileName: asset.fileName || (mimeType === 'image/png' ? 'photo.png' : 'photo.jpg'),
    mimeType,
    sizeBytes: asset.fileSize ?? (content ? Math.floor((content.length * 3) / 4) : 0),
    content,
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

async function bytesFromUri(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Couldn’t read the file.');
  return new Uint8Array(await response.arrayBuffer());
}

export const expoPickers: AttachmentPickers = {
  async takePhoto() {
    await requireCamera();
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], base64: true, quality: 1 });
    const asset = result.canceled ? null : result.assets[0];
    return asset ? fromImage(asset) : null;
  },
  async pickPhoto() {
    await requireLibrary();
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 1 });
    const asset = result.canceled ? null : result.assets[0];
    return asset ? fromImage(asset) : null;
  },
  async pickFile() {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return null;
    const bytes = await bytesFromUri(asset.uri);
    return {
      fileName: asset.name || 'file',
      mimeType: asset.mimeType || 'application/octet-stream',
      sizeBytes: asset.size ?? bytes.byteLength,
      content: encodeBase64(bytes),
    };
  },
};
