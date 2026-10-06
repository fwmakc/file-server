import { DynamicModule, Module } from "@nestjs/common";
import { LocalStorage } from "./local.storage";
import { S3Storage } from "./s3.storage";
import { FILES_STORAGE, IFileStorage } from "./storage.interface";

export const isS3Storage = (): boolean => process.env.FILE_STORAGE === "s3";

export const createStorage = (): IFileStorage =>
  isS3Storage() ? new S3Storage() : new LocalStorage();

@Module({})
export class StorageModule {
  static register(): DynamicModule {
    return {
      module: StorageModule,
      // DownloadController is registered in FilesModule for both modes —
      // private-by-default rules out an unguarded static path in local
      // mode too.
      providers: [{ provide: FILES_STORAGE, useFactory: createStorage }],
      exports: [FILES_STORAGE],
    };
  }
}
