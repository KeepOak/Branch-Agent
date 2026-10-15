import { OversizeReadError } from './attachments';
import { readUriCapped } from './pickAttachment';

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
