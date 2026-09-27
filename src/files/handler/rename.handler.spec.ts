import { RenameHandler } from './rename.handler';
import { FilesInterface } from '../files.interface';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'fixed-uuid-1234'),
}));

describe('RenameHandler', () => {
  let handler: RenameHandler;

  beforeEach(() => {
    handler = new RenameHandler();
    jest.clearAllMocks();
  });

  function makeFile(originalname: string): FilesInterface {
    return new FilesInterface({
      buffer: Buffer.from('test'),
      mimetype: 'image/png',
      originalname,
      size: 4,
    } as any);
  }

  it('returns a new FilesInterface with UUID name', () => {
    const file = makeFile('photo.png');
    const result = handler.rename(file);
    expect(result).toBeInstanceOf(FilesInterface);
    expect(result.originalname).toBe('fixed-uuid-1234.png');
  });

  it('preserves buffer, mimetype, and size', () => {
    const buffer = Buffer.from('test');
    const file = makeFile('photo.png');
    const result = handler.rename(file);
    expect(result.buffer).toEqual(buffer);
    expect(result.mimetype).toBe('image/png');
    expect(result.size).toBe(4);
  });

  it('extracts extension from originalname', () => {
    const file = makeFile('document.pdf');
    const result = handler.rename(file);
    expect(result.originalname).toBe('fixed-uuid-1234.pdf');
  });

  it('uses provided extension when given', () => {
    const file = makeFile('photo.png');
    const result = handler.rename(file, 'webp');
    expect(result.originalname).toBe('fixed-uuid-1234.webp');
  });

  it('handles filenames with multiple dots (uses last segment as extension)', () => {
    const file = makeFile('my.photo.file.png');
    const result = handler.rename(file);
    expect(result.originalname).toBe('fixed-uuid-1234.png');
  });

  it('handles filenames with no extension', () => {
    const file = makeFile('noextension');
    const result = handler.rename(file);
    expect(result.originalname).toBe('fixed-uuid-1234.noextension');
  });

  it('does not mutate the original file', () => {
    const file = makeFile('photo.png');
    handler.rename(file);
    expect(file.originalname).toBe('photo.png');
  });

  it('strips path separators from extension (no traversal)', () => {
    const file = makeFile('../../evil');
    const result = handler.rename(file);
    expect(result.originalname).toBe('fixed-uuid-1234.evil');
    expect(result.originalname).not.toContain('/');
    expect(result.originalname).not.toContain('..');
  });

  it('drops non-alphanumeric characters and caps extension length', () => {
    const file = makeFile('photo.png');
    const result = handler.rename(file, '../ extremely&long_extension!!');
    expect(result.originalname).toBe('fixed-uuid-1234.extremelylong_ex');
  });
});
