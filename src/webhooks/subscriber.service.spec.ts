jest.mock("api-server-toolkit/helper", () => ({
  httpPost: jest.fn(),
  httpGet: jest.fn(),
}));

import * as os from "os";
import { SubscriberService } from "./subscriber.service";
import { httpPost } from "api-server-toolkit/helper";

const configWith = (values: Record<string, string>) =>
  ({
    get: (key: string, def?: string) => values[key] ?? def,
  }) as any;

describe("SubscriberService", () => {
  beforeEach(() => {
    (httpPost as jest.Mock).mockReset();
  });

  it("registers with event-server, signing secret included", async () => {
    (httpPost as jest.Mock).mockResolvedValue({});
    const service = new SubscriberService(
      configWith({
        EVENT_SERVER_URL: "http://event-server:3005",
        INTERNAL_API_KEY: "key-1",
        WEBHOOK_SECRET: "sekrit",
      }),
    );

    await service.onApplicationBootstrap();

    expect(httpPost).toHaveBeenCalledTimes(1);
    const [url, body, init] = (httpPost as jest.Mock).mock.calls[0];
    expect(url).toBe("http://event-server:3005/subscribe");
    expect(body).toMatchObject({
      service: "file-server",
      patterns: ["user.deleted", "user.deactivated", "user.roles_changed"],
      active: true,
      secret: "sekrit",
    });
    expect(init.headers["X-Internal-Api-Key"]).toBe("key-1");
  });

  it("defaults to a per-replica url: container hostname, not the service DNS name", async () => {
    (httpPost as jest.Mock).mockResolvedValue({});
    const service = new SubscriberService(
      configWith({ EVENT_SERVER_URL: "http://event-server:3005" }),
    );

    await service.onApplicationBootstrap();

    const [, body] = (httpPost as jest.Mock).mock.calls[0];
    expect(body.url).toBe(
      `http://${os.hostname()}:3002/webhooks/events`,
    );
  });

  it("WEBHOOK_HOST overrides the hostname part, PREFIX the path", async () => {
    (httpPost as jest.Mock).mockResolvedValue({});
    const service = new SubscriberService(
      configWith({
        EVENT_SERVER_URL: "http://event-server:3005",
        WEBHOOK_HOST: "file-server-1",
        PREFIX: "api",
      }),
    );

    await service.onApplicationBootstrap();

    const [, body] = (httpPost as jest.Mock).mock.calls[0];
    expect(body.url).toBe("http://file-server-1:3002/api/webhooks/events");
  });

  it("WEBHOOK_URL overrides the whole per-replica default", async () => {
    (httpPost as jest.Mock).mockResolvedValue({});
    const service = new SubscriberService(
      configWith({
        EVENT_SERVER_URL: "http://event-server:3005",
        WEBHOOK_URL: "http://file-server:3002/webhooks/events",
      }),
    );

    await service.onApplicationBootstrap();

    const [, body] = (httpPost as jest.Mock).mock.calls[0];
    expect(body.url).toBe("http://file-server:3002/webhooks/events");
  });

  it("retries with backoff when event-server is not up yet", async () => {
    jest.useFakeTimers();
    (httpPost as jest.Mock)
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue({});
    const service = new SubscriberService(
      configWith({ EVENT_SERVER_URL: "http://event-server:3005" }),
    );

    await service.onApplicationBootstrap();
    expect(httpPost).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(2000);
    expect(httpPost).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it("EVENT_SERVER_URL=disabled skips the subscription", async () => {
    const service = new SubscriberService(
      configWith({ EVENT_SERVER_URL: "disabled" }),
    );
    await service.onApplicationBootstrap();
    expect(httpPost).not.toHaveBeenCalled();
  });
});
