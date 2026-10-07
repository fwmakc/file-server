import { Injectable, Logger } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";
import { AuthClientService } from "api-server-toolkit/auth-client";
import {
  UserDeletedDto,
  UserDeactivatedDto,
  UserRolesChangedDto,
  WebhookEnvelopeDto,
} from "event-server/contracts";
import { FileAclGrantEntity, grantSubject } from "../files/acl/acl.entity";
import { ProcessedEventEntity } from "./processed-event.entity";

/**
 * Bus receiver for file-server. Consumed contracts:
 * - `user.deleted`: grants issued to a deleted account can never match a
 *   JWT again, but purging them keeps the ACL tables clean. The ledger row
 *   is written in the same transaction as the purge, so a redelivery after
 *   a crash neither loses nor double-applies it.
 * - `user.deactivated` / `user.roles_changed`: no local mutation — the
 *   auth-client cache entry (roles feed the staff checks in AclService)
 *   must drop on EVERY delivery, so invalidation runs outside the ledger
 *   (the shared webhook_processed_events table dedupes only DB writes;
 *   each replica owns its own cache).
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly authClient: AuthClientService,
  ) {}

  async handleEvent(event: WebhookEnvelopeDto): Promise<void> {
    switch (event.pattern) {
      case "user.deleted":
        this.authClient.clearCache((event.payload as UserDeletedDto).userId);
        await this.processOnce(
          event,
          async (em) =>
            await this.onUserDeleted(em, event.payload as UserDeletedDto),
        );
        break;
      case "user.deactivated":
        this.authClient.clearCache(
          (event.payload as UserDeactivatedDto).userId,
        );
        this.logger.log(
          `Invalidated auth cache: userId=${
            (event.payload as UserDeactivatedDto).userId
          } (deactivated)`,
        );
        break;
      case "user.roles_changed":
        this.authClient.clearCache(
          (event.payload as UserRolesChangedDto).userId,
        );
        this.logger.log(
          `Invalidated auth cache: userId=${
            (event.payload as UserRolesChangedDto).userId
          } (roles_changed)`,
        );
        break;
      default:
        this.logger.warn(`No handler for pattern: ${event.pattern}`);
    }
  }

  private async onUserDeleted(
    em: EntityManager,
    payload: UserDeletedDto,
  ): Promise<void> {
    await em.delete(FileAclGrantEntity, {
      subject: grantSubject(payload.userId),
    });
    this.logger.log(`Purged file ACL grants for userId=${payload.userId}`);
  }

  private async processOnce(
    event: WebhookEnvelopeDto,
    handler: (em: EntityManager) => Promise<void>,
  ): Promise<void> {
    const processed = await this.dataSource.transaction(async (em) => {
      const inserted = await em
        .createQueryBuilder()
        .insert()
        .into(ProcessedEventEntity)
        .values({ eventId: String(event.eventId) })
        .orIgnore()
        .returning("id")
        .execute();

      if (inserted.raw.length === 0) return false;

      await handler(em);
      return true;
    });

    if (!processed) {
      this.logger.log(
        `Duplicate delivery skipped (eventId=${event.eventId}, pattern=${event.pattern})`,
      );
    }
  }
}
