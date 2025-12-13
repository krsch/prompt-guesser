import type { ImageGenerator, Logger } from "../core.js";

export interface WorkersAiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

interface WorkersAIImageGeneratorOptions {
  readonly ai: WorkersAiBinding;
  readonly model?: string;
  readonly logger?: Logger;
}

export class WorkersAIImageGenerator implements ImageGenerator {
  readonly #ai: WorkersAiBinding;
  readonly #model: string;
  // eslint-disable-next-line functional/prefer-readonly-type
  #cache: Map<string, string> = new Map();
  readonly #logger: Logger | undefined;

  constructor({
    ai,
    model = "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    logger,
  }: WorkersAIImageGeneratorOptions) {
    this.#ai = ai;
    this.#model = model;
    this.#logger = logger;
  }

  async generate(prompt: string): Promise<string> {
    const cached = this.#cache.get(prompt);
    if (cached) {
      this.#logger?.debug?.("Returning cached image", { prompt });
      return cached;
    }

    const result = await this.#ai.run(this.#model, { prompt });
    const url = normalizeImageResult(result);

    // eslint-disable-next-line functional/immutable-data
    this.#cache.set(prompt, url);
    this.#logger?.info?.("Image generated", { prompt, model: this.#model });
    return url;
  }
}

function normalizeImageResult(result: unknown): string {
  if (typeof result === "string") {
    return result.startsWith("data:") ? result : `data:image/png;base64,${result}`;
  }

  if (result instanceof ArrayBuffer) {
    return encodeArrayBuffer(result);
  }

  if (result instanceof Uint8Array) {
    return encodeArrayBuffer(result.buffer);
  }

  if (result && typeof result === "object") {
    const candidate =
      (result as { readonly image?: unknown; readonly result?: unknown }).image ??
      (result as { readonly result?: unknown }).result;
    if (candidate !== undefined) {
      return normalizeImageResult(candidate);
    }
  }

  throw new Error("Workers AI response did not include image content");
}

function encodeArrayBuffer(buffer: ArrayBuffer | ArrayBufferLike): string {
  const view = new Uint8Array(buffer);
  let binary = "";
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }

  const base64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(binary, "binary").toString("base64")
      : btoa(binary);
  return `data:image/png;base64,${base64}`;
}
