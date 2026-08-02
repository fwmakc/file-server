import { MaxSizeHandler } from './max_size.handler';
import { FilesInterface } from '../files.interface';

describe('MaxSizeHandler', () => {
  let handler: MaxSizeHandler;
  const envBackup = { ...process.env };

  beforeEach(() => {
    handler = new MaxSizeHandler();
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  function makeFile(size: number): FilesInterface {
    return new FilesInterface({
      buffer: Buffer.alloc(size),
      mimetype: 'text/plain',
      originalname: 'test.txt',
      size,
    } as any);
  }

  it('returns true when UPLOADS_MAX_SIZE is not set (0 = unlimited)', () => {
    delete process.env.UPLOADS_MAX_SIZE;
    expect(handler.maxSize(makeFile(999999))).toBe(true);
  });

  it('returns true when UPLOADS_MAX_SIZE is 0 (unlimited)', () => {
    process.env.UPLOADS_MAX_SIZE = '0';
    expect(handler.maxSize(makeFile(999999))).toBe(true);
  });

  it('returns true when file size is within limit', () => {
    process.env.UPLOADS_MAX_SIZE = '1048576';
    expect(handler.maxSize(makeFile(1024))).toBe(true);
  });

  it('returns true when file size equals limit exactly', () => {
    process.env.UPLOADS_MAX_SIZE = '1024';
    expect(handler.maxSize(makeFile(1024))).toBe(true);
  });

  it('returns false when file size exceeds limit', () => {
    process.env.UPLOADS_MAX_SIZE = '1024';
    expect(handler.maxSize(makeFile(1025))).toBe(false);
  });

  it('handles non-numeric env value gracefully (NaN → 0 → unlimited)', () => {
    process.env.UPLOADS_MAX_SIZE = 'abc';
    expect(handler.maxSize(makeFile(999999))).toBe(true);
  });
});
