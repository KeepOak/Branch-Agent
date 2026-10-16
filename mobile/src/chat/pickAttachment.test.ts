import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { DEFAULT_ATTACHMENT_POLICY, OversizeReadError } from './attachments';
import { expoPickers, readUriCapped } from './pickAttachment';

describe('readUriCapped', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not read the body when Content-Length is already over the ceiling', async () => {
    const arrayBuffer = jest.fn(async () => new ArrayBuffer(20));
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? '20' : null) },
      body: null,
      arrayBuffer,
    } as unknown as Response);
    await expect(readUriCapped('file://notes.bin', 4)).rejects.toBeInstanceOf(OversizeReadError);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('stops a streamed body once it passes the ceiling', async () => {
    const cancel = jest.fn(async () => undefined);
    const read = jest
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(3) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(3) });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body: { getReader: () => ({ read, cancel }) },
      arrayBuffer: jest.fn(),
    } as unknown as Response);
    await expect(readUriCapped('file://notes.bin', 4)).rejects.toMatchObject({ sizeBytes: 6 });
    expect(cancel).toHaveBeenCalled();
  });
});

describe('expoPickers size gate', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not fetch a file the picker already knows is over the engine default', async () => {
    const size = DEFAULT_ATTACHMENT_POLICY.maxBytes + 1;
    jest.spyOn(DocumentPicker, 'getDocumentAsync').mockResolvedValue({
      canceled: false,
      assets: [{ name: 'huge.bin', mimeType: 'application/octet-stream', size, uri: 'file://huge.bin' }],
    } as DocumentPicker.DocumentPickerResult);
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const picked = await expoPickers.pickFile();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(picked).toEqual({ fileName: 'huge.bin', mimeType: 'application/octet-stream', sizeBytes: size });
    expect(picked?.content).toBeUndefined();
  });

  it('does not fetch a library photo over the image ceiling', async () => {
    const size = DEFAULT_ATTACHMENT_POLICY.maxImageBytes + 1;
    jest.spyOn(ImagePicker, 'requestMediaLibraryPermissionsAsync').mockResolvedValue({
      granted: true,
      canAskAgain: true,
      status: 'granted',
    } as ImagePicker.MediaLibraryPermissionResponse);
    jest.spyOn(ImagePicker, 'launchImageLibraryAsync').mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://shot.png', mimeType: 'image/png', fileName: 'shot.png', fileSize: size }],
    } as ImagePicker.ImagePickerResult);
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const picked = await expoPickers.pickPhoto();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(picked?.content).toBeUndefined();
    expect(picked?.sizeBytes).toBe(size);
  });
});
