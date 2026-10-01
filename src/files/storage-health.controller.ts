import { Inject, Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  FILES_STORAGE,
  IFileStorage,
} from "./storage/storage.interface";
import { isS3Storage } from "./storage/storage.module";

/**
 * Readiness поверх liveness /health (тулкит): в s3-режиме отражает
 * досягаемость бакета, в local — всегда ok (локальный диск).
 * Docker healthcheck продолжает ходить на /health — процесс жив,
 * а оркестратор/мониторинг могут опрашивать /health/storage.
 */
@ApiExcludeController()
@Controller("health")
export class StorageHealthController {
  constructor(@Inject(FILES_STORAGE) private readonly storage: IFileStorage) {}

  @Get("storage")
  async storageHealth() {
    try {
      await this.storage.ping();
      return { status: "ok", storage: isS3Storage() ? "s3" : "local" };
    } catch (e) {
      throw new ServiceUnavailableException({
        status: "error",
        storage: isS3Storage() ? "s3" : "local",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
