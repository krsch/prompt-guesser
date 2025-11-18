import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { OpenAIImageGenerator } from "../../packages/backend-local/src/adapters/OpenAIImageGenerator.js";

const API_KEY = "test-key";

describe("OpenAIImageGenerator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the expected request payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: "https://example.com/image.png" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAIImageGenerator({
      apiKey: API_KEY,
      model: "gpt-image-1",
      size: "512x512",
    });

    const result = await generator.generate("a scenic vista");

    expect(result).toBe("https://example.com/image.png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        }),
      }),
    );

    const [, options] = fetchMock.mock.calls[0] ?? [];
    expect(options).toBeDefined();
    const payload = JSON.parse((options as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      model: "gpt-image-1",
      prompt: "a scenic vista",
      size: "512x512",
    });
  });

  it("caches duplicate prompts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: "https://example.com/cached.png" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAIImageGenerator({ apiKey: API_KEY });

    const first = await generator.generate("duplicate prompt");
    const second = await generator.generate("duplicate prompt");

    expect(first).toBe("https://example.com/cached.png");
    expect(second).toBe("https://example.com/cached.png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the response is not ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "server exploded",
    });
    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAIImageGenerator({ apiKey: API_KEY });

    await expect(generator.generate("broken")).rejects.toThrowError(
      "OpenAI image generation failed: 500 server exploded",
    );
  });
});
