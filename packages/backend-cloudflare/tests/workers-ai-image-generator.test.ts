import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkersAiBinding } from "../src/adapters/WorkersAIImageGenerator.js";
import { WorkersAIImageGenerator } from "../src/adapters/WorkersAIImageGenerator.js";

describe("WorkersAIImageGenerator", () => {
  let runMock: WorkersAiBinding["run"];

  beforeEach(() => {
    runMock = vi.fn();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the expected prompt and model", async () => {
    (runMock as ReturnType<typeof vi.fn>).mockResolvedValue({
      result: "iVBORw0KGgoAAAANSUhEUg==",
    });

    const generator = new WorkersAIImageGenerator({
      ai: { run: runMock },
      model: "@cf/bytedance/stable-diffusion-xl-lightning",
    });

    const url = await generator.generate("a scenic vista");

    expect(url).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");
    expect(runMock).toHaveBeenCalledWith("@cf/bytedance/stable-diffusion-xl-lightning", {
      prompt: "a scenic vista",
    });
  });

  it("normalizes ArrayBuffer payloads", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]);
    (runMock as ReturnType<typeof vi.fn>).mockResolvedValue(bytes.buffer);

    const generator = new WorkersAIImageGenerator({ ai: { run: runMock } });

    const url = await generator.generate("buffer result");

    expect(url).toBe("data:image/png;base64,AAECAw==");
  });

  it("caches duplicate prompts", async () => {
    (runMock as ReturnType<typeof vi.fn>).mockResolvedValue({
      image: "iVBORw0KGgoAAAANSUhEUg==",
    });

    const generator = new WorkersAIImageGenerator({ ai: { run: runMock } });

    const first = await generator.generate("duplicate prompt");
    const second = await generator.generate("duplicate prompt");

    expect(first).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");
    expect(second).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the response is missing image data", async () => {
    (runMock as ReturnType<typeof vi.fn>).mockResolvedValue({
      unexpected: "value",
    });

    const generator = new WorkersAIImageGenerator({ ai: { run: runMock } });

    await expect(generator.generate("broken")).rejects.toThrowError(
      "Workers AI response did not include image content",
    );
  });
});
