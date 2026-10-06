import { Injectable, Logger } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";
import { UserDeletedDto, WebhookEnvelopeDto } from "event-server/contracts";
import { FileAclGrantEntity, grantSubject } from "../files/acl/acl.entity";
import { ProcessedEventEntity } from "./processed-event.entity";

/**
 * Bus receiver for file-server. The only consumed contract is
 * `user.deleted`: grants issued to a deleted account can never match a
 * JWT again, but purging them keeps the ACL tables clean. The ledger row
 * is written in the same transaction as the purge, so a redelivery after
 * a crash neither loses nor double-applies it.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async handleEvent(event: WebhookEnvelopeDto): Promise<void> {
    switch (event.pattern) {
      case "user.deleted":
        await this.processOnce(
          event,
          async (em) => await this.onUserDeleted(em, event.payload as UserDeletedDto),
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
