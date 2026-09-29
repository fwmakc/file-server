import { sanitizeFolderPath, sanitizeRequestPath } from './storage.utils';

describe('sanitizeFolderPath', () => {
  it('keeps word characters and slashes', () => {
    expect(sanitizeFolderPath('photos/2024')).toBe('photos/2024');
    expect(sanitizeFolderPath('photos')).toBe('photos');
  });

  it('drops traversal segments', () => {
    expect(sanitizeFolderPath('../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeFolderPath('..')).toBe('');
    expect(sanitizeFolderPath('..\\..\\windows')).toBe('windows');
  });

  it('collapses empty segments', () => {
    expect(sanitizeFolderPath('a//b')).toBe('a/b');
    expect(sanitizeFolderPath('/a/')).toBe('a');
  });

  it('returns empty for missing input', () => {
    expect(sanitizeFolderPath(undefined)).toBe('');
    expect(sanitizeFolderPath('')).toBe('');
  });
});

describe('sanitizeRequestPath', () => {
  it('keeps clean paths intact', () => {
    expect(sanitizeRequestPath('photos/photo.png')).toBe('photos/photo.png');
    expect(sanitizeRequestPath('a//b')).toBe('a/b');
  });

  it('drops dot segments and traversal', () => {
    expect(sanitizeRequestPath('../../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeRequestPath('a/./b')).toBe('a/b');
    expect(sanitizeRequestPath('..')).toBe('');
    expect(sanitizeRequestPath('.')).toBe('');
    expect(sanitizeRequestPath('')).toBe('');
  });

  it('treats backslashes as separators', () => {
    expect(sanitizeRequestPath('..\\..\\windows\\file.txt')).toBe(
      'windows/file.txt',
    );
  });

  it('strips control characters and trims segments', () => {
    expect(sanitizeRequestPath('file\u0000.txt')).toBe('file.txt');
    expect(sanitizeRequestPath('  a.txt  ')).toBe('a.txt');
  });
});
