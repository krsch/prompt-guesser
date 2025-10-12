export interface ImageGenerator {
  generate(prompt: string, options?: Record<string, unknown>): Promise<string>;
}
