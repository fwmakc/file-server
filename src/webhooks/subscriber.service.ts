import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { httpPost } from "api-server-toolkit/helper";

@Injectable()
export class SubscriberService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubscriberService.name);
  private readonly eventServerUrl: string;
  private readonly apiKey: string;
  private readonly webhookUrl: string;
  private readonly webhookSecret?: string;
  private readonly patterns = ["user.deleted"];

  constructor(private readonly config: ConfigService) {
    this.eventServerUrl = this.config.get<string>(
      "EVENT_SERVER_URL",
      "http://event-server:3005",
    );
    this.apiKey = this.config.get<string>("INTERNAL_API_KEY", "changeme");
    const prefix = this.config.get<string>("PREFIX") || "";
    this.webhookUrl = this.config.get<string>(
      "WEBHOOK_URL",
      `http://file-server:3002${prefix ? `/${prefix}` : ""}/webhooks/events`,
    );
    // Shared HMAC secret for signed deliveries. Passed at registration so
    // event-server stores it for this subscriber; EventDeliveryGuard
    // verifies X-Event-Signature with it. Unset = legacy internal-key
    // transport (set WEBHOOK_SECRET on BOTH services to harden).
    this.webhookSecret =
      this.config.get<string>("WEBHOOK_SECRET") || undefined;
  }

  async onApplicationBootstrap(): Promise<void> {
    // Wiring probes and offline tools boot the real AppModule without a
    // bus to subscribe to — EVENT_SERVER_URL=disabled skips cleanly.
    if (this.eventServerUrl === "disabled") {
      this.logger.warn("Event bus subscription disabled");
      return;
    }
    await this.register();
  }

  private async register(retry = 0): Promise<void> {
    try {
      await httpPost(
        `${this.eventServerUrl}/subscribe`,
        {
          service: "file-server",
          url: this.webhookUrl,
          patterns: this.patterns,
          active: true,
          // Registration is idempotent (same service+url merges): a fresh
          // secret here re-provisions the stored one, e.g. after rotation.
          ...(this.webhookSecret ? { secret: this.webhookSecret } : {}),
        },
        {
          headers: { "X-Internal-Api-Key": this.apiKey },
          timeout: 5000,
        },
      );

      if (this.webhookSecret) {
        this.logger.log("Subscribed to the event bus (signed deliveries)");
      } else {
        this.logger.warn(
          "Subscribed to the event bus WITHOUT delivery signing — set WEBHOOK_SECRET on both services",
        );
      }
    } catch (e) {
      // event-server may still be booting (compose race): retry with
      // exponential backoff instead of dying silently.
      if (retry < 5) {
        const delay = 2000 * 2 ** retry;
        this.logger.warn(
          `Subscription failed (${(e as Error).message}); retry ${retry + 1}/5 in ${delay}ms`,
        );
        setTimeout(() => void this.register(retry + 1), delay);
      } else {
        this.logger.error(
          `Subscription failed after 6 attempts: ${(e as Error).message}`,
        );
      }
    }
  }
}
