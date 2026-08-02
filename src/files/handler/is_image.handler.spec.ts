import { IsImageHandler } from './is_image.handler';
import { FilesInterface } from '../files.interface';

describe('IsImageHandler', () => {
  let handler: IsImageHandler;

  beforeEach(() => {
    handler = new IsImageHandler();
  });

  function makeFile(mimetype: string): FilesInterface {
    return new FilesInterface({
      buffer: Buffer.from('test'),
      mimetype,
      originalname: 'test',
      size: 4,
    } as any);
  }

  it('returns true for image/png', async () => {
    expect(await handler.isImage(makeFile('image/png'))).toBe(true);
  });

  it('returns true for image/jpeg', async () => {
    expect(await handler.isImage(makeFile('image/jpeg'))).toBe(true);
  });

  it('returns true for image/webp', async () => {
    expect(await handler.isImage(makeFile('image/webp'))).toBe(true);
  });

  it('returns true for image/svg+xml', async () => {
    expect(await handler.isImage(makeFile('image/svg+xml'))).toBe(true);
  });

  it('returns false for application/pdf', async () => {
    expect(await handler.isImage(makeFile('application/pdf'))).toBe(false);
  });

  it('returns false for text/plain', async () => {
    expect(await handler.isImage(makeFile('text/plain'))).toBe(false);
  });

  it('returns false for video/mp4', async () => {
    expect(await handler.isImage(makeFile('video/mp4'))).toBe(false);
  });
});
