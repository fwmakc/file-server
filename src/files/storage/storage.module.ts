import { DynamicModule, Module } from "@nestjs/common";
import { StorageDownloadController } from "./download.controller";
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
      // В local-режиме отдачу выполняет ServeStaticModule; прокси-роут нужен
      // только когда файлы лежат в S3
      controllers: isS3Storage() ? [StorageDownloadController] : [],
      providers: [{ provide: FILES_STORAGE, useFactory: createStorage }],
      exports: [FILES_STORAGE],
    };
  }
}
