import type { ImageGenerator } from "../../domain/ports/ImageGenerator.js";
import { SetRoundImage } from "../commands/SetRoundImage.js";
import type { GameStateChange } from "../GameStore.js";
import type { GameReactor, GameReactorContext } from "../reactors.js";

export class ImageGenerationReactor implements GameReactor {
  constructor(private readonly imageGenerator: ImageGenerator) {}

  async handle(
    change: GameStateChange,
    ctx: GameReactorContext,
    _resultKind: "ok" | "failedRound",
  ): Promise<void> {
    const before = change.before.currentRound?.state;
    const after = change.after.currentRound?.state;
    if (!after) return;
    if (after.phase !== "prompt") return;
    if (after.imageUrl) return;

    const prompts = after.prompts ?? {};
    const promptText = prompts[after.activePlayer];
    if (!promptText) return;

    const sameRoundBefore = before?.id === after.id ? before : undefined;
    const hadPromptBefore =
      sameRoundBefore?.prompts &&
      sameRoundBefore.prompts[after.activePlayer] !== undefined;
    const hadImageBefore = sameRoundBefore?.imageUrl !== undefined;
    if (hadPromptBefore || hadImageBefore) return;

    const imageUrl = await this.imageGenerator.generate(promptText);
    await ctx.service.run(change.after.id, new SetRoundImage(after.id, imageUrl));
  }
}
