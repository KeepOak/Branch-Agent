import {
  attachmentPolicy,
  attachmentSendLabel,
  canSendAttachments,
  DEFAULT_ATTACHMENT_POLICY,
  formatSize,
  NO_ATTACH_METHOD_NOTE,
  OversizeReadError,
  preparingLine,
  readIfWithinLimit,
  readPickedFile,
  resolvedAttachmentPolicy,
  sizeProblem,
  toChatAttachments,
  type DraftFile,
} from './attachments';

describe('attachment helpers', () => {
  it('uses the engine’s own limits and says which file is too large', () => {
    expect(sizeProblem('a.png', 'image/png', 10, { maxImageBytes: 5, maxBytes: 100 })).toBe('Too large to send: a.png');
    expect(sizeProblem('a.txt', 'text/plain', 10, { maxImageBytes: 5, maxBytes: 100 })).toBeUndefined();
    expect(sizeProblem('a.txt', 'text/plain', 10, undefined)).toBeUndefined();
    expect(sizeProblem('huge.bin', 'application/octet-stream', DEFAULT_ATTACHMENT_POLICY.maxBytes + 1, undefined)).toBe(
      'Too large to send: huge.bin',
    );
    expect(sizeProblem('huge.png', 'image/png', DEFAULT_ATTACHMENT_POLICY.maxImageBytes + 1, undefined)).toBe('Too large to send: huge.png');
  });

  it('formats sizes and the preparing line', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(preparingLine(1)).toBe('Preparing 1 attachment');
    expect(preparingLine(3)).toBe('Preparing 3 attachments…');
  });

  it('sends only ready chips, in chat.send’s shape', () => {
    const files: DraftFile[] = [
      { id: '1', kind: 'file', fileName: 'a.png', mimeType: 'image/png', sizeBytes: 3, content: 'AAA', origin: 'file' },
      { id: '2', kind: 'file', fileName: 'b', mimeType: 'text/plain', sizeBytes: 3, origin: 'file', problem: 'Too large to send: b' },
    ];
    expect(toChatAttachments(files)).toEqual([{ type: 'image', mimeType: 'image/png', fileName: 'a.png', origin: 'file', content: 'AAA' }]);
  });

  it('reads a picked file into a chip, or names the problem', () => {
    expect(readPickedFile('1', { fileName: 'shot.png', mimeType: 'image/png', sizeBytes: 3, content: 'AAA' }, 'file', undefined)).toEqual({
      id: '1',
      kind: 'file',
      fileName: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: 3,
      origin: 'file',
      content: 'AAA',
      preview: 'data:image/png;base64,AAA',
    });
    expect(readPickedFile('2', { fileName: 'big.png', mimeType: 'image/png', sizeBytes: 9, content: 'AAA' }, 'file', { maxImageBytes: 4 })).toEqual({
      id: '2',
      kind: 'file',
      fileName: 'big.png',
      mimeType: 'image/png',
      sizeBytes: 9,
      origin: 'file',
      problem: 'Too large to send: big.png',
    });
    expect(readPickedFile('3', { fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: 0 }, 'file', undefined)).toMatchObject({
      problem: expect.stringContaining('notes.txt'),
    });
  });

  it('offers attachments only when the hello lists chat.send', () => {
    expect(canSendAttachments(null)).toBe(false);
    expect(canSendAttachments({ features: { methods: [] } })).toBe(false);
    expect(canSendAttachments({ features: { methods: ['chat.history'] } })).toBe(false);
    expect(canSendAttachments({ features: { methods: ['chat.send'] } })).toBe(true);
    expect(attachmentPolicy({ policy: { attachments: { maxBytes: 10, maxImageBytes: 4 } } })).toEqual({ maxBytes: 10, maxImageBytes: 4 });
    expect(attachmentPolicy({})).toBeUndefined();
    expect(resolvedAttachmentPolicy({})).toEqual(DEFAULT_ATTACHMENT_POLICY);
    expect(resolvedAttachmentPolicy({ policy: { attachments: { maxBytes: 10 } } })).toEqual({
      maxBytes: 10,
      maxImageBytes: DEFAULT_ATTACHMENT_POLICY.maxImageBytes,
    });
    expect(NO_ATTACH_METHOD_NOTE).toMatch(/can’t take attachments/);
    expect(attachmentSendLabel([{ fileName: 'a.png' }])).toBe('a.png');
    expect(attachmentSendLabel([{ fileName: 'a.png' }, { fileName: 'b.pdf' }])).toBe('Sent 2 files');
  });

  it('does not read or encode a pick the picker already knows is too large', async () => {
    const read = jest.fn(async () => new Uint8Array([1, 2, 3]));
    const picked = await readIfWithinLimit({ fileName: 'big.png', mimeType: 'image/png', sizeBytes: 9 }, { maxImageBytes: 4 }, read);
    expect(read).not.toHaveBeenCalled();
    expect(picked).toEqual({ fileName: 'big.png', mimeType: 'image/png', sizeBytes: 9 });
    expect(picked.content).toBeUndefined();
    expect(readPickedFile('1', picked, 'file', { maxImageBytes: 4 })).toMatchObject({ problem: 'Too large to send: big.png' });
    expect(toChatAttachments([readPickedFile('1', picked, 'file', { maxImageBytes: 4 })])).toEqual([]);
  });

  it('caps the read when the picker does not report a size', async () => {
    const read = jest.fn(async (maxBytes: number) => {
      expect(maxBytes).toBe(4);
      throw new OversizeReadError(8);
    });
    const picked = await readIfWithinLimit({ fileName: 'big.png', mimeType: 'image/png' }, { maxImageBytes: 4 }, read);
    expect(read).toHaveBeenCalledWith(4);
    expect(picked.content).toBeUndefined();
    expect(picked.sizeBytes).toBe(8);
  });
});
