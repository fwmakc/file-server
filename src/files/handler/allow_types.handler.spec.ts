import { AllowTypesHandler } from './allow_types.handler';
import { FilesInterface } from '../files.interface';

describe('AllowTypesHandler', () => {
  let handler: AllowTypesHandler;
  const envBackup = { ...process.env };

  beforeEach(() => {
    handler = new AllowTypesHandler();
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  function makeFile(mimetype: string): FilesInterface {
    return new FilesInterface({
      buffer: Buffer.from('test'),
      mimetype,
      originalname: 'test.txt',
      size: 4,
    } as any);
  }

  it('returns true when UPLOADS_ALLOW_TYPES is not set', () => {
    delete process.env.UPLOADS_ALLOW_TYPES;
    expect(handler.allowTypes(makeFile('image/png'))).toBe(true);
  });

  it('returns true when UPLOADS_ALLOW_TYPES is empty string', () => {
    process.env.UPLOADS_ALLOW_TYPES = '';
    expect(handler.allowTypes(makeFile('image/png'))).toBe(true);
  });

  it('returns true when type matches major group (image)', () => {
    process.env.UPLOADS_ALLOW_TYPES = 'image';
    expect(handler.allowTypes(makeFile('image/png'))).toBe(true);
  });

  it('returns true when type matches minor subtype (png)', () => {
    process.env.UPLOADS_ALLOW_TYPES = 'png';
    expect(handler.allowTypes(makeFile('image/png'))).toBe(true);
  });

  it('returns true when multiple types allowed and one matches', () => {
    process.env.UPLOADS_ALLOW_TYPES = 'image;pdf;json';
    expect(handler.allowTypes(makeFile('application/pdf'))).toBe(true);
  });

  it('returns false when type does not match', () => {
    process.env.UPLOADS_ALLOW_TYPES = 'image';
    expect(handler.allowTypes(makeFile('application/pdf'))).toBe(false);
  });

  it('matches on substring (video matches video/mp4)', () => {
    process.env.UPLOADS_ALLOW_TYPES = 'video';
    expect(handler.allowTypes(makeFile('video/mp4'))).toBe(true);
  });

  it('returns false for text/plain when only image allowed', () => {
    process.env.UPLOADS_ALLOW_TYPES = 'image';
    expect(handler.allowTypes(makeFile('text/plain'))).toBe(false);
  });
});
