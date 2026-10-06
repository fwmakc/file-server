jest.mock("api-server-toolkit/helper", () => ({
  httpPost: jest.fn(),
  httpGet: jest.fn(),
}));

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
      patterns: ["user.deleted"],
      active: true,
      secret: "sekrit",
    });
    expect(init.headers["X-Internal-Api-Key"]).toBe("key-1");
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
