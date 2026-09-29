import { LocalStorage } from './local.storage';
import { S3Storage } from './s3.storage';
import { createStorage, isS3Storage } from './storage.module';

describe('StorageModule', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('defaults to LocalStorage', () => {
    delete process.env.FILE_STORAGE;

    expect(isS3Storage()).toBe(false);
    expect(createStorage()).toBeInstanceOf(LocalStorage);
  });

  it('creates S3Storage when FILE_STORAGE=s3', () => {
    process.env.FILE_STORAGE = 's3';
    process.env.S3_BUCKET = 'test-bucket';

    expect(isS3Storage()).toBe(true);
    expect(createStorage()).toBeInstanceOf(S3Storage);
  });
});
