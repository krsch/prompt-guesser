import type { ImageGenerator } from "@prompt-guesser/core/domain/ports/ImageGenerator.js";
import type { Logger } from "@prompt-guesser/core/domain/ports/Logger.js";

interface OpenAIImageGeneratorOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly size?: string;
  readonly logger?: Logger;
}

interface OpenAIImageResponse {
  readonly data: readonly { readonly url?: string }[];
}

export class OpenAIImageGenerator implements ImageGenerator {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #size: string;
  readonly #cache = new Map<string, string>();
  #logger: Logger | undefined;

  constructor({ apiKey, model = "gpt-image-1", size = "1024x1024", logger }: OpenAIImageGeneratorOptions) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required to generate images");
    }

    this.#apiKey = apiKey;
    this.#model = model;
    this.#size = size;
    this.#logger = logger;
  }

  async generate(prompt: string): Promise<string> {
    const cached = this.#cache.get(prompt);
    if (cached) {
      this.#logger?.debug?.("Returning cached image", { prompt });
      return cached;
    }

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.#model,
        prompt,
        size: this.#size,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI image generation failed: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as OpenAIImageResponse;
    const url = payload.data[0]?.url;

    if (!url) {
      throw new Error("OpenAI response did not include an image URL");
    }

    this.#cache.set(prompt, url);
    this.#logger?.info?.("Image generated", { prompt });
    return url;
  }
}
