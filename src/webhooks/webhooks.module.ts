import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { EventDeliveryGuard } from "api-server-toolkit/guard";
import { AclModule } from "../files/acl/acl.module";
import { ProcessedEventEntity } from "./processed-event.entity";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";
import { SubscriberService } from "./subscriber.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([ProcessedEventEntity]),
    // AclService performs the grant purge inside the delivery transaction.
    AclModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, SubscriberService, EventDeliveryGuard],
})
export class WebhooksModule {}
