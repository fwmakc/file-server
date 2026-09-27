import { SaveHandler, sanitizeFilename } from './save.handler';
import { FilesInterface } from '../files.interface';

jest.mock('fs/promises', () => ({
  access: jest.fn(),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
}));

import { access, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

describe('SaveHandler', () => {
  let handler: SaveHandler;
  const envBackup = { ...process.env };

  beforeEach(() => {
    handler = new SaveHandler();
    process.env.UPLOADS_PATH = '/tmp/uploads';
    process.env.UPLOADS_URL = 'http://example.com/files';
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  function makeFile(name = 'test.txt'): FilesInterface {
    return new FilesInterface({
      buffer: Buffer.from('hello'),
      mimetype: 'text/plain',
      originalname: name,
      size: 5,
    } as any);
  }

  describe('save — success path', () => {
    it('writes file and returns URL when folder is accessible', async () => {
      (access as jest.Mock).mockResolvedValue(undefined);
      (existsSync as jest.Mock).mockReturnValue(false);
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await handler.save(makeFile(), {} as any);

      expect(result.url).toBe('http://example.com/files/test.txt');
      expect(writeFile).toHaveBeenCalled();
    });

    it('creates directory when it does not exist', async () => {
      (access as jest.Mock).mockRejectedValue(new Error('ENOENT'));
      (mkdir as jest.Mock).mockResolvedValue(undefined);
      (existsSync as jest.Mock).mockReturnValue(false);
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      await handler.save(makeFile(), {} as any);

      expect(mkdir).toHaveBeenCalledWith(
        expect.stringContaining('uploads'),
        { recursive: true },
      );
    });

    it('includes folder in URL when folder option is provided', async () => {
      (access as jest.Mock).mockResolvedValue(undefined);
      (existsSync as jest.Mock).mockReturnValue(false);
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await handler.save(makeFile(), { folder: 'photos' } as any);

      expect(result.url).toBe('http://example.com/files/photos/test.txt');
    });

    it('overwrites existing file when replace is true', async () => {
      (access as jest.Mock).mockResolvedValue(undefined);
      (existsSync as jest.Mock).mockReturnValue(true);
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await handler.save(makeFile(), { replace: true } as any);

      expect(result.url).toBeDefined();
      expect(writeFile).toHaveBeenCalled();
    });
  });

  describe('save — error paths', () => {
    it('returns error when file already exists and replace is false', async () => {
      (access as jest.Mock).mockResolvedValue(undefined);
      (existsSync as jest.Mock).mockReturnValue(true);

      const result = await handler.save(makeFile(), {} as any);

      expect(result.error).toBe('Файл уже существует');
      expect(result.url).toBeUndefined();
    });

    it('returns error when writeFile fails', async () => {
      (access as jest.Mock).mockResolvedValue(undefined);
      (existsSync as jest.Mock).mockReturnValue(false);
      (writeFile as jest.Mock).mockRejectedValue(new Error('EACCES'));

      const result = await handler.save(makeFile(), {} as any);

      expect(result.error).toBe('Ошибка при записи файла');
    });

    it('returns error when file is null/undefined (after folder creation)', async () => {
      (access as jest.Mock).mockResolvedValue(undefined);

      const result = await handler.save(undefined as any, {} as any);

      expect(result.error).toBe('Файл не задан');
    });
  });

  describe('folder sanitization', () => {
    it('strips non-alphanumeric characters from folder', async () => {
      (access as jest.Mock).mockResolvedValue(undefined);
      (existsSync as jest.Mock).mockReturnValue(false);
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      await handler.save(makeFile(), { folder: '../etc/passwd' } as any);

      const calledPath = (writeFile as jest.Mock).mock.calls[0][0];
      expect(calledPath).not.toContain('..');
    });
  });

  describe('filename sanitization (path traversal)', () => {
    it('extracts basename from traversal paths', () => {
      expect(sanitizeFilename('../../../../etc/passwd')).toBe('passwd');
      expect(sanitizeFilename('..\\..\\windows\\system32\\evil.dll')).toBe('evil.dll');
      expect(sanitizeFilename('/abs/path/photo.png')).toBe('photo.png');
    });

    it('returns empty for dot names and empty input', () => {
      expect(sanitizeFilename('..')).toBe('');
      expect(sanitizeFilename('.')).toBe('');
      expect(sanitizeFilename('')).toBe('');
      expect(sanitizeFilename(undefined)).toBe('');
      expect(sanitizeFilename('../../..')).toBe('');
    });

    it('strips control characters', () => {
      expect(sanitizeFilename('file\u0000.txt')).toBe('file.txt');
      expect(sanitizeFilename('a\u001fb.png')).toBe('ab.png');
    });

    it('never writes outside the upload folder via originalname', async () => {
      (access as jest.Mock).mockResolvedValue(undefined);
      (existsSync as jest.Mock).mockReturnValue(false);
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      await handler.save(makeFile('../../../owned.txt'), {} as any);

      const calledPath = (writeFile as jest.Mock).mock.calls[0][0];
      expect(calledPath).toBe(join('/tmp/uploads', 'owned.txt'));
      expect(calledPath).not.toContain('..');
    });

    it('returns error when originalname reduces to nothing', async () => {
      const result = await handler.save(makeFile('../..'), {} as any);

      expect(result.error).toBe('Некорректное имя файла');
      expect(writeFile).not.toHaveBeenCalled();
    });
  });
});
