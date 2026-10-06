import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import { EventDeliveryGuard } from "api-server-toolkit/guard";
import { WebhookEnvelopeDto } from "event-server/contracts";
import { WebhooksService } from "./webhooks.service";

@Controller("webhooks")
@UseGuards(EventDeliveryGuard)
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post("events")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Приём события от event-server" })
  async receiveEvent(@Body() body: WebhookEnvelopeDto) {
    await this.webhooksService.handleEvent(body);
    return { received: true };
  }
}
