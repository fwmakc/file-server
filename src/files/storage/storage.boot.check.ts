import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { FILES_STORAGE, IFileStorage } from "./storage.interface";
import { isS3Storage } from "./storage.module";

/**
 * Boot-time reachability probe: in s3 mode a misconfigured bucket should be
 * loud in the logs at startup, not discovered on the first upload. Does not
 * crash the boot — the bucket-init job ordering already gates the compose
 * stack, and /health/storage reports the live state.
 */
@Injectable()
export class StorageBootCheck implements OnModuleInit {
  private readonly logger = new Logger(StorageBootCheck.name);

  constructor(@Inject(FILES_STORAGE) private readonly storage: IFileStorage) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.storage.ping();
      this.logger.log(`Storage reachable (${isS3Storage() ? "s3" : "local"})`);
    } catch (e) {
      this.logger.error(
        `Storage NOT reachable at boot (${isS3Storage() ? "s3" : "local"}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}
